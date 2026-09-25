import type { Project } from '@space-planner/core';
import { Sparkle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { actorName, api, isAgent, type RevisionInfo } from '../api.js';
import { formatWhen } from '../logic/format.js';

/** Every saved revision: who made it, what changed, a read-only preview and a way back to it. */
export function HistoryPanel({
  project,
  busy,
  previewing,
  onPreview,
  onRestored,
}: {
  project: Project;
  busy: boolean;
  /** The revision shown read-only in the plan, if any. */
  previewing: number | null;
  onPreview: (revision: number) => void;
  onRestored: (p: Project, revision: number) => void;
}) {
  const [items, setItems] = useState<RevisionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .history(project.id)
        .then((h) => {
          if (cancelled) return;
          setItems(h);
          setError(null);
        })
        .catch(() => !cancelled && setError('Could not load the history.'));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project.id, project.revision]);

  return (
    <div aria-label="History">
      <p className="history-intro">Every change is saved as a revision. Preview any revision before restoring it.</p>
      {error && <p className="muted" style={{ padding: '0 24px' }}>{error}</p>}
      <ol className="revs">
        {items.map((h) => {
          const agent = isAgent(h.actor);
          const you = h.actor === 'human';
          const current = h.revision === project.revision;
          return (
            <li key={h.revision} data-revision={h.revision} className={`rev${current ? ' current' : ''}${previewing === h.revision ? ' previewing' : ''}`}>
              <span className="rev-line" />
              <span className={`avatar${you ? ' you' : agent ? ' agent' : ''}`} aria-hidden="true">
                {agent ? <Sparkle size={13} /> : you ? 'You' : actorName(h.actor).slice(0, 2).toUpperCase()}
              </span>
              <div className="rev-body">
                <div className="rev-top">
                  <span className="rev-who">{agent ? 'AI Planner' : actorName(h.actor)}</span>
                  {agent && <span className="rev-via">via {actorName(h.actor)}</span>}
                  <span className="rev-no">#{h.revision}</span>
                </div>
                <div className="rev-what">{h.summary}</div>
                <div className="rev-when">{formatWhen(h.createdAt)}</div>
                {current ? (
                  <div className="rev-current">Current revision</div>
                ) : (
                  <div className="rev-actions">
                    <button type="button" className="btn small" onClick={() => onPreview(h.revision)} aria-pressed={previewing === h.revision}>
                      Preview
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      disabled={busy}
                      onClick={() => {
                        void api.restore(project.id, h.revision).then((r) => onRestored(r.project, h.revision));
                      }}
                    >
                      Restore revision
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
