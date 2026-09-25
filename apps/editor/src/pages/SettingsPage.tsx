import { CircleDashed, CheckCircle, Check, Key, Ruler, Sparkle, TerminalWindow, Wrench, XCircle, SpinnerGap } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type AgentAvailability, type Settings } from '../api.js';
import { DEFAULT_CONTROLS, loadControls, saveControls, type ControlSettings } from '../logic/controls.js';
import { Segmented, SwitchRow } from '../ui/Fields.js';
import { GRID_OPTIONS } from '../ui/Panels.js';
import { SiteHeader } from '../ui/Site.js';

type Tab = 'providers' | 'tools' | 'prefs';
interface ToolInfo {
  name: string;
  description: string;
}

const MCP_COMMANDS = [
  { label: 'Claude Code', command: 'claude mcp add planner -- node <project folder>/apps/server/dist/mcp.mjs' },
  { label: 'Codex', command: 'codex mcp add planner -- node <project folder>/apps/server/dist/mcp.mjs' },
];

/** AI providers, the planner's tools, and movement preferences. API keys stay on this computer and are never shown again. */
export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('providers');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [agents, setAgents] = useState<AgentAvailability[]>([]);
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [state, setState] = useState<{ tone: 'ok' | 'busy' | 'error' | 'dirty'; text: string }>({ tone: 'ok', text: 'All changes saved' });
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [controls, setControlsState] = useState<ControlSettings>(loadControls);
  const [copied, setCopied] = useState<string | null>(null);

  const load = () => {
    void api.getSettings().then((s) => {
      setSettings(s);
      setCommands(Object.fromEntries(Object.entries(s.agents).map(([id, a]) => [id, JSON.stringify(a.command)])));
    });
    void api.agents().then(setAgents);
    void fetch('/api/tools')
      .then((r) => r.json() as Promise<ToolInfo[]>)
      .then(setTools)
      .catch(() => undefined);
  };
  useEffect(load, []);

  const dirty = () => setState({ tone: 'dirty', text: 'Unsaved changes' });
  const setControls = (next: ControlSettings) => {
    setControlsState(next);
    saveControls(next);
  };

  const save = async () => {
    if (!settings) return;
    const agentsNext: Settings['agents'] = {};
    for (const [id, a] of Object.entries(settings.agents)) {
      try {
        const parsed: unknown = JSON.parse(commands[id] ?? '[]');
        if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string') || parsed.length === 0) throw new Error();
        agentsNext[id] = { ...a, command: parsed as string[] };
      } catch {
        setState({ tone: 'error', text: `The “${a.label}” command must be a JSON list of words.` });
        setEditing(id);
        return;
      }
    }
    setState({ tone: 'busy', text: 'Saving…' });
    try {
      const next = await api.saveSettings({ agents: agentsNext, api: { ...settings.api, apiKey }, timeoutMinutes: settings.timeoutMinutes });
      setApiKey('');
      setSettings(next);
      setState({ tone: 'ok', text: 'All changes saved' });
      void api.agents().then(setAgents);
    } catch (e) {
      setState({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const headerState = (
    <span className={`saved-state${state.tone === 'busy' || state.tone === 'dirty' ? ' busy' : state.tone === 'error' ? ' error' : ''}`} role="status" data-testid="settings-state">
      {state.tone === 'busy' ? <SpinnerGap size={14} /> : state.tone === 'error' ? <XCircle size={14} /> : state.tone === 'dirty' ? <CircleDashed size={14} /> : <Check size={14} />}
      {state.text}
    </span>
  );

  const tabs: Array<{ id: Tab; label: string; icon: ReactNode }> = [
    { id: 'providers', label: 'AI Providers', icon: <Sparkle size={15} /> },
    { id: 'tools', label: 'Agent Tools', icon: <Wrench size={15} /> },
    { id: 'prefs', label: 'Preferences', icon: <Ruler size={15} /> },
  ];

  return (
    <div className="site">
      <SiteHeader active="settings" right={headerState} />
      <div className="settings-layout">
        <aside>
          <h1>Settings</h1>
          <nav className="settings-nav" aria-label="Settings sections">
            {tabs.map((t) => (
              <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>
        </aside>
        <main className="settings-main">
          {tab === 'providers' && (
            <section aria-label="AI Providers">
              <h2>AI Providers</h2>
              <p className="intro">The AI Planner can work through an assistant installed on this computer, or through a service using your own key. Keys stay on this computer.</p>
              {!settings ? (
                <p className="muted">Loading…</p>
              ) : (
                <>
                  {Object.entries(settings.agents).map(([id, a]) => {
                    const status = agents.find((x) => x.id === id);
                    return (
                      <div key={id} className="provider" data-agent={id}>
                        <span className="provider-icon">
                          <TerminalWindow size={17} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <span className="name">{a.label}</span>
                          <span className="status" style={{ color: status?.available ? 'var(--ok)' : 'var(--ink-3)' }}>
                            {status?.available ? <CheckCircle size={13} /> : <CircleDashed size={13} />}
                            {status ? (status.available ? 'Ready' : 'Unavailable') : 'Checking…'}
                          </span>
                          <div className="detail">{status ? (status.available ? `Found at ${status.detail}` : status.detail) : ''}</div>
                        </div>
                        <button type="button" className="btn small" aria-expanded={editing === id} onClick={() => setEditing(editing === id ? null : id)}>
                          {editing === id ? 'Done' : 'Edit command'}
                        </button>
                        {editing === id && (
                          <label className="provider-edit stack">
                            Start command (a JSON list of words)
                            <textarea
                              className="input"
                              dir="ltr"
                              rows={3}
                              value={commands[id] ?? ''}
                              onChange={(e) => {
                                setCommands((c) => ({ ...c, [id]: e.target.value }));
                                dirty();
                              }}
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                  <div className="provider" data-agent="api">
                    <span className="provider-icon">
                      <Key size={17} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <span className="name">{settings.api.provider === 'anthropic' ? 'Anthropic API' : 'Compatible API'}</span>
                      <span className="status" style={{ color: agents.find((a) => a.id === 'api')?.available ? 'var(--ok)' : 'var(--ink-3)' }}>
                        {agents.find((a) => a.id === 'api')?.available ? <CheckCircle size={13} /> : <CircleDashed size={13} />}
                        {settings.api.provider === 'anthropic' ? (settings.api.hasKey ? 'Key saved' : 'Not set up') : settings.api.baseUrl ? 'Address saved' : 'Not set up'}
                      </span>
                      <div className="detail">
                        {settings.api.hasKey ? `Key ending in ${settings.api.apiKey.slice(-6)}` : 'Paste a key to use the planner without an installed assistant.'}
                      </div>
                    </div>
                    <span />
                  </div>
                  <div className="set-row">
                    <div>
                      <div className="label">Service</div>
                      <div className="hint">Anthropic, or any service that speaks the OpenAI chat format (such as a local model)</div>
                    </div>
                    <select
                      className="input"
                      aria-label="Service"
                      value={settings.api.provider}
                      onChange={(e) => {
                        setSettings({ ...settings, api: { ...settings.api, provider: e.target.value as Settings['api']['provider'] } });
                        dirty();
                      }}
                    >
                      <option value="anthropic">Anthropic API</option>
                      <option value="openai-compatible">OpenAI-compatible service</option>
                    </select>
                  </div>
                  <div className="set-row">
                    <div>
                      <div className="label">Model</div>
                      <div className="hint">The model name the service expects</div>
                    </div>
                    <input
                      className="input"
                      dir="ltr"
                      aria-label="Model"
                      value={settings.api.model}
                      onChange={(e) => {
                        setSettings({ ...settings, api: { ...settings.api, model: e.target.value } });
                        dirty();
                      }}
                    />
                  </div>
                  <div className="set-row">
                    <div>
                      <div className="label">API key</div>
                      <div className="hint">Stored on this computer only and never shown again</div>
                    </div>
                    <input
                      className="input"
                      dir="ltr"
                      type="password"
                      autoComplete="off"
                      aria-label="API key"
                      placeholder={settings.api.hasKey ? `Saved (${settings.api.apiKey}) · paste to replace` : 'No key yet'}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        dirty();
                      }}
                    />
                  </div>
                  <div className="set-row">
                    <div>
                      <div className="label">Service address</div>
                      <div className="hint">{settings.api.provider === 'anthropic' ? 'Optional' : 'For example http://localhost:11434/v1'}</div>
                    </div>
                    <input
                      className="input"
                      dir="ltr"
                      aria-label="Service address"
                      placeholder={settings.api.provider === 'anthropic' ? 'Optional' : 'http://localhost:11434/v1'}
                      value={settings.api.baseUrl}
                      onChange={(e) => {
                        setSettings({ ...settings, api: { ...settings.api, baseUrl: e.target.value } });
                        dirty();
                      }}
                    />
                  </div>
                  <div className="set-row strong">
                    <div>
                      <div className="label">Time limit</div>
                      <div className="hint">A planner run stops after this many minutes</div>
                    </div>
                    <span className="fld" style={{ maxWidth: 160 }}>
                      <input
                        className="input"
                        inputMode="numeric"
                        aria-label="Time limit in minutes"
                        style={{ paddingLeft: 12 }}
                        value={settings.timeoutMinutes}
                        onChange={(e) => {
                          setSettings({ ...settings, timeoutMinutes: Number(e.target.value) || 30 });
                          dirty();
                        }}
                      />
                      <span className="fld-u">min</span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
                    <button type="button" className="btn primary" onClick={() => void save()}>
                      Save changes
                    </button>
                    <button type="button" className="btn" onClick={load}>
                      Discard
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {tab === 'tools' && (
            <section aria-label="Agent Tools">
              <h2>Agent Tools</h2>
              <p className="intro">These are the tools the planner uses. Every change it makes is saved as its own revision under its name, and can be undone from History.</p>
              {tools.map((t) => (
                <div key={t.name} className="tool-row">
                  <code>{t.name}</code>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {t.description.split('. ')[0]!.replace(/\.$/, '')}.
                  </span>
                </div>
              ))}
              <div className="connect-box">
                <div style={{ fontWeight: 500 }}>Connect another assistant</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Assistants that support the Model Context Protocol can use the same tools in your own sessions.
                </div>
                {MCP_COMMANDS.map((c) => (
                  <div key={c.label} className="copy-line">
                    <input className="input" readOnly value={c.command} aria-label={`${c.label} command`} />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        void navigator.clipboard?.writeText(c.command).catch(() => undefined);
                        setCopied(c.label);
                        setTimeout(() => setCopied(null), 1500);
                      }}
                    >
                      {copied === c.label ? 'Copied' : `Copy for ${c.label}`}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === 'prefs' && (
            <section aria-label="Preferences">
              <h2>Preferences</h2>
              <p className="intro">Precision and movement in the editor. Kept in this browser and shared by all projects; also in the editor's Precision panel.</p>
              <div className="set-row">
                <div>
                  <div className="label">Grid</div>
                  <div className="hint">Snap step when dragging</div>
                </div>
                <Segmented
                  label="Grid"
                  className="auto-width"
                  value={GRID_OPTIONS.some((o) => o.ticks === controls.grid) ? controls.grid : -1}
                  onChange={(ticks) => ticks > 0 && setControls({ ...controls, grid: ticks })}
                  options={[...GRID_OPTIONS.map((o) => ({ id: o.ticks, label: o.label })), ...(GRID_OPTIONS.some((o) => o.ticks === controls.grid) ? [] : [{ id: -1, label: 'Custom' }])]}
                />
              </div>
              <div className="set-row">
                <div>
                  <div className="label">Movement</div>
                  <div className="hint">Guides and keyboard speed</div>
                </div>
                <div style={{ maxWidth: 420 }}>
                  <SwitchRow label="Smart guides" hint="Snap to edges and centres of nearby items and walls" on={controls.guides} onChange={(guides) => setControls({ ...controls, guides })} />
                  <SwitchRow
                    label="Speed up while held"
                    hint="Arrow keys move faster the longer you hold"
                    on={controls.keyAcceleration > 0}
                    onChange={(on) => setControls({ ...controls, keyAcceleration: on ? DEFAULT_CONTROLS.keyAcceleration || 1 : 0 })}
                  />
                </div>
              </div>
              <div className="set-row">
                <div>
                  <div className="label">Defaults</div>
                  <div className="hint">Grid 5 cm, arrows 1 cm, rotate 15°</div>
                </div>
                <div>
                  <button type="button" className="btn" onClick={() => setControls(DEFAULT_CONTROLS)}>
                    Reset to defaults
                  </button>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
