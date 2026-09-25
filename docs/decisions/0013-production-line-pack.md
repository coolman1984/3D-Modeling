# 0013: Production line pack and line simulation

**Date:** 2026-09-25 · **Status:** accepted

## Context

T8 (plan §7): machines with operating and maintenance clearance, stations, buffers, conveyors,
sources and sinks, directed flows, flow length and crossings; spatial feasibility kept apart from
operation; a `SimulationPort` with a small deterministic discrete-event simulator. The brief:
"Never infer production throughput from the drawing alone."

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Stations | Items whose type `meta` has `station` (source, machine, buffer, conveyor, sink), `cycle` (ms: release interval, cycle, transit time), `capacity`, `maintFront/Back/Left/Right` (ticks), `inSide/outSide` (default back → front; conveyors left → right). Operating space is the core clearance | No core change: pack data in `meta`, as decided at T5 |
| Flows | Item `meta.next`: the ids of the stations parts go to, separated by spaces. Broken or dangling flows are a rule result, not a rejected command | Flows are pack meaning; the core keeps references it knows about (catalog) and nothing else |
| Placement rules | maintenance access (maintenance space free of items, columns and walls), flow links (every station on a path from a source to a sink; every flow names a station), flow path (material can be moved along every flow with the chosen handling equipment — the pack's styles: hand cart 90 cm, pallet truck 140 cm, forklift 220 cm, common guidance), flow crossings (straight flows that cross, company-policy / lean practice). Unknown without stations, flows or maintenance data | Geometry only; each names its source |
| Ports | 40 cm outside the in / out side; the handling route ends at the best reachable cell within half the equipment's width plus a cell of the port | A cart never stands exactly at a machine's side; requiring that made every flow look blocked |
| Simulator | `simulateLine` in `packages/industry`: integer ms, (time, sequence) event order, no randomness. Machines hold one part (busy → blocked when nobody can take it → idle/starved); buffers FIFO up to capacity; conveyors FIFO with a minimum transit time; sinks count. Splits go to the successor that has taken the fewest parts, then list order; merges serve the holder waiting longest. Results: parts, per hour, time-weighted WIP, per station busy / blocked / starved / out / average content, bottleneck (busiest machine) | Deterministic and explainable; shared by later packs |
| No guessing | Missing cycle time or capacity, unknown flow targets, no source or sink → the simulator refuses and names the stations; figures show "unknown" | The drawing alone never gives a throughput |
| Transport time | Zero between stations unless a conveyor is placed between them; distances on the drawing are not converted into time | Speed and handling time are operational data nobody entered |
| Port | `SimulationPort<Options, Result>` next to `OptimizationPort`; `lineSimulator` implements it | Same pattern as the packer: tools compute, people and agents decide |
| UI | Line panel (stations in flow order, flow length, crossings, simulate N hours with busy / blocked / waiting bars), flow section in the inspector (send parts to…, cycle, capacity, maintenance), arrows on the plan (red when crossing), maintenance space dashed, machine and conveyor models in 3D, report cover with a simulated shift | Same Atrium shell |

## Consequences

- Hand-checked references: 59 parts/h-1 for a 60 s machine fed every 30 s; 39 for 60 s + 90 s in
  series; 118 for two 60 s machines in parallel; 27 through a 45 s conveyor in 10 min; 318 in an
  8 h shift for the sample line. A property test bounds a serial line by its slowest machine and
  checks part conservation and repeatability.
- Not modelled yet: breakdowns and setup times (would need random or scheduled events — a
  seeded generator can be added without losing determinism), shifts and breaks, operators shared
  between machines, batch sizes, rework loops beyond what buffers allow, transport by vehicles.
- Flow crossings use straight lines between ports; routed paths may cross or not differently.
