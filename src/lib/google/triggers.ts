import type { AppsScriptFile, ScriptTriggerRecord } from '@/types/domain';
import { DEFAULT_WORKSPACE_TIMEZONE } from '@/lib/validation';
import { runAppsScriptFunction } from './apps-script-client';
import type { FetchLike } from './oauth';

export const ANTARA_TRIGGER_FILE_NAME = '__antara_triggers';

export function buildTriggerScheduleDescription(input: {
  triggerType: ScriptTriggerRecord['triggerType'];
  intervalValue?: number;
  hourOfDay?: number;
  timezone?: string;
}): string {
  const tz = input.timezone || DEFAULT_WORKSPACE_TIMEZONE;
  switch (input.triggerType) {
    case 'time_hourly':
      return `Every ${input.intervalValue || 1} hour(s) (${tz})`;
    case 'time_daily':
      return `Daily at ${String(input.hourOfDay ?? 9).padStart(2, '0')}:00 (${tz})`;
    case 'time_weekly':
      return `Weekly at ${String(input.hourOfDay ?? 9).padStart(2, '0')}:00 (${tz})`;
    case 'on_open':
      return 'On container open (bound spreadsheet/document)';
    case 'on_edit':
      return 'On edit event (bound spreadsheet)';
    case 'on_change':
      return 'On change event (bound spreadsheet)';
  }
}

export function generateAntaraTriggerHelperSource(): string {
  return `/**
 * Antara Engine 4.0 — Idempotent Trigger Management Helper
 * Only manages triggers registered with handlers explicitly provisioned via Antara.
 * Existing unrelated triggers on this Apps Script project are never deleted.
 */
function antaraInstallOrSyncTrigger(config) {
  var handler = config && config.handler;
  var triggerType = config && config.triggerType;
  if (!handler || typeof this[handler] !== 'function') {
    throw new Error('Antara trigger handler function not found in project: ' + handler);
  }

  var existingTriggers = ScriptApp.getProjectTriggers();
  var keptCount = 0;
  for (var i = 0; i < existingTriggers.length; i++) {
    var t = existingTriggers[i];
    if (t.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(t);
    } else {
      keptCount++;
    }
  }

  var builder = ScriptApp.newTrigger(handler);
  var created;
  if (triggerType === 'time_hourly') {
    created = builder.timeBased().everyHours(Number(config.intervalValue || 1)).create();
  } else if (triggerType === 'time_daily') {
    created = builder.timeBased().everyDays(1).atHour(Number(config.hourOfDay || 9)).create();
  } else if (triggerType === 'time_weekly') {
    created = builder.timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(Number(config.hourOfDay || 9)).create();
  } else {
    throw new Error('Trigger type "' + triggerType + '" requires manual bound container attachment.');
  }

  return {
    installed: true,
    googleTriggerId: created.getUniqueId(),
    handler: handler,
    preservedUnrelatedTriggers: keptCount
  };
}

function antaraRemoveTrigger(config) {
  var targetHandler = config && config.handler;
  var targetId = config && config.googleTriggerId;
  var existingTriggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existingTriggers.length; i++) {
    var t = existingTriggers[i];
    if ((targetId && t.getUniqueId() === targetId) || (targetHandler && t.getHandlerFunction() === targetHandler)) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  }
  return { removed: removed };
}
`;
}

export function scriptContainsHandlerFunction(
  files: ReadonlyArray<AppsScriptFile>,
  handlerName: string,
): boolean {
  const escaped = handlerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`function\\s+${escaped}\\s*\\(`);
  return files.some((f) => f.type === 'SERVER_JS' && pattern.test(f.source));
}

export async function installAntaraTriggerRemotely(params: {
  accessToken: string;
  deploymentId: string;
  handler: string;
  triggerType: ScriptTriggerRecord['triggerType'];
  intervalValue?: number;
  hourOfDay?: number;
  timezone?: string;
  fetchImpl?: FetchLike;
}): Promise<{
  installed: boolean;
  googleTriggerId?: string;
  preservedUnrelatedTriggers?: number;
}> {
  const response = await runAppsScriptFunction(
    params.accessToken,
    params.deploymentId,
    {
      functionName: 'antaraInstallOrSyncTrigger',
      parameters: [
        {
          handler: params.handler,
          triggerType: params.triggerType,
          intervalValue: params.intervalValue || 1,
          hourOfDay: params.hourOfDay ?? 9,
          timezone: params.timezone || DEFAULT_WORKSPACE_TIMEZONE,
        },
      ],
      devMode: false,
    },
    params.fetchImpl,
  );

  if (response.error) {
    throw new Error(
      response.error.message || 'Remote Apps Script trigger installer returned an error.',
    );
  }

  const result = (response.response?.result || {}) as {
    installed?: boolean;
    googleTriggerId?: string;
    preservedUnrelatedTriggers?: number;
  };

  return {
    installed: Boolean(result.installed),
    googleTriggerId: result.googleTriggerId,
    preservedUnrelatedTriggers: result.preservedUnrelatedTriggers,
  };
}

export async function removeAntaraTriggerRemotely(params: {
  accessToken: string;
  deploymentId: string;
  handler: string;
  googleTriggerId?: string;
  fetchImpl?: FetchLike;
}): Promise<{ removed: number }> {
  const response = await runAppsScriptFunction(
    params.accessToken,
    params.deploymentId,
    {
      functionName: 'antaraRemoveTrigger',
      parameters: [
        {
          handler: params.handler,
          ...(params.googleTriggerId ? { googleTriggerId: params.googleTriggerId } : {}),
        },
      ],
      devMode: false,
    },
    params.fetchImpl,
  );

  if (response.error) {
    throw new Error(
      response.error.message || 'Remote Apps Script trigger removal returned an error.',
    );
  }

  const result = (response.response?.result || {}) as { removed?: number };
  return { removed: Number(result.removed || 0) };
}
