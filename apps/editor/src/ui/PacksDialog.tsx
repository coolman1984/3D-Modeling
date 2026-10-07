import { Check, DownloadSimple, FileArrowUp, Package, SpinnerGap, Trash, XCircle } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { api, type PackList } from '../api.js';
import { formatCount, plural } from '../logic/format.js';
import { Dialog } from './Fields.js';

/** File bytes as base64, in slices so large packs do not overflow the call stack. */
async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function save(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Ask = { kind: 'replace'; id: string; name: string; count: number; source: { included: string } | { data: string } } | { kind: 'remove'; id: string; name: string; count: number };

/**
 * Packs (decision 0027): ready-made projects in a file. The ones that come with Atrium install in
 * one click; any `.atrium` file installs from disk or by dropping it here; an installed pack is
 * removed in one click (the person's own projects stay) or saved as a file to hand on.
 */
export function PacksDialog({ onClose, onChanged, ownProjectIds }: { onClose: () => void; onChanged: (text: string) => void; ownProjectIds: readonly string[] }) {
  const [list, setList] = useState<PackList | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [dropping, setDropping] = useState(false);
  const [naming, setNaming] = useState(false);
  const [packName, setPackName] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const load = () =>
    void api
      .packs()
      .then((l) => {
        setList(l);
        setFailed(null);
      })
      .catch(() => setFailed('The packs could not be loaded. Is the Atrium server running?'));
  useEffect(load, []);

  const install = async (source: { included: string } | { data: string }, replace = false) => {
    setBusy('included' in source ? source.included : 'file');
    setFailed(null);
    try {
      const result = await api.installPack({ ...source, ...(replace ? { replace: true } : {}) });
      if (result.error === 'installed' && result.pack) {
        setAsk({ kind: 'replace', id: result.pack.id, name: result.pack.name, count: result.pack.projectCount, source });
      } else if (result.error) {
        setFailed(result.error);
      } else if (result.pack) {
        onChanged(`Installed ${result.pack.name} · ${plural(result.projects?.length ?? 0, 'project')}`);
        setAsk(null);
        load();
      }
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.endsWith('.atrium')) {
      setFailed(`“${file.name}” is not a pack. Packs end in .atrium.`);
      return;
    }
    await install({ data: await base64Of(file) });
  };

  const remove = async (id: string, name: string) => {
    setBusy(id);
    try {
      const result = await api.removePack(id);
      onChanged(`Removed ${name} · ${plural(result.removed, 'project')}`);
      setAsk(null);
      load();
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const download = async (from: Parameters<typeof api.packFile>[0], label: string) => {
    setBusy(label);
    try {
      const { name, blob } = await api.packFile(from);
      save(name, blob);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const fromFiles = list?.installed.filter((p) => !list.included.some((i) => i.id === p.id)) ?? [];
  const installedCount = (id: string) => list?.installed.find((p) => p.id === id)?.projectCount ?? 0;
  const confirm = ask && (
    <div className="pack-ask" role="alertdialog" aria-label={ask.kind === 'replace' ? 'Replace pack' : 'Remove pack'}>
      <span>
        {ask.kind === 'replace'
          ? `${ask.name} is already installed. Replace its ${plural(ask.count, 'project')}? Changes made to them are lost.`
          : `Remove ${ask.name} and its ${plural(ask.count, 'project')}? Your own projects stay.`}
      </span>
      <button type="button" className="btn small" onClick={() => setAsk(null)}>
        Cancel
      </button>
      <button type="button" className="btn small primary" data-testid="pack-confirm" onClick={() => void (ask.kind === 'replace' ? install(ask.source, true) : remove(ask.id, ask.name))}>
        {ask.kind === 'replace' ? 'Replace' : 'Remove'}
      </button>
    </div>
  );

  const row = (p: { id: string; name: string; description: string; projectCount: number }, installed: boolean, included: boolean) => (
    <li key={p.id} className="pack-row" data-pack={p.id}>
      <span className="pack-icon">
        <Package size={20} />
      </span>
      <span className="pack-text">
        <span className="pack-name">{p.name}</span>
        <span className="pack-desc">{p.description}</span>
        <span className="pack-count">{installed ? `${formatCount(installedCount(p.id))} installed` : plural(p.projectCount, 'project')}</span>
      </span>
      <span className="pack-actions">
        {installed && (
          <>
            <button type="button" className="icon-btn" title="Save as a file" aria-label={`Save ${p.name} as a file`} disabled={busy !== null} onClick={() => void download({ pack: p.id }, p.id)}>
              <DownloadSimple size={16} />
            </button>
            <button type="button" className="icon-btn" title="Remove" aria-label={`Remove ${p.name}`} data-testid={`remove-pack-${p.id}`} disabled={busy !== null} onClick={() => setAsk({ kind: 'remove', id: p.id, name: p.name, count: installedCount(p.id) })}>
              <Trash size={16} />
            </button>
          </>
        )}
        {included &&
          (installed ? (
            <span className="chip ok">
              <Check size={12} /> Installed
            </span>
          ) : (
            <button type="button" className="btn small" disabled={busy !== null} onClick={() => void install({ included: p.id })} data-testid={`install-pack-${p.id}`}>
              {busy === p.id ? <SpinnerGap size={14} /> : null}
              {busy === p.id ? 'Installing…' : 'Install'}
            </button>
          ))}
      </span>
    </li>
  );

  return (
    <Dialog label="Packs" onClose={onClose} className="dialog packs-dialog">
      <div
        className={`packs${dropping ? ' dropping' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          void fromFile(e.dataTransfer.files[0]);
        }}
      >
        <div className="dialog-head">
          <div className="kicker">Packs</div>
          <h3>Ready-made projects, in a file.</h3>
          <p className="muted" style={{ marginTop: 6 }}>
            Install a pack to explore or to start from it; remove it when you are done. Your own projects are never touched.
          </p>
        </div>
        <div className="dialog-body">
          {failed && (
            <p className="error-text pack-error" role="alert">
              <XCircle size={14} /> {failed}
            </p>
          )}
          {confirm}
          {!list ? (
            failed ? null : (
              <div className="skeleton" style={{ height: 140 }} />
            )
          ) : (
            <>
              <div className="kicker">Included with Atrium</div>
              {list.included.length === 0 ? <p className="muted">No packs came with this copy of Atrium.</p> : <ul className="pack-list">{list.included.map((p) => row({ ...p }, p.installed, true))}</ul>}
              {fromFiles.length > 0 && (
                <>
                  <div className="kicker" style={{ marginTop: 8 }}>
                    Installed from files
                  </div>
                  <ul className="pack-list">{fromFiles.map((p) => row(p, true, false))}</ul>
                </>
              )}
              {naming && (
                <form
                  className="pack-name-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!packName.trim()) return;
                    void download({ name: packName.trim(), projectIds: [...ownProjectIds] }, 'own').then(() => setNaming(false));
                  }}
                >
                  <input className="input" autoFocus placeholder="Pack name, e.g. Client — Villa 12" aria-label="Pack name" value={packName} onChange={(e) => setPackName(e.target.value)} />
                  <button type="submit" className="btn primary" disabled={!packName.trim() || busy !== null}>
                    Save pack
                  </button>
                </form>
              )}
            </>
          )}
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" disabled={busy !== null} onClick={() => input.current?.click()} data-testid="install-pack-file">
            {busy === 'file' ? <SpinnerGap size={15} /> : <FileArrowUp size={15} />}
            {busy === 'file' ? 'Installing…' : 'Install from file…'}
          </button>
          <button type="button" className="btn" disabled={busy !== null || ownProjectIds.length === 0} onClick={() => setNaming((n) => !n)} title={ownProjectIds.length === 0 ? 'You have no projects of your own yet' : undefined}>
            <DownloadSimple size={15} />
            Save my projects as a pack…
          </button>
          <span className="spacer faint" style={{ fontSize: 'calc(12px * var(--ts, 1))', textAlign: 'right' }}>
            or drop a .atrium file here
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".atrium"
          hidden
          data-testid="pack-input"
          onChange={(e) => {
            void fromFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    </Dialog>
  );
}
