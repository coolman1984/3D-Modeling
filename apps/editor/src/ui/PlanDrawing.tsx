import { add, boundsOf, footprintOf, itemPolygon, rectangle, rotate, type Id, type Issue, type Project } from '@space-planner/core';
import { formatCount } from '../logic/format.js';
import { fitViewport, pathOf, toScreen } from '../logic/viewport.js';

/**
 * A still, printable plan: walls, door swings, columns, items with the number of their line in
 * the bill of materials, issues highlighted, and metre rulers. Vector, so it prints sharp.
 */
export function PlanDrawing({ project, issues, keyOf, width, height }: { project: Project; issues: readonly Issue[]; keyOf: Readonly<Record<Id, number>>; width: number; height: number }) {
  const room = boundsOf(project.space.boundary);
  const v = fitViewport(room, width, height, 30);
  const items = Object.values(project.items).sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
  const flagged = new Map<Id, 'error' | 'warning'>();
  for (const issue of issues) {
    const first = issue.entityIds[0];
    if (!first || issue.severity === 'info') continue;
    if (issue.severity === 'error' || !flagged.has(first)) flagged.set(first, issue.severity);
  }
  const metre = 10_000;
  const grid: string[] = [];
  for (let x = Math.ceil(room.minX / metre) * metre; x <= room.maxX; x += metre) {
    const a = toScreen(v, { x, y: room.minY });
    const b = toScreen(v, { x, y: room.maxY });
    grid.push(`M${a.x.toFixed(1)},${a.y.toFixed(1)}V${b.y.toFixed(1)}`);
  }
  for (let y = Math.ceil(room.minY / metre) * metre; y <= room.maxY; y += metre) {
    const a = toScreen(v, { x: room.minX, y });
    const b = toScreen(v, { x: room.maxX, y });
    grid.push(`M${a.x.toFixed(1)},${a.y.toFixed(1)}H${b.x.toFixed(1)}`);
  }
  const wall = Math.min(10, Math.max(3, 2_000 * v.scale));
  return (
    <svg className="plan-drawing" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Plan seen from above">
      <defs>
        <pattern id="report-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" className="hatch-line" />
        </pattern>
      </defs>
      <path d={pathOf(v, project.space.boundary)} className="wall" style={{ strokeWidth: wall * 2 }} />
      <path d={pathOf(v, project.space.boundary)} className="floor" />
      <path d={grid.join('')} className="grid" />
      {(project.space.zones ?? []).map((z) => (
        <path key={z.id} d={pathOf(v, z.polygon)} className={`zone-area zone-${z.kind}`} data-report-zone={z.id} />
      ))}
      {project.space.obstacles.map((o) => (
        <path key={o.id} d={pathOf(v, o.polygon)} className={o.kind === 'column' ? 'column' : 'blocked-zone'} style={o.kind === 'column' ? undefined : { fill: 'url(#report-hatch)' }} />
      ))}
      {project.space.doors.map((d) => {
        const h = toScreen(v, d.hinge);
        const c = toScreen(v, add(d.hinge, rotate({ x: d.width, y: 0 }, d.angle)));
        const o = toScreen(v, add(d.hinge, rotate({ x: d.width, y: 0 }, d.angle + (d.swing === 'left' ? 90_000 : -90_000))));
        const r = d.width * v.scale;
        return (
          <g key={d.id}>
            <line x1={h.x} y1={h.y} x2={c.x} y2={c.y} style={{ stroke: '#fff', strokeWidth: wall * 2 + 2 }} />
            <path d={`M${c.x.toFixed(1)},${c.y.toFixed(1)}A${r.toFixed(1)},${r.toFixed(1)} 0 0 ${d.swing === 'left' ? 0 : 1} ${o.x.toFixed(1)},${o.y.toFixed(1)}`} className="door-arc" />
            <line x1={h.x} y1={h.y} x2={o.x} y2={o.y} className="door-leaf" />
          </g>
        );
      })}
      {items.map((item) => {
        const definition = project.catalog[item.definitionId];
        if (!definition) return null;
        const outline = rectangle(footprintOf(item, definition));
        const front = [toScreen(v, outline[2]!), toScreen(v, outline[3]!)];
        const centre = toScreen(v, item.position);
        const small = Math.min(definition.size.w, definition.size.d) * v.scale;
        return (
          <g key={item.id} className={`item shape-${definition.category} ${flagged.get(item.id) ?? ''} ${item.elevation ? 'raised' : ''}`.trim()} data-report-item={item.id}>
            <path d={pathOf(v, itemPolygon(item, definition))} className="item-body" />
            <line x1={front[0]!.x} y1={front[0]!.y} x2={front[1]!.x} y2={front[1]!.y} className="item-front" />
            {small >= 11 && (
              <text x={centre.x} y={centre.y} className="item-key" style={{ fontSize: Math.min(12, small * 0.6), fill: definition.category === 'stage' ? '#fff' : undefined }}>
                {formatCount(keyOf[item.id] ?? 0)}
              </text>
            )}
          </g>
        );
      })}
      <g className="north" transform={`translate(${width - 16},${18})`}>
        <path d="M0,-11 L5,5 L0,2 L-5,5 Z" />
        <text y={18}>N</text>
      </g>
    </svg>
  );
}
