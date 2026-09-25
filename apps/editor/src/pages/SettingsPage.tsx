import { useEffect, useState } from 'react';
import { api, type AgentAvailability, type Settings } from '../api.js';

const MCP_HINT_CLAUDE = 'claude mcp add planner -- node <مسار المشروع>/apps/server/dist/mcp.mjs';
const MCP_HINT_CODEX = 'codex mcp add planner -- node <مسار المشروع>/apps/server/dist/mcp.mjs';

/** Agents and API settings. The API key stays on this computer and is never shown again. */
export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [agents, setAgents] = useState<AgentAvailability[]>([]);
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  const load = () => {
    void api.getSettings().then((s) => {
      setSettings(s);
      setCommands(Object.fromEntries(Object.entries(s.agents).map(([id, a]) => [id, JSON.stringify(a.command)])));
    });
    void api.agents().then(setAgents);
  };
  useEffect(load, []);

  if (!settings) return <div className="page"><p className="muted">بيحمّل…</p></div>;

  const save = async () => {
    const agentsNext: Settings['agents'] = {};
    for (const [id, a] of Object.entries(settings.agents)) {
      try {
        const parsed: unknown = JSON.parse(commands[id] ?? '[]');
        if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string') || parsed.length === 0) throw new Error();
        agentsNext[id] = { ...a, command: parsed as string[] };
      } catch {
        setSaved(`أمر «${a.label}» لازم يكون قائمة نصوص مكتوبة بصيغة JSON.`);
        return;
      }
    }
    const next = await api.saveSettings({ agents: agentsNext, api: { ...settings.api, apiKey }, timeoutMinutes: settings.timeoutMinutes });
    setApiKey('');
    setSaved('اتحفظ ✓');
    setSettings(next);
    void api.agents().then(setAgents);
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>الإعدادات</h1>
        <a href="#/" className="button">رجوع للمشاريع</a>
      </header>

      <section className="panel" aria-label="الوكلاء">
        <h2>وكلاء البرمجة على جهازك</h2>
        <p className="muted">البرنامج بيشغّل الوكيل على جهازك ويديله أدوات التصميم بس. لازم يكون متثبّت ومسجّل دخوله.</p>
        {Object.entries(settings.agents).map(([id, a]) => {
          const status = agents.find((x) => x.id === id);
          return (
            <div key={id} className="agent-setting" data-agent={id}>
              <h3>
                {a.label}{' '}
                <span className={`badge ${status?.available ? 'ok' : 'warning'}`}>{status?.available ? 'جاهز' : 'مش لاقيه'}</span>
              </h3>
              {status && !status.available && <p className="muted">{status.detail}</p>}
              <label className="field block">
                <span>أمر التشغيل</span>
                <textarea
                  dir="ltr"
                  rows={3}
                  value={commands[id] ?? ''}
                  onChange={(e) => setCommands((c) => ({ ...c, [id]: e.target.value }))}
                />
              </label>
            </div>
          );
        })}
        <p className="muted">
          ممكن كمان تضيف أدوات التصميم لجلساتك العادية: <code dir="ltr">{MCP_HINT_CLAUDE}</code> أو <code dir="ltr">{MCP_HINT_CODEX}</code>
        </p>
      </section>

      <section className="panel" aria-label="واجهة برمجية">
        <h2>وكيل بمفتاح واجهة برمجية (اختياري)</h2>
        <div className="grid2">
          <label className="field">
            <span>الخدمة</span>
            <select
              value={settings.api.provider}
              onChange={(e) => setSettings({ ...settings, api: { ...settings.api, provider: e.target.value as Settings['api']['provider'] } })}
            >
              <option value="anthropic">Claude (Anthropic)</option>
              <option value="openai-compatible">خدمة متوافقة (OpenAI-compatible)</option>
            </select>
          </label>
          <label className="field">
            <span>النموذج</span>
            <input dir="ltr" value={settings.api.model} onChange={(e) => setSettings({ ...settings, api: { ...settings.api, model: e.target.value } })} />
          </label>
          <label className="field">
            <span>المفتاح</span>
            <input
              dir="ltr"
              type="password"
              autoComplete="off"
              placeholder={settings.api.hasKey ? `محفوظ (${settings.api.apiKey})` : 'مفيش مفتاح'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <label className="field">
            <span>العنوان</span>
            <input
              dir="ltr"
              placeholder={settings.api.provider === 'anthropic' ? 'اختياري' : 'http://localhost:11434/v1'}
              value={settings.api.baseUrl}
              onChange={(e) => setSettings({ ...settings, api: { ...settings.api, baseUrl: e.target.value } })}
            />
          </label>
          <label className="field">
            <span>أقصى مدة للوكيل</span>
            <input
              inputMode="numeric"
              value={settings.timeoutMinutes}
              onChange={(e) => setSettings({ ...settings, timeoutMinutes: Number(e.target.value) || 30 })}
            />
            <span className="muted">دقيقة</span>
          </label>
        </div>
        <p className="muted">المفتاح بيتحفظ على جهازك بس، ومش بيظهر تاني بعد الحفظ.</p>
      </section>

      <div className="row">
        <button type="button" className="primary" onClick={() => void save()}>
          احفظ الإعدادات
        </button>
        {saved && <span role="status">{saved}</span>}
      </div>
    </div>
  );
}
