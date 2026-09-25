// Shared sample project + geometry for Atrium screens (editor + report).
export const ROOM = { w: 2400, d: 1600, h: 450 };
export const TYPES = {
  rt180: { name: 'Round table 180', cat: 'Tables', w: 180, d: 180, h: 75, round: true, seats: 10, clr: [0, 0, 0, 0] },
  stage: { name: 'Stage 9 × 3 m', cat: 'Stages', w: 900, d: 300, h: 60, clr: [90, 0, 0, 0] },
  dance: { name: 'Dance floor 5 × 5 m', cat: 'Stages', w: 500, d: 500, h: 2, clr: [0, 0, 0, 0] },
  dj: { name: 'DJ booth', cat: 'Equipment', w: 200, d: 100, h: 110, clr: [60, 60, 0, 0] },
  cake: { name: 'Cake table', cat: 'Service', w: 120, d: 120, h: 75, round: true, clr: [60, 60, 60, 60] },
  gift: { name: 'Gift table 180 × 80', cat: 'Service', w: 180, d: 80, h: 75, clr: [80, 0, 0, 0] },
  buffet: { name: 'Buffet table 240 × 80', cat: 'Service', w: 240, d: 80, h: 90, clr: [100, 0, 0, 0] },
};
export const ITEMS = [
  { id: 'ST-01', t: 'stage', x: 1200, y: 160, locked: true },
  { id: 'DF-01', t: 'dance', x: 1200, y: 710, locked: true },
  { id: 'DJ-01', t: 'dj', x: 1790, y: 90 },
  { id: 'T-01', t: 'rt180', x: 280, y: 560 }, { id: 'T-02', t: 'rt180', x: 680, y: 560 },
  { id: 'T-03', t: 'rt180', x: 280, y: 960 }, { id: 'T-04', t: 'rt180', x: 680, y: 960 },
  { id: 'T-05', t: 'rt180', x: 280, y: 1360 }, { id: 'T-06', t: 'rt180', x: 690, y: 1310 },
  { id: 'T-07', t: 'rt180', x: 1720, y: 560 }, { id: 'T-08', t: 'rt180', x: 2120, y: 560 },
  { id: 'T-09', t: 'rt180', x: 1720, y: 960 }, { id: 'T-10', t: 'rt180', x: 2120, y: 960 },
  { id: 'T-11', t: 'rt180', x: 1720, y: 1360 }, { id: 'T-12', t: 'rt180', x: 2120, y: 1360 },
  { id: 'CK-01', t: 'cake', x: 1200, y: 1180 },
  { id: 'GT-01', t: 'gift', x: 2330, y: 1040, rot: 90 },
  { id: 'BF-01', t: 'buffet', x: 950, y: 1540 }, { id: 'BF-02', t: 'buffet', x: 1200, y: 1540 }, { id: 'BF-03', t: 'buffet', x: 1450, y: 1540 },
];
export const DOORS = [
  { id: 'D-01', wall: 'West wall', side: 'west', at: 1000, w: 180, swing: 'Inward · hinge north' },
  { id: 'D-02', wall: 'East wall', side: 'east', at: 1000, w: 180, swing: 'Inward · hinge north' },
  { id: 'D-03', wall: 'South wall', side: 'south', at: 400, w: 200, swing: 'Inward · hinge west' },
];
export const COLUMNS = [
  { id: 'C-01', x: 800, y: 400, s: 60 }, { id: 'C-02', x: 1600, y: 400, s: 60 },
  { id: 'C-03', x: 800, y: 1200, s: 60 }, { id: 'C-04', x: 1600, y: 1200, s: 60 },
];

const W = ROOM.w, D = ROOM.d;
const pw = (v) => (v / W) * 100, pd = (v) => (v / D) * 100;
export function dims(it) {
  const ty = TYPES[it.t];
  const r = ((it.rot || 0) % 180) === 90;
  return { w: r ? ty.d : ty.w, d: r ? ty.w : ty.d, h: ty.h };
}
export function chairs(it) {
  const ty = TYPES[it.t];
  if (!ty.seats) return [];
  return Array.from({ length: ty.seats }, (_, i) => {
    const a = (i * 360) / ty.seats, rad = (a * Math.PI) / 180;
    return { x: it.x + 118 * Math.sin(rad), y: it.y - 118 * Math.cos(rad), a };
  });
}

/** Live checks. Returns findings with what / where / how far / required. */
export function check(items, resolved = {}) {
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  const out = [];
  const t6 = by['T-06'];
  if (t6 && !resolved.E1) {
    const d = Math.hypot(t6.x - 800, t6.y - 1200), over = Math.round(170 - d);
    if (over > 0) out.push({ id: 'E1', sev: 'error', group: 'Geometry', ids: ['T-06'], title: 'Table T-06 overlaps column C-03', where: 'West block · row 3', measured: over, required: 0, unit: 'cm', meter: 0.9, gap: `${over} cm overlap`, need: '0 cm overlap', fix: `Move T-06 at least ${over} cm away from the column.` });
  }
  const g = by['GT-01'];
  if (g && !resolved.E2) {
    const dm = dims(g), lo = Math.max(g.y - dm.d / 2, 910), hi = Math.min(g.y + dm.d / 2, 1090);
    if (g.x + dm.w / 2 > 2240 && hi - lo > 0) {
      const mv = Math.round(1090 + 90 - (g.y - dm.d / 2));
      out.push({ id: 'E2', sev: 'error', group: 'Doors & exits', ids: ['GT-01'], title: 'Gift table blocks the east door', where: 'East wall · door D-02', measured: Math.round(hi - lo), required: 0, unit: 'cm', meter: 0.8, gap: `Covers ${Math.round(hi - lo)} cm of the opening`, need: '90 cm clear', fix: `Move the gift table about ${mv} cm south.` });
    }
  }
  if (!resolved.W1) out.push({ id: 'W1', sev: 'warn', group: 'Paths & accessibility', ids: ['T-11', 'BF-03'], title: 'Narrow walkway to the south exit', where: 'Between T-11 and the buffet', measured: 96, required: 120, unit: 'cm', meter: 0.8, gap: 'Short by 24 cm', need: '120 cm wide', fix: 'Move T-11 north or shift the buffet west.' });
  if (!resolved.W2) out.push({ id: 'W2', sev: 'warn', group: 'Clearances', ids: ['DJ-01'], title: 'DJ booth needs more room behind it', where: 'North wall, east of the stage', measured: 40, required: 60, unit: 'cm', meter: 0.67, gap: 'Short by 20 cm', need: '60 cm behind', fix: 'Move the booth 20 cm south.' });
  if (!resolved.W3) out.push({ id: 'W3', sev: 'warn', group: 'Clearances', ids: ['ST-01', 'DJ-01'], title: 'Side access to the stage is tight', where: 'Between the stage and DJ booth', measured: 40, required: 90, unit: 'cm', meter: 0.44, gap: 'Short by 50 cm', need: '90 cm access', fix: 'Leave a 90 cm path to the stage steps.' });
  return out;
}

const INK = '#1a1917', ACC = '#2b54d0', ERR = '#b93a2e', WARN = '#9a6400';
/** Plan geometry, percent of the room box. */
export function plan(items, sel = [], findings = [], opts = {}) {
  const sev = {};
  findings.forEach((f) => f.ids.forEach((id) => { if (!sev[id] || f.sev === 'error') sev[id] = f.sev; }));
  const hidden = opts.hidden || {};
  const shapes = [], seats = [], badges = [];
  items.forEach((it) => {
    const ty = TYPES[it.t], dm = dims(it), s = sel.includes(it.id), e = sev[it.id];
    const layer = it.t === 'stage' || it.t === 'dance' || it.t === 'dj' ? 'stage' : it.t === 'rt180' ? 'furniture' : 'service';
    if (hidden[layer]) return;
    let bg = '#fdfcfa', bd = `1px solid ${INK}`, fg = '#5e5a52';
    if (it.t === 'stage') { bg = '#2b2a27'; fg = '#f3f2ee'; }
    if (it.t === 'dance') { bg = '#efede7'; fg = '#5e5a52'; }
    if (e === 'error') { bd = `1.5px dashed ${ERR}`; bg = it.t === 'stage' ? bg : '#fbeeec'; }
    else if (e === 'warn') { bd = `1.5px dashed ${WARN}`; }
    if (s) { bd = `1.5px solid ${ACC}`; bg = it.t === 'stage' ? '#233f9e' : '#e6ecfc'; fg = it.t === 'stage' ? '#fff' : ACC; }
    const label = it.t === 'rt180' ? it.id.replace('T-', '') : it.t === 'stage' ? 'Stage' : it.t === 'dance' ? 'Dance floor' : it.t === 'dj' ? 'DJ' : it.t === 'cake' ? 'Cake' : it.t === 'gift' ? 'Gifts' : 'Buffet';
    shapes.push({ id: it.id, it, l: pw(it.x - dm.w / 2), t: pd(it.y - dm.d / 2), w: pw(dm.w), h: pd(dm.d), r: ty.round ? '50%' : '1px', bg, bd, fg, label, fs: it.t === 'rt180' ? 'max(8px, .72cqw)' : 'max(9px, .82cqw)', locked: !!it.locked, lockDisp: it.locked && s ? 'flex' : 'none' });
    chairs(it).forEach((c, i) => seats.push({ key: it.id + i, l: pw(c.x - 22), t: pd(c.y - 22), w: pw(44), h: pd(44), a: c.a, bd: s ? `1px solid ${ACC}` : e === 'error' ? `1px dashed ${ERR}` : '1px solid #6f6a61', bg: s ? '#e6ecfc' : '#fdfcfa' }));
    if (e) badges.push({ id: it.id, l: pw(it.x + dm.w / 2), t: pd(it.y - dm.d / 2), bg: e === 'error' ? ERR : '#fff', fg: e === 'error' ? '#fff' : WARN, bd: e === 'error' ? ERR : WARN, icon: e === 'error' ? 'ph:x-bold' : 'ph:warning-bold' });
  });
  const cols = COLUMNS.map((c) => ({ id: c.id, l: pw(c.x - c.s / 2), t: pd(c.y - c.s / 2), w: pw(c.s), h: pd(c.s) }));
  const doors = DOORS.map((d) => {
    if (d.side === 'south') return { id: d.id, l: pw(d.at - d.w / 2), t: pd(D - d.w), w: pw(d.w), h: pd(d.w), leafL: '1.5px solid ' + INK, leafT: '0', arcR: '1px dashed #8b867c', arcT: '1px dashed #8b867c', arcB: '0', arcLft: '0', rad: '0 100% 0 0', gl: pw(d.at - d.w / 2), gt: 100, gw: pw(d.w), gh: '0.9cqw', gdx: '0', gdy: '0' };
    const east = d.side === 'east';
    return { id: d.id, l: east ? pw(W - d.w) : 0, t: pd(d.at - d.w / 2), w: pw(d.w), h: pd(d.w), leafL: '0', leafT: '1.5px solid ' + INK, arcR: east ? '0' : '1px dashed #8b867c', arcT: '0', arcB: '1px dashed #8b867c', arcLft: east ? '1px dashed #8b867c' : '0', rad: east ? '0 0 0 100%' : '0 0 100% 0', gl: east ? 100 : -0.9 * 100 / 100 * 0, gt: pd(d.at - d.w / 2), gw: '0.9cqw', gh: pd(d.w) + '%', side: d.side };
  }).map((d) => ({ ...d, gwS: typeof d.gw === 'number' ? d.gw + '%' : d.gw, ghS: typeof d.gh === 'number' ? d.gh + '%' : d.gh, glS: d.side === 'west' ? '-0.9cqw' : d.gl + '%', gtS: d.side === 'south' ? '100%' : d.gt + '%' }));
  const clears = [];
  if (!hidden.clearance) items.forEach((it) => {
    const ty = TYPES[it.t], dm = dims(it);
    if (!ty.clr[0] || it.t === 'stage') return;
    const f = ty.clr[0], back = ty.clr[1];
    if (it.rot === 90) clears.push({ key: it.id, l: pw(it.x - dm.w / 2 - f), t: pd(it.y - dm.d / 2), w: pw(f), h: pd(dm.d), c: sev[it.id] === 'error' ? 'rgba(185,58,46,.07)' : 'rgba(26,25,23,.035)' });
    else clears.push({ key: it.id, l: pw(it.x - dm.w / 2), t: pd(it.y - dm.d / 2 - (it.t === 'buffet' || it.t === 'gift' ? f : back)), w: pw(dm.w), h: pd(it.t === 'buffet' ? f : back || f), c: it.t === 'dj' ? 'rgba(154,100,0,.08)' : 'rgba(26,25,23,.035)' });
  });
  return { shapes, seats, badges, cols, doors, clears };
}

/** Axonometric CSS scene (px), 0.4 px per cm. */
export function scene(items, sel = [], findings = [], rz = -38) {
  const s = 0.4, sev = {};
  findings.forEach((f) => f.ids.forEach((id) => { if (!sev[id] || f.sev === 'error') sev[id] = f.sev; }));
  const east = rz > 0;
  const side = east ? { sl: '100%', sr: 'auto', so: 'left center', st: 'rotateY(-90deg)' } : { sl: 'auto', sr: '100%', so: 'right center', st: 'rotateY(90deg)' };
  const box = (key, l, t, w, h, z, top, sideC, frontC, extra = {}) => ({ key, l, t, w, h, z, zt: `translateZ(${z}px)`, top, sideC, frontC, r: '0', ...side, ...extra });
  const boxes = [], discs = [];
  const wallTop = '#2b2a27', wallF = '#d8d4cb', wallS = '#c7c2b7', T = 8, Z = 48;
  const WW = W * s, DD = D * s;
  boxes.push(box('wn', -T, -T, WW + 2 * T, T, Z, wallTop, wallS, wallF));
  boxes.push(box('ws1', -T, DD, 120 + T, T, Z, wallTop, wallS, wallF), box('ws2', 200, DD, WW - 200 + T, T, Z, wallTop, wallS, wallF));
  boxes.push(box('ww1', -T, 0, T, 364, Z, wallTop, wallS, wallF), box('ww2', -T, 436, T, DD - 436, Z, wallTop, wallS, wallF));
  boxes.push(box('we1', WW, 0, T, 364, Z, wallTop, wallS, wallF), box('we2', WW, 436, T, DD - 436, Z, wallTop, wallS, wallF));
  COLUMNS.forEach((c) => boxes.push(box(c.id, (c.x - 30) * s, (c.y - 30) * s, 24, 24, Z, wallTop, wallS, wallF)));
  items.forEach((it) => {
    const ty = TYPES[it.t], dm = dims(it), on = sel.includes(it.id), e = sev[it.id];
    const top = on ? '#cfdaf9' : e === 'error' ? '#f3d6d1' : it.t === 'stage' ? '#34322e' : it.t === 'dance' ? '#e9e6df' : '#fbfaf7';
    const sideC = on ? '#8ea3e3' : it.t === 'stage' ? '#1f1e1b' : '#d6d1c7', frontC = on ? '#a9bbef' : it.t === 'stage' ? '#26241f' : '#e3dfd6';
    const z = Math.max(1, ty.h * s);
    if (ty.round) discs.push({ key: it.id, id: it.id, l: (it.x - dm.w / 2) * s, t: (it.y - dm.d / 2) * s, w: dm.w * s, zt: `translateZ(${z}px)`, top: on ? '#dbe3fb' : e === 'error' ? '#f6dcd8' : '#ffffff', bd: on ? '1.5px solid ' + ACC : e === 'error' ? '1.5px solid ' + ERR : '1px solid #cfcac0' });
    else boxes.push(box(it.id, (it.x - dm.w / 2) * s, (it.y - dm.d / 2) * s, dm.w * s, dm.d * s, z, top, sideC, frontC, { id: it.id, bdTop: on ? '1.5px solid ' + ACC : '0' }));
    chairs(it).forEach((c, i) => boxes.push(box(it.id + 'c' + i, (c.x - 20) * s, (c.y - 20) * s, 16, 16, 18, on ? '#b8c7f3' : e === 'error' ? '#e6b5ad' : '#dcd7cd', on ? '#8ea3e3' : '#c4beb2', on ? '#a3b4ea' : '#cfc9be', { id: it.id })));
  });
  boxes.forEach((b) => { if (!b.bdTop) b.bdTop = '0'; });
  return { boxes, discs, WW, DD };
}

export const LIBRARY = {
  Tables: [
    { t: 'rt120', name: 'Round table 120', dims: '120 × 120 cm · 6 seats', shape: 'round', sz: 34 },
    { t: 'rt150', name: 'Round table 150', dims: '150 × 150 cm · 8 seats', shape: 'round', sz: 40 },
    { t: 'rt180', name: 'Round table 180', dims: '180 × 180 cm · 10 seats', shape: 'round', sz: 46 },
    { t: 'bq180', name: 'Banquet table 180 × 80', dims: '180 × 80 cm', shape: 'rect', w: 44, h: 20 },
    { t: 'bq240', name: 'Banquet table 240 × 80', dims: '240 × 80 cm', shape: 'rect', w: 56, h: 20 },
    { t: 'sq80', name: 'Square table 80', dims: '80 × 80 cm · 4 seats', shape: 'rect', w: 24, h: 24 },
    { t: 'ct60', name: 'Cocktail table 60', dims: '60 × 60 cm · 110 cm high', shape: 'round', sz: 20 },
    { t: 'serp', name: 'Serpentine table', dims: '150 × 75 cm', shape: 'rect', w: 40, h: 18 },
  ],
  Seating: [
    { t: 'ch', name: 'Banquet chair', dims: '44 × 44 cm', shape: 'rect', w: 14, h: 14 },
    { t: 'chx', name: 'Chiavari chair', dims: '40 × 42 cm', shape: 'rect', w: 13, h: 14 },
    { t: 'sofa', name: 'Lounge sofa', dims: '200 × 85 cm', shape: 'rect', w: 48, h: 20 },
    { t: 'arm', name: 'Armchair', dims: '80 × 80 cm', shape: 'rect', w: 22, h: 22 },
    { t: 'bench', name: 'Bench 180', dims: '180 × 40 cm', shape: 'rect', w: 44, h: 10 },
  ],
  Stages: [
    { t: 'stage', name: 'Stage 9 × 3 m', dims: '900 × 300 cm · 60 cm high', shape: 'rect', w: 60, h: 20, dark: true },
    { t: 'stage6', name: 'Stage 6 × 3 m', dims: '600 × 300 cm · 60 cm high', shape: 'rect', w: 46, h: 22, dark: true },
    { t: 'riser', name: 'Riser 2 × 1 m', dims: '200 × 100 cm · 40 cm high', shape: 'rect', w: 36, h: 18, dark: true },
    { t: 'dance', name: 'Dance floor 5 × 5 m', dims: '500 × 500 cm', shape: 'rect', w: 36, h: 36 },
    { t: 'dance4', name: 'Dance floor 4 × 4 m', dims: '400 × 400 cm', shape: 'rect', w: 30, h: 30 },
    { t: 'kosha', name: 'Bridal kosha', dims: '400 × 250 cm', shape: 'rect', w: 44, h: 26, dark: true },
  ],
  Service: [
    { t: 'buffet', name: 'Buffet table 240 × 80', dims: '240 × 80 cm · 100 cm front', shape: 'rect', w: 56, h: 20 },
    { t: 'bar', name: 'Bar counter', dims: '300 × 70 cm', shape: 'rect', w: 58, h: 16 },
    { t: 'cake', name: 'Cake table', dims: '120 × 120 cm', shape: 'round', sz: 32 },
    { t: 'gift', name: 'Gift table 180 × 80', dims: '180 × 80 cm', shape: 'rect', w: 44, h: 20 },
    { t: 'coffee', name: 'Coffee station', dims: '150 × 60 cm', shape: 'rect', w: 40, h: 16 },
    { t: 'reg', name: 'Registration desk', dims: '200 × 60 cm', shape: 'rect', w: 48, h: 16 },
  ],
  Equipment: [
    { t: 'dj', name: 'DJ booth', dims: '200 × 100 cm · 60 cm behind', shape: 'rect', w: 44, h: 22, dark: true },
    { t: 'spk', name: 'Speaker stack', dims: '60 × 60 cm', shape: 'rect', w: 18, h: 18, dark: true },
    { t: 'scr', name: 'Projection screen', dims: '400 × 30 cm', shape: 'rect', w: 58, h: 8, dark: true },
    { t: 'light', name: 'Lighting truss', dims: '600 × 30 cm', shape: 'rect', w: 60, h: 6, dark: true },
  ],
  Office: [
    { t: 'desk140', name: 'Desk 140 × 70', dims: '140 × 70 cm · 1 seat', shape: 'rect', w: 38, h: 20 },
    { t: 'desk160', name: 'Desk 160 × 80', dims: '160 × 80 cm · 1 seat', shape: 'rect', w: 42, h: 22 },
    { t: 'bench4', name: 'Bench desk × 4', dims: '280 × 160 cm · 4 seats', shape: 'rect', w: 54, h: 30 },
    { t: 'mt8', name: 'Meeting table 8', dims: '300 × 120 cm · 8 seats', shape: 'rect', w: 56, h: 24 },
    { t: 'task', name: 'Task chair', dims: '65 × 65 cm', shape: 'round', sz: 18 },
    { t: 'ped', name: 'Pedestal', dims: '42 × 60 cm', shape: 'rect', w: 14, h: 18 },
    { t: 'cab', name: 'Storage cabinet', dims: '100 × 45 cm', shape: 'rect', w: 30, h: 14, dark: true },
    { t: 'phone', name: 'Phone booth', dims: '120 × 120 cm', shape: 'rect', w: 28, h: 28, dark: true },
  ],
  Custom: [],
};
