import { boundsOf, itemPolygon, type Project, type Vec2 } from '@space-planner/core';
import { ecoTagOf } from '@space-planner/starter';
import { fitViewport, pathOf } from '../logic/viewport.js';
import { liveCaption, STATE_WORD, type LiveView } from './live.js';

const WIDTH = 900;
const HEIGHT = 480;

const centroid = (polygon: readonly Vec2[]): Vec2 => ({
  x: polygon.reduce((s, p) => s + p.x, 0) / polygon.length,
  y: polygon.reduce((s, p) => s + p.y, 0) / polygon.length,
});

/**
 * The plan seen from above with GMES's live state on it: a tagged station is coloured by what it is doing (running green, stopped
 * red with its reason, held amber, starved grey) and a zone tagged with a line shows that line's good and scrap counts of the
 * production day. Nothing is stored; a dropped connection greys the picture and says when the last update was.
 */
export function LivePlan({ project, live }: { project: Project; live: LiveView }) {
  const v = fitViewport(boundsOf(project.space.boundary), WIDTH, HEIGHT, 24);
  const stale = live.status === 'lost';
  return (
    <figure className="live-plan" data-testid="live-plan" data-status={live.status}>
      <figcaption className={`live-caption is-${live.status}`} role="status" data-testid="live-caption">{liveCaption(live)}</figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Plan with the live state of the stations" className={stale ? 'is-stale' : undefined}>
        <path d={pathOf(v, project.space.boundary)} className="live-floor" />
        {(project.space.zones ?? []).map((zone) => {
          const tag = ecoTagOf(zone.meta);
          const output = tag ? live.output[tag.code] : undefined;
          const c = centroid(zone.polygon);
          const at = { x: c.x * v.scale + v.offsetX, y: -c.y * v.scale + v.offsetY };
          return (
            <g key={zone.id} data-zone-id={zone.id}>
              <path d={pathOf(v, zone.polygon)} className="live-zone" />
              {tag && output && (
                <text x={at.x} y={at.y} className="live-output" textAnchor="middle" data-testid={`output-${tag.code}`}>
                  {tag.code} · good {output.good} · scrap {output.scrap}
                </text>
              )}
            </g>
          );
        })}
        {Object.values(project.items).map((item) => {
          const definition = project.catalog[item.definitionId];
          if (!definition) return null;
          const tag = ecoTagOf(item.meta);
          const state = tag ? live.stations[tag.code] : undefined;
          const tip = tag ? `${tag.code}: ${state ? STATE_WORD[state.state] : 'no live state yet'}${state?.reason ? ` — ${state.reason}` : ''}${state?.since ? ` (since ${state.since})` : ''}` : item.id;
          return (
            <path key={item.id} d={pathOf(v, itemPolygon(item, definition))} className={`live-item${state ? ` live-${state.state}` : tag ? ' live-linked' : ''}`}
              data-item-id={item.id} data-state={state?.state ?? (tag ? 'unknown' : 'untagged')}>
              <title>{tip}</title>
            </path>
          );
        })}
      </svg>
      <ul className="live-legend" aria-label="Legend">
        {(['running', 'stopped', 'held', 'starved'] as const).map((s) => (
          <li key={s}><span className={`live-swatch live-${s}`} />{STATE_WORD[s]}</li>
        ))}
      </ul>
    </figure>
  );
}
