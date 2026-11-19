import type { AiProviderStatusDescriptor } from '@/types/domain';
import { estimateStringTokens } from '../model-router';
import type {
  ModelGenerateRequest,
  ModelProviderAdapter,
  ModelRawResponse,
} from '../types';

export type MockModelResponder = (req: ModelGenerateRequest) => string;

/**
 * TEST ONLY deterministic adapter. Never registered by default in production runtimes.
 */
export class MockTestModelAdapter implements ModelProviderAdapter {
  public readonly providerId = 'test_mock' as const;
  public readonly isMock = true;
  private readonly responder?: MockModelResponder;

  constructor(responder?: MockModelResponder) {
    this.responder = responder;
  }

  public getStatus(): AiProviderStatusDescriptor {
    return {
      provider: 'test_mock',
      label: 'Automated Test Adapter (TEST ONLY)',
      state: 'test_only',
      source: 'unit_test_injection',
      supportedTaskClasses: [
        'fast_routing',
        'classification',
        'research_synthesis',
        'deep_reasoning',
        'copy_generation',
        'qa_critique',
      ],
      defaultModels: {
        fast_routing: 'mock-fast_routing',
        deep_reasoning: 'mock-deep_reasoning',
      },
      reason: 'Explicitly injected deterministic adapter for automated verification tests.',
      isMock: true,
    };
  }

  public async generateText(req: ModelGenerateRequest): Promise<ModelRawResponse> {
    const text = this.responder
      ? this.responder(req)
      : JSON.stringify({
          summary: `Deterministic test output for ${req.taskClass}`,
          findings: [
            {
              title: 'Grounded Brand Check',
              summary: 'Checked workspace brand profile constraints without inventing unverified specs.',
              verificationStatus: 'INFERRED',
              confidence: 0.72,
              sourceUrls: [],
            },
          ],
          recommendations: [
            {
              action: 'Review draft brief in Strategy Planner before Phase 4 scheduling.',
              rationale: 'Phase 3 prepares structured drafts and briefs for explicit human approval.',
              priority: 'medium',
              requiresApproval: true,
            },
          ],
          claims: [
            {
              claimText: 'Draft recommendation derived from workspace brand baseline only.',
              verificationStatus: 'INFERRED',
              confidence: 0.72,
              sourceUrls: [],
            },
          ],
          artifactTitle: 'Test Strategy & Intelligence Draft',
          artifactMarkdown:
            '## Summary\nDeterministic test artifact prepared for automated Phase 3 verification.',
          structuredData: { isTestFixture: true, taskClass: req.taskClass },
          assumptions: ['Executed using injected TEST ONLY mock adapter.'],
          uncertaintyNotes: ['No live external model or live web search was invoked in test mode.'],
          memoryCandidates: [],
        });

    return {
      provider: 'test_mock',
      model: `mock-${req.taskClass}`,
      text,
      inputTokens: estimateStringTokens(`${req.systemInstruction}\n${req.userPrompt}`),
      outputTokens: estimateStringTokens(text),
      latencyMs: 5,
      citations: [],
      isMock: true,
    };
  }
}
