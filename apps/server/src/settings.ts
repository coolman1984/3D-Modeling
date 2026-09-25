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

export function loadSettings(store: Store): Settings {
  const saved = store.getSetting<Partial<Settings>>('settings') ?? {};
  return {
    agents: { ...DEFAULT_SETTINGS.agents, ...(saved.agents ?? {}) },
    api: { ...DEFAULT_SETTINGS.api, ...(saved.api ?? {}) },
    timeoutMinutes: saved.timeoutMinutes ?? DEFAULT_SETTINGS.timeoutMinutes,
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
