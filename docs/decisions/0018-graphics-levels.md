# 0018 — Graphics levels for the 3D view

## Context

The 3D engine v2 (decision 0016) looked right but lagged on the owner's laptop. It only lightened
itself for browsers with no graphics chip at all; a laptop's built-in chip got the full cost:
twice the pixels, 2048–4096-pixel soft shadow maps, and a full extra ambient-occlusion render.

## Decision

- Three levels in `apps/editor/src/logic/graphics.ts`, kept per browser (like the control
  settings, never in the project):
  - **Fast**: normal resolution, no edge smoothing, no shadows, no reflections (brighter fill light
    instead).
  - **Balanced** (the default): normal resolution, sharp shadows at 1024 px indoors and 2048 px
    outdoors, reflections, no ambient occlusion.
  - **High**: the previous look (2× resolution, soft 2048/4096 px shadows, ambient occlusion).
- A button at the end of the 3D toolbar shows the level and moves to the next one. A change
  builds a new 3D canvas, because edge smoothing can only be set when a canvas is made, and keeps
  the camera where it was.
- While the person has never picked a level, the view adapts by itself. If at least 60% of the last
  40 moving frames take over 50 ms (under 20 frames a second), it drops one level. Browsers without
  a graphics chip start at Fast. Once a level is picked, the view never changes it.
- Report pictures follow the same level, at 1.5× resolution (2× on High).

## Consequences

`graphics.test.ts` checks that each level costs no more than the one above it, the step-down order,
and the slow-frame detector (a planted bug that fired on any single slow frame was caught). In the
browser suite the 3D drag journey, which used to time out at 45 s, now takes 29 s. Nothing in the
project data or the core changes.
