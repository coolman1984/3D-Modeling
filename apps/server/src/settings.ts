import type { Store } from './store.js';

/** A coding agent launched as a local program. Placeholders are replaced in each argument. */
export interface CliAgentSettings {
  readonly label: string;
  /**
   * Program and arguments. Placeholders: {prompt} (the full prompt; it is also sent on stdin),
   * {mcpConfig} (path of a generated MCP config JSON), {node}, {mcpScript}, {url}, {actor},
   * {projectId}, {workDir}.
   */
  readonly command: readonly string[];
  /** When false, the prompt is not written to stdin (use {prompt} in the command instead). */
  readonly promptOnStdin: boolean;
}

export interface ApiAgentSettings {
  readonly provider: 'anthropic' | 'openai-compatible';
  readonly apiKey: string;
  readonly model: string;
  /** Optional; for OpenAI-compatible servers this is required (e.g. http://localhost:11434/v1). */
  readonly baseUrl: string;
}

export interface Settings {
  readonly agents: Readonly<Record<string, CliAgentSettings>>;
  readonly api: ApiAgentSettings;
  /** Stop an agent run after this many minutes. */
  readonly timeoutMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  agents: {
    'claude-code': {
      label: 'Claude Code',
      command: [
        'claude',
        '-p',
        '--mcp-config',
        '{mcpConfig}',
        '--strict-mcp-config',
        '--allowedTools',
        'mcp__planner',
        '--output-format',
        'stream-json',
        '--verbose',
      ],
      promptOnStdin: true,
    },
    codex: {
      label: 'Codex',
      command: [
        'codex',
        'exec',
        '--skip-git-repo-check',
        '-c',
        'mcp_servers.planner.command="{node}"',
        '-c',
        'mcp_servers.planner.args=["{mcpScript}", "--url", "{url}", "--actor", "{actor}"]',
        '-',
      ],
      promptOnStdin: true,
    },
  },
  api: { provider: 'anthropic', apiKey: '', model: 'claude-opus-5', baseUrl: '' },
  timeoutMinutes: 30,
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A launchable agent: a label, a program with arguments (all non-empty text) and the stdin choice. */
export function isCliAgent(value: unknown): value is CliAgentSettings {
  if (!isRecord(value)) return false;
  const { label, command, promptOnStdin } = value;
  return (
    typeof label === 'string' && label.trim() !== '' && label.length <= 80 &&
    Array.isArray(command) && command.length > 0 && command.length <= 100 &&
    command.every((a) => typeof a === 'string' && a.length <= 4000) && typeof command[0] === 'string' && command[0].trim() !== '' &&
    typeof promptOnStdin === 'boolean'
  );
}

/**
 * Why a settings change cannot be saved, or an empty list. Settings start programs on this
 * computer, so nothing half-formed is stored: an agent without a command used to break the agent
 * list and leave its runs marked as running forever (bugs.md finding 4).
 */
export function settingsProblems(next: unknown): string[] {
  if (!isRecord(next)) return ['settings must be an object'];
  const problems: string[] = [];
  if (next.agents !== undefined) {
    if (!isRecord(next.agents)) problems.push('agents must be an object of agents by id');
    else for (const [id, agent] of Object.entries(next.agents)) {
      if (!/^[\w-]{1,40}$/.test(id) || id === 'api') problems.push(`agent id "${id}" must be 1-40 letters, digits, - or _ (and not "api")`);
      if (!isCliAgent(agent)) problems.push(`agent "${id}" needs a label, a command (program and arguments as text) and promptOnStdin true/false`);
    }
  }
  if (next.api !== undefined) {
    if (!isRecord(next.api)) problems.push('api must be an object');
    else {
      const { provider, apiKey, model, baseUrl } = next.api;
      if (provider !== undefined && provider !== 'anthropic' && provider !== 'openai-compatible') problems.push('api.provider must be "anthropic" or "openai-compatible"');
      for (const [key, value] of Object.entries({ apiKey, model, baseUrl })) {
        if (value !== undefined && (typeof value !== 'string' || value.length > 2000)) problems.push(`api.${key} must be text`);
      }
    }
  }
  if (next.timeoutMinutes !== undefined && (typeof next.timeoutMinutes !== 'number' || !Number.isFinite(next.timeoutMinutes))) {
    problems.push('timeoutMinutes must be a number of minutes');
  }
  return problems;
}

export function loadSettings(store: Store): Settings {
  const saved = store.getSetting<Partial<Settings>>('settings') ?? {};
  // A broken agent saved by an older version is left out rather than breaking every agent.
  const agents = Object.fromEntries(Object.entries(isRecord(saved.agents) ? saved.agents : {}).filter(([, a]) => isCliAgent(a)));
  const timeout = saved.timeoutMinutes;
  return {
    agents: { ...DEFAULT_SETTINGS.agents, ...agents },
    api: { ...DEFAULT_SETTINGS.api, ...(isRecord(saved.api) ? saved.api : {}) },
    timeoutMinutes: typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : DEFAULT_SETTINGS.timeoutMinutes,
  };
}

/** Save settings; an empty or masked API key keeps the stored one. */
export function saveSettings(store: Store, next: Partial<Settings>): Settings {
  const current = loadSettings(store);
  const apiKey = next.api?.apiKey;
  const keepKey = apiKey === undefined || apiKey === '' || apiKey.startsWith('••');
  const merged: Settings = {
    agents: next.agents ?? current.agents,
    api: { ...current.api, ...(next.api ?? {}), apiKey: keepKey ? current.api.apiKey : apiKey },
    timeoutMinutes: Math.min(240, Math.max(1, Math.round(next.timeoutMinutes ?? current.timeoutMinutes))),
  };
  store.setSetting('settings', merged);
  return merged;
}

/** Settings as shown in the browser: the key is never sent back, only whether one is saved. */
export function publicSettings(settings: Settings): Settings & { readonly api: ApiAgentSettings & { readonly hasKey: boolean } } {
  const key = settings.api.apiKey;
  return { ...settings, api: { ...settings.api, apiKey: key ? `••••${key.slice(-4)}` : '', hasKey: Boolean(key) } };
}
