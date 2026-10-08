# 0029 — The AI interior designer: build from measurements, furnish with options, skills over MCP

**Date:** 2026-10-07 · **Status:** accepted

## Context

The owner: a client will not draw every wall. They give an AI agent a file of measurements and
quantities and expect the flat; then "furnish it" and expect several ways to arrange and furnish
it, as from an expert interior designer. Any agent must connect (MCP), the in-app agent must work
with any API key, and a web subscription comes later (plan H7).

## Decision

- **Measurements to a flat in one call.** `buildApartment` (starter) takes rooms as rectangles on
  their wall centre lines, doors between named rooms, windows on a room's side and the entrance;
  it derives every wall once (a shared edge is one 10 cm partition, an edge with a room on one side
  only is a 20 cm outer wall), puts the doors and windows in those walls and names the rooms.
  Agents read whatever file the client has (text, table, PDF) and call it; nothing parses files in
  the core.
- **Furnishing options are computed, not improvised.** A deterministic layout engine (starter)
  places the home catalogue room by room from a few professional arrangements per room kind
  (bed on each free wall, sofa facing the focal wall or the window, dining centred, kitchen run
  along the longest free wall…), keeps only those that pass the core checks and the home rules,
  scores them (circulation, door and window respect, focal point, balance) and returns the best
  distinct ones with their reasons in words. The same engine serves the MCP tools, the in-app
  button (no AI needed) and the agents; an agent can still move anything afterwards.
- **Skills travel with the server.** Design knowledge (space planning, clearances, orientation,
  focal points, lighting, styles) is text kept in the starter and served three ways: MCP
  `prompts`, MCP `resources`, and a `design_guide` tool for clients that support only tools (and
  for the in-app agent). Numbers in it are labelled common guidance, never regulation.
- **Any API key.** The in-app agent keeps its two providers (Anthropic, and the OpenAI chat format
  that most other providers and local models speak) and now gets the same skills and tools.

## Consequences

- An agent goes from a measurements file to a drawn, furnished flat with three options in one
  request; a person without an AI key gets the same options from a button.
- Options kept as separate projects can be compared and handed to the client.
- The web subscription (H7) reuses the same server tools; it needs accounts (T11) first.
