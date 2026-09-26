import type { Project } from '@space-planner/core';
import type { PackId } from '@space-planner/starter';
import { ArrowBendDownRight, CaretDown, CaretRight, CheckCircle, Circle, Play, Plus, Sparkle, Square, X, XCircle } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { api, subscribe, type AgentAvailability, type AgentRun } from '../api.js';

/** Plain words for the planner's tools, as they appear in the run log ("🔧 place_items"). */
const TOOL_WORDS: Readonly<Record<string, string>> = {
  list_projects: 'Looked through the projects',
  create_project: 'Created a project',
  get_project: 'Read the room and the plan',
  set_room: 'Changed the room',
  define_item: 'Defined an item type',
  place_items: 'Placed items',
  move_items: 'Moved items',
  remove_items: 'Removed items',
  apply_commands: 'Applied changes',
  check_project: 'Checked the plan',
  get_history: 'Read the history',
  restore_revision: 'Restored a revision',
};

const SUGGESTIONS: Readonly<Record<PackId, readonly string[]>> = {
  hall: [
    'Seat 120 guests at round tables of 10 and keep every walkway at least 120 cm wide.',
    'Put the stage in the middle of the north wall and the buffet along the east wall.',
    'Make room for a 5 × 5 m dance floor in front of the stage.',
  ],
  container: [
    'Load all planned cargo, heaviest at the bottom, and keep the centre of mass near the middle.',
    'Pack the pallets for stop 2 near the doors so stop 1 can be unloaded first.',
    'Compare the three packing strategies and apply the one that fits the most.',
  ],
  office: [
    'Lay out 16 desks with chairs in rows, with a 90 cm walkway to every door.',
    'Add a meeting table for 8 near the window side and a phone booth by the entrance.',
    'Line the south wall with storage and keep the doors clear.',
  ],
  warehouse: [
    'Inspect the rack positions and check whether the forklift can reach each row.',
    'Review the dock to rack travel path and keep every main aisle clear.',
    'Compare usable pallet positions after blocking damaged storage locations.',
  ],
  production: [
    'Check whether a material handler can reach every station in order.',
    'Move the buffer so it sits evenly between the two machines.',
    'Read the flow length and station counts for this line.',
  ],
  depot: [
    'Check whether a sedan can turn from the lane into every empty bay.',
    'Add two more perpendicular bays at the end of the row and check them.',
    'Read the bay counts and how many are occupied.',
  ],
  restaurant: [
    'Check whether every table can be reached from the kitchen pass.',
    'Add a 6-top round table in the empty corner of the dining room.',
    'Read the cover count and floor area per cover.',
  ],
};

interface Step {
  readonly text: string;
  readonly tool: boolean;
}

/** The run log as steps: tool calls in plain words, messages from the planner as they are. */
function stepsOf(log: string): Step[] {
  const steps: Step[] = [];
  for (const raw of log.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('▶') || line.startsWith('✔') || line.startsWith('✖')) continue;
    if (line.startsWith('🔧')) {
      const name = line.slice(2).trim();
      const text = TOOL_WORDS[name] ?? `Used ${name.replace(/_/g, ' ')}`;
      // A tool used several times in a row is one step.
      if (steps.at(-1)?.text === text) continue;
      steps.push({ text, tool: true });
    } else if (!line.startsWith('⚠')) {
      steps.push({ text: line.length > 220 ? `${line.slice(0, 217)}…` : line, tool: false });
    }
  }
  return steps;
}

/**
 * The AI Planner: describe the goal, pick the planner, and watch it work. Its changes arrive live
 * in the plan and the history as revisions under its name, and a whole run can be undone.
 */
export function AgentPanel({ project, pack, onClose }: { project: Project; pack: PackId; onClose: () => void }) {
  const [agents, setAgents] = useState<AgentAvailability[]>([]);
  const [agent, setAgent] = useState('');
  const [prompt, setPrompt] = useState('');
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  // Revision each run started from (this window only), so "Undo this run" knows where to go back to.
  const [startedAt, setStartedAt] = useState<Record<string, number>>({});
  const logRef = useRef<HTMLPreElement>(null);

  const refresh = () => void api.runs(project.id).then(setRuns).catch(() => undefined);

  useEffect(() => {
    void api
      .agents()
      .then((list) => {
        setAgents(list);
        setAgent((current) => current || list.find((a) => a.available)?.id || list[0]?.id || '');
      })
      .catch(() => undefined);
    refresh();
    return subscribe({ run: (e) => e.projectId === project.id && refresh() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const latest = runs[0] && runs[0].id !== dismissed ? runs[0] : undefined;
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [latest?.log, logOpen]);

  const chosen = agents.find((a) => a.id === agent);
  const start = async (text: string) => {
    setError(null);
    try {
      const from = project.revision;
      const run = await api.startRun(project.id, agent, text);
      setStartedAt((s) => ({ ...s, [run.id]: from }));
      setDismissed(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const head = (
    <div className="ai-head">
      <Sparkle size={16} color="var(--accent)" />
      <span className="title">AI Planner</span>
      <select className="input" aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value)} disabled={latest?.status === 'running'}>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
            {a.available ? '' : ' · not set up'}
          </option>
        ))}
      </select>
      <button type="button" className="btn ghost icon" style={{ width: 28, height: 28 }} title="Close AI Planner" aria-label="Close AI Planner" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );

  if (!latest) {
    const empty = !prompt.trim();
    return (
      <>
        {head}
        <div className="ai-body" aria-label="AI Planner">
          <div>
            <h3>Describe the plan you need.</h3>
            <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              The planner edits this project with the same tools you use. Every change is saved as a revision you can undo.
            </p>
          </div>
          <textarea className="input" name="agent-prompt" rows={5} aria-label="Planning goal" placeholder="What should the plan achieve?" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <div>
            <div className="kicker" style={{ marginBottom: 6 }}>
              Try
            </div>
            {SUGGESTIONS[pack].map((text) => (
              <button key={text} type="button" className="suggestion" onClick={() => setPrompt(text)}>
                <ArrowBendDownRight size={14} />
                {text}
              </button>
            ))}
          </div>
          {chosen && !chosen.available && (
            <p className="muted" style={{ color: 'var(--warning)' }}>
              {chosen.detail}. Set it up in <a href="#/settings">Settings</a>.
            </p>
          )}
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="spacer muted" style={{ fontSize: 12 }}>
              Starts from revision {project.revision}
            </span>
            <button type="button" className="btn primary" style={{ height: 38, padding: '0 18px' }} disabled={empty || !agent} onClick={() => void start(prompt)}>
              <Play size={14} />
              Start planning
            </button>
          </div>
        </div>
      </>
    );
  }

  const running = latest.status === 'running';
  const steps = stepsOf(latest.log);
  const tools = steps.filter((s) => s.tool).length;
  const headline = running ? 'Working on it…' : latest.status === 'done' ? 'Plan updated' : latest.status === 'stopped' ? 'Stopped' : 'The planner stopped';
  const from = startedAt[latest.id];
  const lastMessage = [...steps].reverse().find((s) => !s.tool)?.text;
  return (
    <>
      {head}
      <div className="ai-body" aria-label="AI Planner" data-run-status={latest.status}>
        <div className="request-box">
          <div className="kicker">Request</div>
          <div className="text">{latest.prompt}</div>
        </div>
        <div className="ai-headline">
          <span className="serif">{headline}</span>
          <span className="muted num" style={{ fontSize: 12 }}>
            {tools} {tools === 1 ? 'step' : 'steps'}
          </span>
        </div>
        <div className={`progress ${running ? 'running' : latest.status === 'done' ? 'done' : 'failed'}`}>
          <div style={{ width: running ? `${Math.min(90, 12 + tools * 9)}%` : '100%' }} />
        </div>
        {steps.length > 0 && (
          <ol className="steps">
            {steps.slice(-10).map((s, i, shown) => {
              const current = running && i === shown.length - 1;
              return (
                <li key={`${i}-${s.text}`} className={current ? 'current' : ''}>
                  <span className="icon">{current ? <Circle size={16} /> : s.tool ? <CheckCircle size={16} /> : <ArrowBendDownRight size={14} color="var(--ink-3)" />}</span>
                  <span className="text">{s.text}</span>
                </li>
              );
            })}
          </ol>
        )}
        {running && (
          <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => void api.stopRun(latest.id).then(refresh)}>
            <Square size={12} />
            Stop planner
          </button>
        )}
        {latest.status === 'done' && (
          <div className="run-outcome">
            <div className="kicker">
              <CheckCircle size={13} />
              Completed · revision {project.revision}
            </div>
            <div className="serif">{lastMessage ?? 'The planner finished its changes.'}</div>
            <p className="muted" style={{ margin: '12px 0' }}>
              Its changes are in the plan and in History under “AI Planner”. Check the Review tab before sharing.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn primary" onClick={() => setDismissed(latest.id)}>
                Keep changes
              </button>
              {from !== undefined && from < project.revision && (
                <button type="button" className="btn" onClick={() => void api.restore(project.id, from).then(() => setDismissed(latest.id))}>
                  Undo this run
                </button>
              )}
            </div>
          </div>
        )}
        {(latest.status === 'failed' || latest.status === 'stopped') && (
          <div className="run-failed">
            <div className="title">
              <XCircle size={16} />
              {latest.status === 'stopped' ? 'You stopped the planner' : 'The planner stopped'}
            </div>
            <p className="muted" style={{ margin: '6px 0 12px' }}>
              {lastMessage ?? 'It ended without finishing.'} Changes it already saved stay in History and can be restored or undone.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn primary small"
                onClick={() => {
                  setPrompt(latest.prompt);
                  setDismissed(latest.id);
                }}
              >
                Edit request
              </button>
              <button type="button" className="btn small" disabled={!agent} onClick={() => void start(latest.prompt)}>
                Try again
              </button>
            </div>
          </div>
        )}
        <div>
          <button type="button" className="link-btn" style={{ color: 'var(--ink-2)' }} aria-expanded={logOpen} onClick={() => setLogOpen((o) => !o)}>
            {logOpen ? <CaretDown size={14} /> : <CaretRight size={14} />}
            Detailed log
          </button>
          {logOpen && (
            <pre ref={logRef} className="run-log" dir="auto" data-testid="run-log">
              {latest.log || '…'}
            </pre>
          )}
        </div>
        {!running && (
          <button type="button" className="link-btn" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => setDismissed(latest.id)}>
            <Plus size={14} />
            New request
          </button>
        )}
      </div>
    </>
  );
}
