import { apply, type Command, type Project } from '@space-planner/core';
import { autoLinkCommands, checkPlantLink, ecoTagOf, tagItemCommand, tagZoneCommand, type PlantNode, type PlantNodeType, type PlantTree } from '@space-planner/starter';
import { ArrowUUpLeft, CaretLeft, CloudArrowDown, DownloadSimple, PaperPlaneTilt, Plugs, UploadSimple } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { ecoApi, type EcoStatus } from '../eco/ecoApi.js';
import '../eco/eco.css';
import { applyLiveEvent, connecting, linkedLineCodes, liveUrl, lost, OFF, type LiveView } from '../eco/live.js';
import { LivePlan } from '../eco/LivePlan.js';

type Note = { readonly tone: 'ok' | 'error'; readonly text: string } | null;

const ITEM_TYPES: readonly PlantNodeType[] = ['station', 'equipment'];
const ZONE_TYPES: readonly PlantNodeType[] = ['plant', 'area', 'line'];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function Notice({ note }: { note: Note }) {
  return note ? <p className={`eco-msg is-${note.tone}`} role={note.tone === 'error' ? 'alert' : 'status'}>{note.text}</p> : null;
}

/**
 * Link to plant: the planner's side of the GMES link (plan 40-SPACE-PLANNER WP-S1 to S3). Settings and keys, the plant tree
 * (from a file or fetched from GMES on the person's command), tagging items and zones with plant nodes (ordinary commands, so
 * every tag is a revision), the link checks, sending or downloading the layout snapshot, and the live view of the plant.
 */
export function PlantPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState<EcoStatus | null>(null);
  const [tree, setTree] = useState<PlantTree>([]);
  const [form, setForm] = useState({ company_id: '', gmes_url: '', node: 'planner-1', gmes_key: '', live_key: '' });
  const [settingsNote, setSettingsNote] = useState<Note>(null);
  const [plantNote, setPlantNote] = useState<Note>(null);
  const [tagNote, setTagNote] = useState<Note>(null);
  const [sendNote, setSendNote] = useState<Note>(null);
  const [liveNote, setLiveNote] = useState<Note>(null);
  const [undo, setUndo] = useState<Command[]>([]);
  const [live, setLive] = useState<LiveView>(OFF);
  const source = useRef<EventSource | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadEco = async () => {
    const s = await ecoApi.status();
    setStatus(s);
    setForm((f) => ({ ...f, company_id: s.company_id, gmes_url: s.gmes_url, node: s.node }));
    setTree((await ecoApi.plant()).nodes);
  };
  useEffect(() => {
    api.getProject(projectId).then(setProject).catch(() => setMissing(true));
    void loadEco().catch((e) => setSettingsNote({ tone: 'error', text: message(e) }));
    return () => source.current?.close();
  }, [projectId]);

  const checks = useMemo(() => (project ? checkPlantLink(project, tree) : []), [project, tree]);
  const byType = (types: readonly PlantNodeType[]) => tree.filter((n) => types.includes(n.type) && n.active);

  const saveSettings = async () => {
    setSettingsNote(null);
    try {
      setStatus(await ecoApi.save(form));
      setForm((f) => ({ ...f, gmes_key: '', live_key: '' }));
      setSettingsNote({ tone: 'ok', text: 'Saved. Keys are stored sealed on this computer and never shown again.' });
    } catch (e) {
      setSettingsNote({ tone: 'error', text: message(e) });
    }
  };

  const afterImport = async (imported: number, from: string) => {
    await loadEco();
    setPlantNote({ tone: 'ok', text: `${imported} plant nodes imported from ${from}.` });
  };
  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setPlantNote(null);
    try {
      await afterImport((await ecoApi.importPlant(await file.text())).imported, file.name);
    } catch (e) {
      setPlantNote({ tone: 'error', text: message(e) });
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const fetchFromGmes = async () => {
    setPlantNote(null);
    try {
      await afterImport((await ecoApi.fetchPlant()).imported, 'GMES');
    } catch (e) {
      setPlantNote({ tone: 'error', text: message(e) });
    }
  };

  const send = async (commands: Command[], inverse?: Command) => {
    if (!project) return;
    setTagNote(null);
    const result = await api.sendCommands(project.id, commands, project.revision);
    if (result.ok) {
      setProject(result.project);
      if (inverse) setUndo((u) => [...u, inverse]);
    } else if ('conflict' in result) {
      setProject(result.project);
      setTagNote({ tone: 'error', text: 'The plan was changed elsewhere, so nothing was tagged. The latest version is loaded: try again.' });
    } else {
      setTagNote({ tone: 'error', text: 'rejection' in result ? result.rejection.message : result.error });
    }
  };
  const tag = async (kind: 'item' | 'zone', id: string, nodeId: string) => {
    if (!project) return;
    const node = tree.find((n) => n.id === nodeId) ?? null;
    const command = kind === 'item' ? tagItemCommand(project, id, node) : tagZoneCommand(project, id, node);
    if (!command) return;
    const local = apply(project, command);
    await send([command], local.ok ? local.inverse : undefined);
  };
  /** Tag everything that carries a GMES code (the Nile Vision sample does) with the node of that code, as one revision. */
  const linkByCode = async () => {
    if (!project) return;
    const link = autoLinkCommands(project, tree);
    const parts = [
      link.linked.length ? `${link.linked.length} linked` : null,
      link.ambiguous.length ? `${link.ambiguous.length} share a code in the plant tree and were left: ${link.ambiguous.join(', ')}` : null,
      link.missing.length ? `${link.missing.length} have a code that is not a plant node: ${link.missing.join(', ')}` : null,
    ].filter(Boolean).join('; ');
    if (link.commands.length === 0) {
      setTagNote({ tone: 'error', text: link.missing.length + link.ambiguous.length ? `Nothing could be linked by code. ${parts}.` : 'Nothing to link: no item or zone carries a GMES code that is not linked yet.' });
      return;
    }
    const batch = { type: 'batch' as const, commands: link.commands };
    const local = apply(project, batch);
    await send([batch], local.ok ? local.inverse : undefined);
    setTagNote({ tone: 'ok', text: `Link by code: ${parts}.` });
  };
  const undoTag = async () => {
    const last = undo.at(-1);
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    await send([last]);
  };

  const download = async () => {
    setSendNote(null);
    try {
      const envelope = (await ecoApi.snapshot(projectId)) as { data: { code: string; version: number } };
      const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `layout-${envelope.data.code}-v${envelope.data.version}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setSendNote({ tone: 'ok', text: `Snapshot version ${envelope.data.version} saved as a file.` });
    } catch (e) {
      setSendNote({ tone: 'error', text: message(e) });
    }
  };
  const sendToGmes = async () => {
    setSendNote(null);
    try {
      const r = await ecoApi.send(projectId);
      setSendNote(r.ok ? { tone: 'ok', text: `GMES answered “${r.result}” for layout version ${r.version}.` } : { tone: 'error', text: `GMES refused the layout: ${r.message ?? r.code ?? r.result}` });
    } catch (e) {
      setSendNote({ tone: 'error', text: message(e) });
    }
  };

  const stopLive = () => {
    source.current?.close();
    source.current = null;
    setLive(OFF);
  };
  const startLive = async () => {
    if (!project) return;
    setLiveNote(null);
    const lines = linkedLineCodes(project, tree);
    if (lines.length === 0) {
      setLiveNote({ tone: 'error', text: 'Tag a zone or an item with a line of the plant tree first: the live view follows the lines of this plan.' });
      return;
    }
    try {
      const config = await ecoApi.liveConfig();
      const stream = new EventSource(liveUrl(config.gmes_url, config.key, lines));
      source.current = stream;
      setLive((v) => connecting(v));
      stream.onopen = () => setLive((v) => ({ ...v, status: 'live' }));
      stream.onerror = () => setLive((v) => lost(v));
      for (const name of ['station.state', 'line.output']) {
        stream.addEventListener(name, (event) => {
          try {
            const data: unknown = JSON.parse((event as MessageEvent<string>).data);
            setLive((v) => applyLiveEvent(v, name, data, new Date().toISOString()));
          } catch {
            /* a broken event changes nothing */
          }
        });
      }
    } catch (e) {
      setLiveNote({ tone: 'error', text: message(e) });
    }
  };

  if (missing) {
    return (
      <div className="eco-page">
        <a className="eco-back" href="#/"><CaretLeft size={14} />Projects</a>
        <p>This project no longer exists.</p>
      </div>
    );
  }
  if (!project) return <div className="eco-page"><p className="muted">Loading…</p></div>;

  const rows = Object.values(project.items).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const zones = project.space.zones ?? [];
  const options = (types: readonly PlantNodeType[]) => {
    const nodes = byType(types);
    return nodes.map((n: PlantNode) => <option key={n.id} value={n.id}>{n.code} · {n.name.en}</option>);
  };
  const current = (meta: Parameters<typeof ecoTagOf>[0]) => {
    const t = ecoTagOf(meta);
    return t?.kind === 'plant_node' ? t.id : '';
  };

  return (
    <div className="eco-page" data-testid="plant-page">
      <a className="eco-back" href={`#/p/${project.id}`}><CaretLeft size={14} />Back to {project.name}</a>
      <h1>Link to plant</h1>

      <section className="eco-card" aria-label="GMES link settings">
        <h2>GMES link</h2>
        <p className="muted">Paste the company id from pairing and the address of GMES. The keys stay sealed on this computer; nothing is sent until you press a button below.</p>
        <div className="eco-form">
          <label className="stack">Company id<input className="input" dir="ltr" name="eco-company" value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })} /></label>
          <label className="stack">GMES address<input className="input" dir="ltr" name="eco-url" placeholder="http://127.0.0.1:4300" value={form.gmes_url} onChange={(e) => setForm({ ...form, gmes_url: e.target.value })} /></label>
          <label className="stack">This planner’s name<input className="input" dir="ltr" name="eco-node" value={form.node} onChange={(e) => setForm({ ...form, node: e.target.value })} /></label>
          <label className="stack">Key for GMES {status?.has_key ? '(saved)' : ''}<input className="input" type="password" dir="ltr" name="eco-key" autoComplete="off" placeholder={status?.has_key ? 'Leave empty to keep the saved key' : 'Paste the key'} value={form.gmes_key} onChange={(e) => setForm({ ...form, gmes_key: e.target.value })} /></label>
          <label className="stack">Read-only key for the live view {status?.has_live_key ? '(saved)' : ''}<input className="input" type="password" dir="ltr" name="eco-live-key" autoComplete="off" placeholder={status?.has_live_key ? 'Leave empty to keep the saved key' : 'Paste the read-only key'} value={form.live_key} onChange={(e) => setForm({ ...form, live_key: e.target.value })} /></label>
        </div>
        <div className="eco-row"><button type="button" className="btn accent" onClick={() => void saveSettings()}>Save link settings</button></div>
        <Notice note={settingsNote} />
      </section>

      <section className="eco-card" aria-label="Plant tree">
        <h2>Plant tree</h2>
        <p className="muted">{status?.plant ? `${status.plant.count} nodes, imported from ${status.plant.source === 'gmes' ? 'GMES' : 'a file'} on ${status.plant.fetched_at.slice(0, 16).replace('T', ' ')}.` : 'No plant tree imported yet.'}</p>
        <div className="eco-row">
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}><UploadSimple size={15} />Choose a plant file…</button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden data-testid="plant-file" onChange={(e) => void pickFile(e.target.files?.[0])} />
          <button type="button" className="btn" onClick={() => void fetchFromGmes()}><CloudArrowDown size={15} />Fetch from GMES</button>
        </div>
        <Notice note={plantNote} />
        {tree.length > 0 && (
          <ul className="eco-tree" aria-label="Plant nodes">
            {tree.map((n) => <li key={n.id} className={`is-${n.type}`}><span>{n.code}</span><code>{n.type}</code><span>{n.name.en}</span></li>)}
          </ul>
        )}
      </section>

      <section className="eco-card" aria-label="Tag the plan">
        <h2>Tag the plan</h2>
        <p className="muted">Pick the plant node each zone and item stands for. Every tag is one revision of the plan and can be undone.</p>
        <div className="eco-row">
          <button type="button" className="btn" disabled={tree.length === 0} onClick={() => void linkByCode()}><Plugs size={15} />Link by code</button>
          <button type="button" className="btn" disabled={undo.length === 0} onClick={() => void undoTag()}><ArrowUUpLeft size={15} />Undo last tag{undo.length ? ` (${undo.length})` : ''}</button>
        </div>
        <Notice note={tagNote} />
        {tree.length === 0 ? <p className="muted">Import the plant tree first.</p> : (
          <table className="eco-table">
            <thead><tr><th>Plan</th><th>What</th><th>Plant node</th></tr></thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id} data-zone-row={z.id}>
                  <td>{z.id}</td><td>Zone · {z.kind}</td>
                  <td><select className="input" aria-label={`Plant node of zone ${z.id}`} value={current(z.meta)} onChange={(e) => void tag('zone', z.id, e.target.value)}><option value="">— not linked —</option>{options(ZONE_TYPES)}</select></td>
                </tr>
              ))}
              {rows.map((item) => (
                <tr key={item.id} data-item-row={item.id}>
                  <td>{item.id}</td><td>{project.catalog[item.definitionId]?.name ?? item.definitionId}</td>
                  <td><select className="input" aria-label={`Plant node of item ${item.id}`} value={current(item.meta)} onChange={(e) => void tag('item', item.id, e.target.value)}><option value="">— not linked —</option>{options(ITEM_TYPES)}</select></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="eco-card" aria-label="Link checks">
        <h2>Link checks</h2>
        <ul className="eco-checks">
          {checks.map((c) => (
            <li key={c.code} data-check={c.code} data-status={c.status}>
              <span className={`eco-status is-${c.status}`}>{c.status === 'pass' ? 'Passes' : c.status === 'fail' ? 'Fails' : 'Unknown'}</span>
              <span><strong>{c.title}.</strong> {c.message} <span className="muted">({c.source.title})</span></span>
            </li>
          ))}
        </ul>
      </section>

      <section className="eco-card" aria-label="Layout snapshot">
        <h2>Layout snapshot</h2>
        <p className="muted">Sends this plan (positions, sizes and tags) to GMES so manufacturing knows where its stations stand. Or save it as a file.</p>
        <div className="eco-row">
          <button type="button" className="btn accent" onClick={() => void sendToGmes()}><PaperPlaneTilt size={15} />Send to GMES</button>
          <button type="button" className="btn" onClick={() => void download()}><DownloadSimple size={15} />Download snapshot</button>
        </div>
        <Notice note={sendNote} />
      </section>

      <section className="eco-card" aria-label="Live plant view">
        <h2>Live plant view</h2>
        <p className="muted">Follows the lines tagged in this plan. This page listens to GMES directly; nothing is stored.</p>
        <div className="eco-row">
          <button type="button" className={`btn${live.status === 'off' ? '' : ' accent'}`} aria-pressed={live.status !== 'off'} onClick={() => (live.status === 'off' ? void startLive() : stopLive())}>
            {live.status === 'off' ? 'Live' : 'Stop live view'}
          </button>
        </div>
        <Notice note={liveNote} />
        {live.status !== 'off' && <LivePlan project={project} live={live} />}
      </section>
    </div>
  );
}
