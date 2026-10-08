/**
 * Interior design skills (decision 0029): the knowledge an experienced interior designer brings
 * to a flat, written for AI agents. Served over MCP as prompts and resources, through the
 * `design_guide` tool, and to the agent inside the program. Every number is common residential
 * guidance, not a regulation; the program's checks enforce only what is labelled with a source.
 */

export interface DesignSkill {
  readonly id: string;
  readonly title: string;
  /** One line: when to read it. */
  readonly description: string;
  readonly text: string;
}

export const DESIGN_SKILLS: readonly DesignSkill[] = [
  {
    id: 'workflow',
    title: 'Working in Atrium as an interior designer',
    description: 'Read first: how to go from a client file to a drawn, furnished flat with options, using the tools.',
    text: `# Working in Atrium as an interior designer

You are the client's interior designer. The client gives you their flat as a file or a message
(room names and sizes, doors, windows, sometimes a list of furniture and quantities). They should
never have to enter a single measurement themselves.

1. **Read the brief.** Note every room with its width and depth, which rooms connect, where the
   entrance is, where the windows are, the ceiling height, the furniture asked for and its
   quantities, the style and the budget. When something is missing, choose a sensible default
   and say so at the end; do not stop to ask.
2. **Lay the rooms out as rectangles on their wall centre lines** (metres, x east, y north, origin
   at the south-west). Rooms that touch share a wall. Sizes in a brief are usually inside sizes:
   add half a partition (5 cm) per shared side if the client gave clear sizes and accuracy
   matters. Then call **build_apartment** once with the rooms, the doors between rooms, the
   entrance and the windows. It draws every wall, door and window and names the rooms, in one
   revision. Read back the room areas and compare them with the brief.
3. **Furnish with options.** Call **furnish_options** to see three ways to furnish (different
   arrangements, different finishes), each with its reasons and its check results. Present them
   to the client in their language: what each option favours. Apply one with
   **apply_furnishing**, or create all three as separate projects with
   **furnish_apartment_options** so the client can compare.
4. **Refine like a designer.** Use the guides (design_guide) to adjust: move pieces with
   move_items, add what the client asked for with place_items (the home catalogue has sofas,
   beds, wardrobes, dining sets, kitchens, bathroom fittings, lamps, rugs, plants and art), keep
   every clearance, keep doorways and windows free.
5. **Check.** Call check_project. Fix every error; explain any warning you keep.
6. **Present.** Finish with a short summary in the client's language: the flat (rooms and areas),
   the option chosen and why, quantities, and what is left to decide.

Coordinates: metres; an item's position is its centre; rotation is degrees counter-clockwise and
0 means the item's front faces north (a sofa against the south wall has rotation 0, against the
north wall 180, against the west wall 270, against the east wall 90).`,
  },
  {
    id: 'space-planning',
    title: 'Space planning and circulation',
    description: 'Walkways, zones, door swings, clearances around every kind of furniture.',
    text: `# Space planning and circulation

- **Main walkways** 90–110 cm wide; secondary paths 60–75 cm. Every seat and bed must be reachable
  from the entrance by a path at least 80 cm wide (Atrium checks this).
- **Door swings** stay completely clear; leave 90 cm deep in front of every doorway.
- **Zones before furniture:** decide where each activity happens (sit, eat, cook, sleep, work),
  then the path that links them; furniture follows. In open plans, rugs, the back of a sofa or a
  pendant light mark the zones.
- **Clearances (common guidance):** sofa to coffee table 40–45 cm; beside a bed 60–75 cm, at its
  foot 90 cm; in front of a wardrobe 90 cm; behind a dining chair 75 cm to sit, 90–110 cm to walk
  past; in front of kitchen counters 100–120 cm; in front of a toilet or basin 60–70 cm; desk chair
  pull-out 75–90 cm.
- **Walls:** tall pieces (wardrobes, bookcases, fridges) never in front of windows; low pieces
  (sideboards, TV units, beds) may sit under a window sill.
- **Proportion:** furniture should cover about half to two-thirds of the floor; an empty room
  looks unfinished, a full one cramped.
- **Angles:** align pieces with the walls (0, 90, 180, 270). Turn a piece 45° only to fill a
  corner deliberately (an armchair in a reading corner), never by accident.`,
  },
  {
    id: 'living-room',
    title: 'Living room',
    description: 'Focal point, sofa and screen, coffee table, rug sizes, conversation groups, lighting.',
    text: `# Living room

- **Focal point first:** a window with a view, a fireplace or the TV wall. The main sofa faces it.
- **Screen distance:** about 1.5–2.5 × the screen diagonal (a 65″ screen: 2.5–4 m eye to screen).
  The screen centre about 100–110 cm above the floor. Never put the screen against a window
  (glare); avoid a window directly behind the viewer (reflections) unless there are curtains.
- **Conversation:** seats within 2.4–3 m of each other; an armchair at right angles to the sofa
  closes the group. Leave 75–90 cm to walk between pieces.
- **Coffee table:** about two-thirds of the sofa length, 40–45 cm from the sofa, height level with
  the seat. A side table at each sofa end, at arm height.
- **Rug:** large enough for at least the front legs of every seat to stand on it, with 20–40 cm of
  floor showing to the walls. Common sizes: 240 × 170 for a small group, 300 × 200 for a sofa and
  two chairs.
- **Floating sofa:** in rooms deeper than about 4.5 m, bring the sofa off the wall so that the
  group is 3 m across, with a walkway or a console behind it.
- **Light in layers:** ceiling (general), floor and table lamps (ambient, at seat corners), a
  reading lamp by the armchair, accent light on art.`,
  },
  {
    id: 'bedroom',
    title: 'Bedroom',
    description: 'Bed position, sizes, nightstands, wardrobes, dressers, rugs.',
    text: `# Bedroom

- **Bed position (the "command position"):** the head against a solid wall, the door visible from
  the bed but not in line with it; not under a window (draughts, light) unless there is no other
  wall; not on the same wall as the door.
- **Sizes (mattress):** single 90 × 200, double 140 × 200, queen 160 × 200, king 180 × 200. Plan
  the bed frame 10–15 cm larger. A king needs a room of about 3.4 m or more across.
- **Space around:** 60–75 cm on the sides used to get in; 90 cm at the foot when a wardrobe or a
  path is there.
- **Nightstands:** 45–60 cm wide, level with the mattress top, one each side for a double bed.
- **Wardrobe:** 60 cm deep; 90 cm free in front to open hinged doors (sliding doors need less);
  never in front of the window; ideally on the wall nearest the door.
- **Rug:** under the lower two-thirds of the bed, showing 50–60 cm each side; or runners on both
  sides.
- **Art:** centred above the headboard, its width about two-thirds of the bed.`,
  },
  {
    id: 'dining-kitchen',
    title: 'Dining and kitchen',
    description: 'Table sizes and clearances, pendant height, kitchen work triangle, islands.',
    text: `# Dining and kitchen

- **Table per person:** 60 cm of edge each; a table for 4 is about 120 × 80 or Ø 100, for 6 about
  180 × 90. Round tables suit square rooms, long ones long rooms.
- **Clearance:** 75 cm from the table edge to a wall behind chairs, 90–110 cm where people walk
  behind.
- **Pendant:** centred over the table, its bottom 75–85 cm above the table top; its width about
  half to two-thirds of the table width.
- **Sideboard:** on the wall the table faces, 45 cm deep, 75 cm free in front.
- **Kitchen work triangle:** sink, hob and fridge; each leg 1.2–2.7 m, the sum 4–8 m; no main
  walkway through it. Keep 40 cm of counter beside the hob and the sink.
- **Layouts:** one wall (small flats), L (corners), parallel galley (120 cm between runs), U, and
  island (100–120 cm all round the island).
- **Fridge** at the end of a run, its door opening away from the counter.`,
  },
  {
    id: 'bathroom',
    title: 'Bathroom',
    description: 'Fixture sizes and clearances, wet zones, doors.',
    text: `# Bathroom

- **Toilet:** its centre 40–45 cm from a side wall or fitting, 60–70 cm free in front.
- **Basin:** 70 cm free in front; a mirror above it, centred; 20 cm between a basin and the next
  fitting.
- **Shower:** at least 80 × 80, better 90 × 90 or 90 × 120; a walk-in shower keeps the room open.
- **Bathtub:** 170 × 75 usual; along the longest wall, often under the window.
- **Plumbing:** fittings that share one wall are cheaper and easier to build.
- **Door:** opens inward only when it clears every fitting; otherwise outward or sliding.`,
  },
  {
    id: 'style-and-finish',
    title: 'Style, colour and finishes',
    description: 'Palettes, the 60-30-10 rule, materials, scale, art and how to describe a style to a client.',
    text: `# Style, colour and finishes

- **60-30-10:** about 60 % a main neutral (walls, large surfaces), 30 % a secondary colour
  (upholstery, rugs, wood), 10 % accent (cushions, art, a single armchair).
- **Wood:** one main wood tone, one contrast at most (oak with black, walnut with brass, white
  with natural oak).
- **Fabrics:** mix textures (linen, bouclé, wool, velvet) in the same colour family; repeat each
  accent colour at least three times in a room.
- **Palettes Atrium offers:** warm oak and linen (calm, light, Scandinavian); walnut and sage
  (warm, natural, mid-century); charcoal and white (contrast, modern, urban).
- **Scale:** big rooms need big pieces (a corner sofa, a 300 × 200 rug); small rooms need legs
  and light colours, fewer and larger pieces rather than many small ones.
- **Art:** hang its centre at 145–150 cm, or 20–25 cm above a sofa or headboard; a group is
  treated as one piece.
- **Describing an option to a client:** say what it favours (light, space, conversation, storage,
  hosting), what it costs in space, and the one thing to decide.`,
  },
];

export function designSkill(id: string): DesignSkill | undefined {
  return DESIGN_SKILLS.find((s) => s.id === id);
}

/** Prompts an MCP client can offer its user: complete designer briefs built from the skills. */
export const DESIGN_PROMPTS = [
  {
    name: 'design_flat_from_measurements',
    title: 'Design a flat from the client’s measurements',
    description: 'Paste or attach the client’s room sizes (and furniture list); the agent draws the flat, furnishes it with options and presents them.',
    arguments: [{ name: 'brief', description: 'The client’s measurements, furniture list and wishes, as text.', required: true }],
    build: (args: Record<string, string>) =>
      `${designSkill('workflow')!.text}\n\n${designSkill('space-planning')!.text}\n\nThe client's brief:\n"""\n${(args.brief ?? '').trim()}\n"""\n\nDraw the flat, furnish it with three options, apply the best one and present all three.`,
  },
  {
    name: 'furnish_like_a_designer',
    title: 'Furnish a project like an interior designer',
    description: 'Three furnished options with reasons for an existing project, in the style asked for.',
    arguments: [
      { name: 'project_id', description: 'The project to furnish.', required: true },
      { name: 'style', description: 'Style or wishes, e.g. "calm and light, lots of storage".', required: false },
    ],
    build: (args: Record<string, string>) =>
      `${designSkill('workflow')!.text}\n\n${DESIGN_SKILLS.filter((s) => ['living-room', 'bedroom', 'dining-kitchen', 'bathroom', 'style-and-finish'].includes(s.id)).map((s) => s.text).join('\n\n')}\n\nProject: ${args.project_id ?? ''}\nWishes: ${args.style?.trim() || 'none given — choose what suits the flat'}\n\nCall furnish_options, judge the three options against the guides and the wishes, improve the best one, and present the choice.`,
  },
  {
    name: 'review_layout',
    title: 'Review a layout as an interior designer',
    description: 'A designer’s critique of a project: circulation, clearances, focal points, light, style.',
    arguments: [{ name: 'project_id', description: 'The project to review.', required: true }],
    build: (args: Record<string, string>) =>
      `${DESIGN_SKILLS.filter((s) => s.id !== 'workflow').map((s) => s.text).join('\n\n')}\n\nReview project ${args.project_id ?? ''}: call get_project and check_project, then list what works and what to change, most important first, each with the move that fixes it.`,
  },
] as const;
