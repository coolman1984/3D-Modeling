# 0002: Browser editor stack

**Date:** 2026-09-25 · **Status:** accepted

## Context

Stage T1 needs a browser plan editor on top of the pure core. The master plan suggests
React + TypeScript + Vite with Konva for the 2D canvas.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| App | `apps/editor`: React 19 + TypeScript + Vite | Matches the master plan; the core is consumed as TypeScript source |
| 2D drawing | Plain SVG, no canvas library (Konva deferred) | Hundreds of items draw and drag smoothly in SVG; one less dependency; the DOM makes browser tests simple. Revisit with a measured slowdown |
| State | `useReducer` over a pure session reducer (`src/logic/session.ts`) wrapping the core history | Every change is a core command; the reducer is unit-tested without a browser |
| Dragging | Preview with `apply()` without touching history; one `item.move` on drop | Live issues while dragging; one undo step per drag |
| New items | Nearest free spot around the view centre (`findFreeSpot`) | Items never land on a column or on each other |
| Persistence | Autosave in browser storage (best effort) + save/open JSON file via the core serializer | Storage can be blocked or cleared; the file is the real copy |
| Language | Arabic UI, right-to-left panels; the plan keeps X east, Y north | The owner and first users read Arabic |
| Browser tests | Playwright against the production build; screenshots kept as CI artifacts | Proves the real journey and gives the owner pictures of each change |

## Consequences

- Wall editing, doors and columns placement, multi-select and copy are not in T1.
- If SVG slows down above roughly 2,000 items, move the item layer to a canvas renderer
  behind the same `PlanCanvas` props.
