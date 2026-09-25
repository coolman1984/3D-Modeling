import { boundsOf, doorPolygon, footprintOf, itemPolygon, rectangle, type Id, type Issue, type Project } from '@space-planner/core';
import { formatCount, formatLength } from '../logic/format.js';
import { fitViewport, pathOf, toScreen } from '../logic/viewport.js';

/**
 * A still, printable plan: walls, doors, columns, items with the number of their line in the
 * bill of materials, issues highlighted, and the room's sizes. Vector, so it prints sharp.
 */
export function PlanDrawing({ project, issues, keyOf, width, height }: { project: Project; issues: readonly Issue[]; keyOf: Readonly<Record<Id, number>>; width: number; height: number }) {
  const room = boundsOf(project.space.boundary);
  const v = fitViewport(room, width, height, 36);
  const topLeft = toScreen(v, { x: room.minX, y: room.maxY });
  const bottomRight = toScreen(v, { x: room.maxX, y: room.minY });
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
  return (
    <svg className="plan-drawing" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="المخطط من فوق">
      <defs>
        <pattern id="report-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" className="hatch-line" />
        </pattern>
      </defs>
      <path d={pathOf(v, project.space.boundary)} className="floor" />
      <path d={grid.join('')} className="grid" />
      <path d={pathOf(v, project.space.boundary)} className="wall" />
      {project.space.obstacles.map((o) => (
        <path key={o.id} d={pathOf(v, o.polygon)} className="obstacle" style={{ fill: 'url(#report-hatch)' }} />
      ))}
      {project.space.doors.map((d) => (
        <path key={d.id} d={pathOf(v, doorPolygon(d))} className="door" />
      ))}
      {items.map((item) => {
        const definition = project.catalog[item.definitionId];
        if (!definition) return null;
        const outline = rectangle(footprintOf(item, definition));
        const front = [toScreen(v, outline[2]!), toScreen(v, outline[3]!)];
        const centre = toScreen(v, item.position);
        const small = Math.min(definition.size.w, definition.size.d) * v.scale;
        return (
          <g key={item.id} className={`item ${flagged.get(item.id) ?? ''} ${item.elevation ? 'raised' : ''}`.trim()} data-report-item={item.id}>
            <path d={pathOf(v, itemPolygon(item, definition))} className="item-body" />
            <line x1={front[0]!.x} y1={front[0]!.y} x2={front[1]!.x} y2={front[1]!.y} className="item-front" />
            {small >= 11 && (
              <text x={centre.x} y={centre.y} className="item-key" style={{ fontSize: Math.min(12, small * 0.6) }}>
                {formatCount(keyOf[item.id] ?? 0)}
              </text>
            )}
          </g>
        );
      })}
      <text x={(topLeft.x + bottomRight.x) / 2} y={topLeft.y - 10} className="dimension">
        {formatLength(room.maxX - room.minX)}
      </text>
      <text x={bottomRight.x + 6} y={(topLeft.y + bottomRight.y) / 2} className="dimension side">
        {formatLength(room.maxY - room.minY)}
      </text>
      <g className="north" transform={`translate(${width - 22},${22})`}>
        <path d="M0,-12 L6,6 L0,2 L-6,6 Z" />
        <text y={20}>ش</text>
      </g>
    </svg>
  );
}
