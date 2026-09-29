# Container stuffing: practice and figures (research note)

**29 September 2026**, for the S1 shipment work (decision 0021). This is common guidance collected
from public sources, not verified regulation. The container rules in `packages/starter` keep their
`RuleSource` kind "common-guidance".

## The reference: CTU Code

The IMO/ILO/UNECE *Code of Practice for Packing of Cargo Transport Units* (CTU Code, 2014) is the
non-mandatory global code for packing containers. It covers the checks on a container before
packing, packing and securing the cargo, and the documents. Its main points:

- **Before packing.** The container must be sound: a valid safety plate, weathertight (light test
  from the inside), clean, dry and free of odours.
- **Weight distribution.** The centre of gravity should stay close to the middle of the length.
  Guidance commonly quoted from the Code: within about 5 % of the length (±15 cm in a 20′, ±30 cm
  in a 40′), and at most 10 %. Otherwise at least keep 60 % of the cargo mass in the middle half
  of the length ("60/50"), or no more than 60/40 between the two halves, with the heavier half not
  against the front wall, which is over the truck's drive axle. Our balance rule uses 10 %.
- **Vertically.** Heavy and dense cargo goes low, light cargo on top.
- **Securing.** Voids are filled, and the cargo is blocked, braced or lashed. Loose items must
  not be able to shift. The last row at the doors needs a gate or bracing so nothing falls out
  when the doors open.
- **Mass.** The verified gross mass (SOLAS VGM) is declared before loading on a ship. The payload on
  the container's plate is never exceeded.

## Utilisation

| Case | Typical share of the inside volume used |
|---|---|
| Floor-loaded cartons or loose parts, mixed sizes | 70–85 % |
| Uniform pieces, planned load | 90–95 % |
| Broken stowage (space lost), industry average | 8–15 %; 3–7 % in optimised loads |

Our wall loader reaches 92–97 % on paper for uniform cushions. On the floor, expect less: the bags
add a few millimetres, and pieces are not placed perfectly. An allowance of 5–10 % is prudent
when booking containers.

## Container sizes (typical inside)

| Type | Inside L × W × H | Volume | Door (W × H) | Typical payload |
|---|---|---|---|---|
| 20′ standard | 5.89 × 2.35 × 2.39 m | 33 m³ | 2.34 × 2.28 m | 28.2 t |
| 40′ standard | 12.03 × 2.35 × 2.39 m | 67 m³ | 2.34 × 2.28 m | 26.7 t |
| 40′ high cube | 12.03 × 2.35 × 2.69 m | 76 m³ | 2.34 × 2.58 m | 26.5 t |

EPS cushions are light, so volume fills a container long before mass does. That favours the
40′ high cube: it has 13 % more volume than a 40′ standard for about the same freight rate. A 20′
suits only a small remainder. Two 20′ cost more than one 40′ on most lanes.

## What this means for the cushion plan (04–09/Oct)

Our loader's results for each day (loose pieces in bags, may lie on their side):

| Day | Pieces | Volume | 20′ | 40′ | 40′ HC | 40′ HC + 20′ for the rest |
|---|---|---|---|---|---|---|
| 04/Oct | 11 900 | 330.5 m³ | 11 | 6 | 5 | 4 + 2 × 20′ |
| 05/Oct | 5 100 | 229.4 m³ | 8 | 4 | 4 | 3 + 1 × 20′ |
| 06/Oct | 3 500 | 205.6 m³ | 7 | 4 | 3 | 2 + 2 × 20′ |
| 07/Oct | 6 300 | 366.3 m³ | 13 | 6 | 6 | 5 + 1 × 20′ |
| 08/Oct | 2 800 | 160.7 m³ | 6 | 3 | 3 | 2 + 1 × 20′ |
| 09/Oct | 2 400 | 137.7 m³ | 5 | 3 | 3 | 2 + 1 × 20′ |
| **All six days together** | 32 000 | 1 430.2 m³ | 47 | 23 | **20** | 19 + 2 × 20′ |

Day by day, the plan needs 24 × 40′ HC. Shipped as one run, it needs 20, because the part-empty
last containers of each day are filled. Where the last 40′ HC of a day is nearly empty (05/Oct,
07/Oct, 08/Oct, 09/Oct), one 20′ carries the rest.

## Sources

- IMO: [CTU Code](https://www.imo.org/en/ourwork/safety/pages/ctu-code.aspx); UNECE: [CTU Code](https://unece.org/transport/intermodal-transport/imoilounece-code-practice-packing-cargo-transport-units-ctu-code); ILO: [full text (PDF)](https://www.ilo.org/sites/default/files/wcmsp5/groups/public/@ed_dialogue/@sector/documents/publication/wcms_492710.pdf); [UNECE wiki, principles of packing](https://wiki.unece.org/spaces/TransportSustainableCTUCode/pages/23102046/3+Principles+of+packing)
- Weight distribution: [Rothschenk, 5 %, 10 % or 60/40](https://rothschenk.de/en/episode-46-weight-distribution-according-to-ctu-code-5-or-10-or-60-40/); [HZ Containers, rule 60/50](https://hz-containers.com/en/technical-information/ctu-code-rule-60-50/)
- Stuffing practice: [LoadOptimizer, 8 best practices](https://www.loadoptimizer.ai/blog/container-stuffing-guide/); [Terminal49, container stuffing](https://terminal49.com/glossary/container-stuffing)
- Utilisation: [DocShipper, broken stowage](https://docshipper.com/glossary/broken-stowage-definition-logistics/); [ContainerLoad, loading guide](https://containerload.org/blog/container-loading-guide)
- Sizes: [Portlogics, container dimensions](https://portlogics.com/insights/container-types-guide); [Ship4wd, 20′ and 40′ specs](https://ship4wd.com/logistics-shipping/20ft-40ft-shipping-containers-specs)
