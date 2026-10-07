import type { ItemDefinition } from '@space-planner/core';
import type { ReactNode } from 'react';

/**
 * Plan symbols for the home pack (decision 0027): the drawing conventions an interior designer
 * reads at a glance — a bed with pillows and a turned-back duvet, sofa cushions, a tub, a toilet,
 * burners on a hob. Drawn in the item's own frame in ticks, centred, front at −y (up on screen at
 * rotation 0), so the caller only has to place, turn and scale them. Thin, non-scaling lines on
 * top of the item's body, which stays the hit target and carries the selection and issue colours.
 */

const CM = 100; // ticks per centimetre

/** Soft fill of a piece in the plan: its fabric or wood, mixed into the paper colour. */
export function homeFill(def: ItemDefinition): string | undefined {
  const fabric = typeof def.meta?.fabric === 'number' ? (def.meta.fabric as number) : undefined;
  const woods: Record<string, number> = { oak: 0xc49a6c, walnut: 0x7a5236, white: 0xf3f1ec, black: 0x2a2b2e, marble: 0xe9e5de };
  const base = fabric ?? (typeof def.meta?.wood === 'string' ? woods[def.meta.wood as string] : undefined);
  if (base === undefined) return undefined;
  // Mixed with the paper, so the plan keeps its tone on a light or a dark page.
  const share = def.category === 'rug' ? 45 : 32;
  return `color-mix(in srgb, #${base.toString(16).padStart(6, '0')} ${share}%, var(--paper))`;
}

const line = { fill: 'none', stroke: 'var(--ink-2)', strokeWidth: 0.8, vectorEffect: 'non-scaling-stroke' as const };
const faint = { ...line, stroke: 'var(--ink-3)', strokeWidth: 0.6 };
const dashed = { ...faint, strokeDasharray: '3 3' };

function R(x: number, y: number, w: number, h: number, r = 0, style: object = line) {
  return <rect x={x} y={y} width={Math.max(0, w)} height={Math.max(0, h)} rx={r} {...style} />;
}

/** The symbol of a home item type, or null when it has none (it is then drawn as a plain box). */
export function homeSymbol(def: ItemDefinition): ReactNode | null {
  if (!def.id.startsWith('home-') && def.meta?.fabric === undefined) return null;
  const W = def.size.w;
  const D = def.size.d;
  const x0 = -W / 2;
  const y0 = -D / 2; // front
  const round = def.footprint === 'round';
  switch (def.category) {
    case 'bed': {
      const head = 8 * CM;
      const pillowW = W > 120 * CM ? (W - 20 * CM) / 2 : W - 16 * CM;
      const pillows = W > 120 * CM ? [x0 + 7 * CM, x0 + 13 * CM + pillowW] : [x0 + 8 * CM];
      const fold = y0 + D * 0.42;
      return (
        <>
          {R(x0, D / 2 - head, W, head, 2 * CM)}
          {pillows.map((x) => <g key={x}>{R(x, D / 2 - head - 40 * CM, pillowW, 32 * CM, 8 * CM, faint)}</g>)}
          <line x1={x0 + 3 * CM} y1={fold} x2={W / 2 - 3 * CM} y2={fold} {...faint} />
          <path d={`M${W / 2 - 3 * CM},${fold} L${W / 2 - 3 * CM - 45 * CM},${fold} L${W / 2 - 3 * CM},${fold - 35 * CM}`} {...line} />
        </>
      );
    }
    case 'sofa':
    case 'armchair': {
      const back = Math.min(24 * CM, D * 0.28);
      const arm = def.category === 'armchair' ? 13 * CM : Math.min(20 * CM, W * 0.1);
      const n = def.category === 'armchair' ? 1 : W > 190 * CM ? 3 : W > 130 * CM ? 2 : 1;
      const inner = W - arm * 2;
      return (
        <>
          {R(x0 + arm, D / 2 - back, inner, back, 4 * CM)}
          {R(x0, y0 + 4 * CM, arm, D - 4 * CM, 6 * CM)}
          {R(W / 2 - arm, y0 + 4 * CM, arm, D - 4 * CM, 6 * CM)}
          {Array.from({ length: n }, (_, k) => <g key={k}>{R(x0 + arm + (inner / n) * k + CM, y0 + 4 * CM, inner / n - 2 * CM, D - back - 6 * CM, 5 * CM, faint)}</g>)}
        </>
      );
    }
    case 'sectional': {
      const run = 98 * CM;
      const chaise = 95 * CM;
      const back = 24 * CM;
      return (
        <>
          <path d={`M${x0},${D / 2} L${W / 2},${D / 2} L${W / 2},${D / 2 - run} L${x0 + chaise},${D / 2 - run} L${x0 + chaise},${y0} L${x0},${y0} Z`} {...line} />
          {R(x0 + 20 * CM, D / 2 - back, W - 40 * CM, back, 4 * CM, faint)}
          {[0, 1, 2].map((k) => {
            const inner = W - chaise - 20 * CM;
            return <g key={k}>{R(x0 + chaise + (inner / 3) * k + CM, D / 2 - run + 2 * CM, inner / 3 - 2 * CM, run - back - 4 * CM, 5 * CM, faint)}</g>;
          })}
          {R(x0 + 21 * CM, y0 + 2 * CM, chaise - 23 * CM, D - back - 4 * CM, 5 * CM, faint)}
        </>
      );
    }
    case 'dining-set': {
      const seats = def.seats ?? 4;
      if (round) {
        const r = Math.min(W, D) / 2 - 42 * CM;
        return (
          <>
            <circle r={r} {...line} />
            {Array.from({ length: seats }, (_, k) => {
              const a = (k / seats) * Math.PI * 2 + Math.PI / 4;
              return <rect key={k} x={-23 * CM} y={-23 * CM} width={46 * CM} height={46 * CM} rx={6 * CM} transform={`translate(${Math.sin(a) * (r + 12 * CM)},${-Math.cos(a) * (r + 12 * CM)}) rotate(${(a * 180) / Math.PI})`} {...faint} />;
            })}
          </>
        );
      }
      const tableD = Math.max(80 * CM, D - 110 * CM);
      const per = Math.max(1, Math.round(seats / 2));
      return (
        <>
          {R(x0, -tableD / 2, W, tableD, CM)}
          {[-1, 1].flatMap((side) =>
            Array.from({ length: per }, (_, k) => {
              const cx = x0 + (W / per) * (k + 0.5);
              const cy = side * (tableD / 2 + 12 * CM);
              return <g key={`${side}-${k}`}>{R(cx - 23 * CM, cy - 23 * CM, 46 * CM, 46 * CM, 6 * CM, faint)}</g>;
            }),
          )}
        </>
      );
    }
    case 'coffee-table':
    case 'side-table':
      return round ? <circle r={W / 2 - 4 * CM} {...faint} /> : R(x0 + 6 * CM, y0 + 6 * CM, W - 12 * CM, D - 12 * CM, CM, faint);
    case 'nightstand':
      return <circle r={Math.min(W, D) * 0.28} {...faint} />;
    case 'wardrobe':
    case 'dresser':
    case 'sideboard': {
      const doors = Math.max(2, Math.round(W / (def.category === 'wardrobe' ? 50 * CM : 45 * CM)));
      return (
        <>
          {Array.from({ length: doors - 1 }, (_, k) => <line key={k} x1={x0 + (W / doors) * (k + 1)} y1={y0} x2={x0 + (W / doors) * (k + 1)} y2={y0 + 6 * CM} {...faint} />)}
          {def.category === 'wardrobe' && <line x1={x0 + 6 * CM} y1={0} x2={W / 2 - 6 * CM} y2={0} {...dashed} />}
        </>
      );
    }
    case 'bookcase':
      return Array.from({ length: 3 }, (_, k) => <line key={k} x1={x0 + (W / 4) * (k + 1)} y1={y0} x2={x0 + (W / 4) * (k + 1)} y2={D / 2} {...faint} />);
    case 'tv-unit':
      return (
        <>
          {R(-W * 0.4, -2 * CM, W * 0.8, 4 * CM, 0, line)}
          <line x1={x0} y1={y0 + 3 * CM} x2={W / 2} y2={y0 + 3 * CM} {...faint} />
        </>
      );
    case 'kitchen': {
      const sinkX = -W * 0.22;
      const hobX = W * 0.22;
      return (
        <>
          {R(sinkX - 25 * CM, y0 + 10 * CM, 50 * CM, 38 * CM, 4 * CM)}
          <circle cx={sinkX} cy={y0 + 29 * CM} r={2 * CM} {...faint} />
          {[[-15, -10, 9], [15, -10, 7], [-15, 12, 7], [15, 12, 9]].map(([dx, dz, r]) => <circle key={`${dx}${dz}`} cx={hobX + dx! * CM} cy={y0 + 31 * CM + dz! * CM} r={r! * CM} {...faint} />)}
          <line x1={x0} y1={D / 2 - 35 * CM} x2={W / 2} y2={D / 2 - 35 * CM} {...dashed} />
        </>
      );
    }
    case 'island': {
      const seats = def.seats ?? 3;
      return (
        <>
          <line x1={x0} y1={y0 + 28 * CM} x2={W / 2} y2={y0 + 28 * CM} {...faint} />
          {Array.from({ length: seats }, (_, k) => <circle key={k} cx={x0 + (W / seats) * (k + 0.5)} cy={y0 - 5 * CM} r={18 * CM} {...faint} />)}
        </>
      );
    }
    case 'fridge':
      return <path d={`M${x0 + 4 * CM},${y0 + 4 * CM} L${W / 2 - 4 * CM},${D / 2 - 4 * CM} M${W / 2 - 4 * CM},${y0 + 4 * CM} L${x0 + 4 * CM},${D / 2 - 4 * CM}`} {...faint} />;
    case 'bathtub':
      return (
        <>
          {R(x0 + 6 * CM, y0 + 6 * CM, W - 12 * CM, D - 12 * CM, Math.min(D, W) * 0.4)}
          <circle cx={W / 2 - 20 * CM} cy={0} r={2.5 * CM} {...faint} />
        </>
      );
    case 'shower':
      return (
        <>
          <path d={`M${x0},${y0} L${W / 2},${D / 2} M${W / 2},${y0} L${x0},${D / 2}`} {...faint} />
          <circle r={3 * CM} {...line} />
        </>
      );
    case 'toilet':
      return (
        <>
          {R(x0, D / 2 - 10 * CM, W, 10 * CM, 2 * CM)}
          <ellipse cx={0} cy={y0 + (D - 10 * CM) / 2} rx={W / 2 - 2 * CM} ry={(D - 10 * CM) / 2 - CM} {...line} />
        </>
      );
    case 'basin':
      return (
        <>
          <ellipse cx={0} cy={-2 * CM} rx={W * 0.28} ry={D * 0.3} {...line} />
          <circle cx={0} cy={D / 2 - 6 * CM} r={1.5 * CM} {...faint} />
        </>
      );
    case 'washer':
      return <circle r={Math.min(W, D) * 0.32} {...line} />;
    case 'rug':
      return round ? <circle r={W / 2 - 10 * CM} {...dashed} /> : R(x0 + 10 * CM, y0 + 10 * CM, W - 20 * CM, D - 20 * CM, 0, dashed);
    case 'floor-lamp':
      return def.meta?.style === 'arc' ? (
        <>
          <circle r={W / 2 - 3 * CM} {...faint} />
          <line x1={0} y1={0} x2={0} y2={-150 * CM} {...dashed} />
          <circle cx={0} cy={-150 * CM} r={20 * CM} {...dashed} />
        </>
      ) : (
        <>
          <circle r={W / 2 - 4 * CM} {...faint} />
          <path d={`M${-W * 0.3},0 L${W * 0.3},0 M0,${-W * 0.3} L0,${W * 0.3}`} {...faint} />
        </>
      );
    case 'house-plant':
      return Array.from({ length: 6 }, (_, k) => {
        const a = (k / 6) * Math.PI * 2;
        return <ellipse key={k} cx={Math.cos(a) * W * 0.22} cy={Math.sin(a) * W * 0.22} rx={W * 0.18} ry={W * 0.08} transform={`rotate(${(a * 180) / Math.PI} ${Math.cos(a) * W * 0.22} ${Math.sin(a) * W * 0.22})`} {...faint} />;
      });
    case 'pendant':
      return (
        <>
          <circle r={W / 2} {...dashed} />
          <path d={`M${-W * 0.35},${-W * 0.35} L${W * 0.35},${W * 0.35} M${W * 0.35},${-W * 0.35} L${-W * 0.35},${W * 0.35}`} {...dashed} />
        </>
      );
    case 'curtains':
      return <path d={Array.from({ length: 13 }, (_, k) => `${k ? 'L' : 'M'}${x0 + (W / 12) * k},${k % 2 ? -D / 3 : D / 3}`).join(' ')} {...faint} />;
    default:
      return null;
  }
}
