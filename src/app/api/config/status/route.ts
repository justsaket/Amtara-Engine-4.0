import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { jsonOk } from '@/lib/server/error-handler';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { snapshot } = resolveAutonomousConfiguration();
  return jsonOk(snapshot);
}
