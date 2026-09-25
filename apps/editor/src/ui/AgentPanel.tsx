import type { Project } from '@space-planner/core';
import { useEffect, useRef, useState } from 'react';
import { api, subscribe, type AgentAvailability, type AgentRun } from '../api.js';

const STATUS: Record<AgentRun['status'], string> = {
  running: 'شغّال…',
  done: 'خلص',
  failed: 'وقف بمشكلة',
  stopped: 'اتوقف',
};

/**
 * Hand the design to an AI agent: write what you want, pick the agent, and watch it build.
 * Its changes arrive live in the plan and in the history, and can be undone like any other.
 */
export function AgentPanel({ project }: { project: Project }) {
  const [agents, setAgents] = useState<AgentAvailability[]>([]);
  const [agent, setAgent] = useState('');
  const [prompt, setPrompt] = useState('');
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const refresh = () => void api.runs(project.id).then(setRuns).catch(() => undefined);

  useEffect(() => {
    void api.agents().then((list) => {
      setAgents(list);
      setAgent((current) => current || list.find((a) => a.available)?.id || list[0]?.id || '');
    });
    refresh();
    return subscribe({ run: (e) => e.projectId === project.id && refresh() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const latest = runs[0];
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [latest?.log]);

  const running = latest?.status === 'running';
  const chosen = agents.find((a) => a.id === agent);
  const start = async () => {
    setError(null);
    try {
      await api.startRun(project.id, agent, prompt);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel" aria-label="الوكيل الذكي">
      <h2>الوكيل الذكي</h2>
      <p className="muted">اكتب المطلوب بالتفصيل، والوكيل هيصمم بنفسه وإنت شايف كل خطوة، وتقدر ترجع في أي حاجة من السجل.</p>
      <textarea
        name="agent-prompt"
        rows={5}
        placeholder="مثال: قاعة فرح لـ ١٢٠ ضيف، ترابيزات مدورة لـ ١٠ أفراد، مسرح في النص قدام الحيطة الشمالية، وبوفيه على الحيطة الشرقية."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="row">
        <select aria-label="الوكيل" value={agent} onChange={(e) => setAgent(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
              {a.available ? '' : ' (مش جاهز)'}
            </option>
          ))}
        </select>
        {running ? (
          <button type="button" className="danger" onClick={() => void api.stopRun(latest!.id).then(refresh)}>
            وقّف الوكيل
          </button>
        ) : (
          <button type="button" className="primary" disabled={!prompt.trim() || !agent} onClick={() => void start()}>
            ابدأ
          </button>
        )}
      </div>
      {chosen && !chosen.available && <p className="muted">{chosen.detail}. تقدر تظبطه من صفحة الإعدادات.</p>}
      {error && <p className="error-text">{error}</p>}
      {latest && (
        <div className="run" data-run-status={latest.status}>
          <div className="run-head">
            <strong>{STATUS[latest.status]}</strong>
            <span className="muted">{latest.agent}</span>
          </div>
          <pre ref={logRef} className="run-log" dir="auto">
            {latest.log || '…'}
          </pre>
        </div>
      )}
    </section>
  );
}
