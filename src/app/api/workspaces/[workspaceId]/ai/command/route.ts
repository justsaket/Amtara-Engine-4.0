import { NextRequest } from 'next/server';
import {
  recordConversationTurn,
  startAndExecuteOrchestratorRun,
} from '@/lib/agents/orchestrator';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  listConversationsAndMessages,
  listOrchestratorRuns,
} from '@/lib/server/phase3-repositories';
import { getStore, requireWorkspaceAccess } from '@/lib/server/repositories';
import { aiCommandRequestSchema } from '@/lib/validation';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    await requireWorkspaceAccess(user.uid, workspaceId, 'ai:read', {
      idToken: user.idToken,
    });

    const conversationId = req.nextUrl.searchParams.get('conversationId') || undefined;
    const [runs, convoData] = await Promise.all([
      listOrchestratorRuns(workspaceId, { idToken: user.idToken }),
      listConversationsAndMessages(workspaceId, conversationId, {
        idToken: user.idToken,
      }),
    ]);

    return jsonOk({
      runs: runs.slice(0, 30),
      conversations: convoData.conversations.slice(0, 25),
      messages: convoData.messages,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const body = await req.json();
    const input = aiCommandRequestSchema.parse(body);

    const store = getStore({ idToken: user.idToken });

    if (input.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          };

          try {
            const bundle = await startAndExecuteOrchestratorRun({
              uid: user.uid,
              actorEmail: user.email,
              workspaceId,
              prompt: input.prompt,
              brandId: input.brandId,
              conversationId: input.conversationId,
              preferredAgentIds: input.preferredAgentIds,
              complexityHint: input.complexityHint,
              idempotencyKey: input.idempotencyKey,
              ctx: { idToken: user.idToken, store },
              onProgress: (evt) => {
                send('progress', evt);
              },
            });

            const conversationId = await recordConversationTurn(store, workspaceId, user.uid, {
              conversationId: input.conversationId,
              brandId: input.brandId,
              userPrompt: input.prompt,
              assistantResponse:
                bundle.run.finalMarkdown || bundle.run.finalSummary || 'Run finished.',
              runId: bundle.run.id,
              status: bundle.run.status,
            });

            send('complete', { conversationId, ...bundle });
          } catch (err) {
            send('error', {
              message: err instanceof Error ? err.message : 'Orchestrator execution failed.',
            });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    const bundle = await startAndExecuteOrchestratorRun({
      uid: user.uid,
      actorEmail: user.email,
      workspaceId,
      prompt: input.prompt,
      brandId: input.brandId,
      conversationId: input.conversationId,
      preferredAgentIds: input.preferredAgentIds,
      complexityHint: input.complexityHint,
      idempotencyKey: input.idempotencyKey,
      ctx: { idToken: user.idToken, store },
    });

    const conversationId = await recordConversationTurn(store, workspaceId, user.uid, {
      conversationId: input.conversationId,
      brandId: input.brandId,
      userPrompt: input.prompt,
      assistantResponse:
        bundle.run.finalMarkdown || bundle.run.finalSummary || 'Run finished.',
      runId: bundle.run.id,
      status: bundle.run.status,
    });

    return jsonOk({ conversationId, ...bundle }, 201);
  } catch (err) {
    return jsonError(err);
  }
}
