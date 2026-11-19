import { AgentDetailConsole } from '@/components/intelligence/AgentDetailConsole';

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return <AgentDetailConsole agentId={agentId} />;
}
