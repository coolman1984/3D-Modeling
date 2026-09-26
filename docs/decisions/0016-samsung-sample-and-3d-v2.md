# 0016 — Samsung Egypt sample company, site pack and 3D engine v2 (D2)

## Context

After the Nile Gate demo (decision 0015) the owner asked for a second, recognisable sample: the
Samsung Electronics Egypt factory in Beni Suef, covering the whole company (campus, production,
warehouse, HR, meetings, events, canteen, export) and a visibly better, faster 3D view for both
samples. No floor plans of the real site are public.

## Decision

- **Sample companies are a list** (`SAMPLE_COMPANIES` in `sampleCompanies.ts`): each has an id,
  name, description and a deterministic `build()`. `POST /api/samples/:id` stores a company's
  projects through the store with actor "Sample data"; `GET /api/samples` lists them. Projects keep
  the company id in a new nullable `collection` column (added in place to older databases by
  `ALTER TABLE`), and the projects page groups by it. No change to the project save format.
- **Illustrative, labelled as such.** `samsung.ts` builds ten projects from public figures only
  (below). Building positions, room layouts and line lengths are a planner's illustration with
  typical industry sizes, not a survey; project names say "illustrative" where it matters.
- **A `site` pack** for whole campuses: a building is one item with its outer size (its inside is
  its own project); roads, lawns, plazas and yards are zones; staff parking reuses the depot bays
  and the Dubins bay-entry rule (decision 0013). New rule `building-boundary` (engineering source):
  a building stands inside the plot and off marked roads and lanes. Bus bays get a coach as the
  reference vehicle.
- **Bay entry fixes** found while building the transport yard: the vehicle now stops with its body
  centred on the bay (it used to stop on its rear reference point, 1.1–3 m too far), every non-vehicle
  item is an obstacle, and obstacles are prefiltered by the path's bounding box (speed).
- **New shapes** in the shared list (bus, tree, building, lamp, canopy, flag, barrier, wall,
  glass-wall, screen, machine, conveyor, workbench, locker, vending); `tree` and `lamp` are round.
  The 2D plan gives each a fill; the 3D view has a model for each (`models3d.ts`).
- **3D engine v2 without new dependencies** (all from the existing `three` package's examples):
  procedural PBR canvas textures (concrete, epoxy, asphalt, grass, carpet, tile, marble, pavers,
  cladding, precast, plaster) cached and shared; physical sky, low sun and haze for outdoor packs
  (site, depot), studio light indoors; ground-truth ambient occlusion (GTAO) rendered once when the
  camera rests; render on demand (no frame loop while idle); shadow maps redrawn only when the scene
  changes; model parts merged per material and repeated items instanced. Browsers that draw WebGL in
  software get a `low` quality tier: no AO, smaller shadow maps.

## Public facts used (checked 2026-09-26)

- Site of 336,000 m² in the Kom Abu Radi industrial zone, Al Wasta, Beni Suef; Samsung's first
  factory in the Middle East and Africa — [North Africa Post](https://northafricapost.com/3641-samsung-factory-to-supply-me-and-africa-from-egypt.html);
  plot 98, engineering sector — [Panjiva supplier record](https://panjiva.com/Samsung-Electronics-Egypt/88418849).
- TVs, phones and tablets; about 85–90% exported to 60+ countries —
  [Daily News Egypt, June 2026](https://www.dailynewsegypt.com/2026/06/21/minister-of-industry-reviews-production-at-elaraby-samsung-factories-in-beni-suef/).
- Golden licence for a phone factory; planned on 6,000 m², about 9,000 m² after the 2025 expansion —
  [Ahram Online](https://english.ahram.org.eg/News/507524.aspx), [SIS](https://sis.gov.eg/en/media-center/news/cabinet-agrees-to-grant-samsung-egypt-golden-license-to-establish-cellphone-factory/),
  [Tech Review Africa](https://techreviewafrica.com/news/5270/egypts-communications-minister-inspects-samsung-factory-expansion-in-beni-suef).
- Not confirmed by a primary source in this stage: the "since 2013" and "24″–82″" figures and the
  "about 5,000 jobs" figure in the `samsung.ts` header. They only colour descriptions; no rule or
  number depends on them.

## Consequences

`samsung.test.ts` (29 tests): every project valid, saves and opens, no design errors, every rule of
its pack passes, the campus area matches 336,000 m², the phone plant is 9,000 m² with 12 stations
and 11 reachable flow segments, the warehouse holds 2,160 positions, free bus and car bays a coach
and a car can drive into, deterministic across builds. The production and depot "floor area"
metrics were 100× too small (30 × 8 m showed 2.4 m²) and now use the same computation as the
warehouse and restaurant. The core is unchanged.
