import type { Project } from '@space-planner/core';
import { useEffect, useState } from 'react';
import { actorName, api, type RevisionInfo } from '../api.js';

function when(iso: string): string {
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

/** Every saved revision: who made it, what changed, and a way back to it. */
export function HistoryPanel({ project, busy, onRestored }: { project: Project; busy: boolean; onRestored: (p: Project) => void }) {
  const [items, setItems] = useState<RevisionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .history(project.id)
        .then((h) => !cancelled && setItems(h))
        .catch(() => !cancelled && setError('مقدرتش أجيب السجل.'));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project.id, project.revision]);

  return (
    <section className="panel" aria-label="السجل">
      <h2>سجل التعديلات</h2>
      {error && <p className="muted">{error}</p>}
      <ol className="history">
        {items.map((h) => (
          <li key={h.revision} data-revision={h.revision} className={h.revision === project.revision ? 'current' : ''}>
            <div>
              <strong>#{h.revision}</strong> · {h.summary}
            </div>
            <div className="muted">
              {actorName(h.actor)} · {when(h.createdAt)}
            </div>
            {h.revision !== project.revision && (
              <button
                type="button"
                className="small"
                disabled={busy}
                onClick={() => {
                  void api.restore(project.id, h.revision).then((r) => onRestored(r.project));
                }}
              >
                رجّع للنسخة دي
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
