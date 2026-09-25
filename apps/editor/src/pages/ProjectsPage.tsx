import { useEffect, useRef, useState } from 'react';
import { api, subscribe, type ProjectSummary } from '../api.js';
import { NumberField } from '../ui/Fields.js';

function when(iso: string): string {
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/** All projects in the database: open, create, copy, delete, import a file. */
export function ProjectsPage({ open }: { open: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState('');
  const [width, setWidth] = useState<number | undefined>(12);
  const [depth, setDepth] = useState<number | undefined>(9);
  const [ceiling, setCeiling] = useState<number | undefined>(3);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => void api.listProjects().then(setProjects).catch(() => setMessage('البرنامج مش شغّال؟ مقدرتش أوصل للبيانات.'));
  useEffect(() => {
    refresh();
    return subscribe({ projects: refresh });
  }, []);

  const create = async () => {
    const project = await api.createProject({
      name: name.trim() || 'مشروع جديد',
      width_m: width ?? 12,
      depth_m: depth ?? 9,
      ...(ceiling === undefined ? {} : { ceiling_m: ceiling }),
    });
    open(project.id);
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>مشاريعي</h1>
        <a href="#/settings" className="button">الإعدادات</a>
      </header>

      <section className="panel new-project" aria-label="مشروع جديد">
        <h2>مشروع جديد</h2>
        <div className="row wrap">
          <label className="field">
            <span>الاسم</span>
            <input name="project-name" value={name} placeholder="مثال: قاعة الياسمين" onChange={(e) => setName(e.target.value)} />
          </label>
          <NumberField name="new-width" label="العرض" unit="م" value={width} min={1} max={500} onChange={setWidth} />
          <NumberField name="new-depth" label="الطول" unit="م" value={depth} min={1} max={500} onChange={setDepth} />
          <NumberField name="new-ceiling" label="السقف" unit="م" value={ceiling} min={0.5} max={50} allowEmpty onChange={setCeiling} />
          <button type="button" className="primary" onClick={() => void create()}>
            اعمل المشروع
          </button>
          <button type="button" onClick={() => void api.createProject({ name: 'قاعة تجريبية ١٠×٨ م', template: 'demo' }).then((p) => open(p.id))}>
            جرّب القاعة التجريبية
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            افتح ملف
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            data-testid="import-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void file
                .text()
                .then((text) => api.createProject({ name: file.name.replace(/\.json$/, ''), file: text }))
                .then((p) => open(p.id))
                .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));
            }}
          />
        </div>
        {message && <p className="error-text">{message}</p>}
      </section>

      <section className="panel" aria-label="المشاريع">
        {projects === null ? (
          <p className="muted">بيحمّل…</p>
        ) : projects.length === 0 ? (
          <p className="muted">لسه مفيش مشاريع. اعمل واحد من فوق.</p>
        ) : (
          <table className="projects">
            <thead>
              <tr>
                <th>المشروع</th>
                <th>العناصر</th>
                <th>التعديلات</th>
                <th>آخر تعديل</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} data-project={p.id}>
                  <td>
                    <a href={`#/p/${p.id}`}>{p.name}</a>
                  </td>
                  <td>{p.itemCount}</td>
                  <td>{p.revision}</td>
                  <td className="muted">{when(p.updatedAt)}</td>
                  <td className="actions">
                    <button type="button" className="small" onClick={() => void api.duplicateProject(p.id)}>
                      نسخة
                    </button>
                    <button
                      type="button"
                      className="small danger"
                      onClick={() => {
                        if (window.confirm(`تمسح «${p.name}» بكل سجله؟ مفيش رجوع.`)) void api.deleteProject(p.id);
                      }}
                    >
                      امسح
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
