# 0015 — Safe design variants

**Status:** accepted for integration review  
**Date:** 26 September 2026

## Context

Industrial planning needs alternatives: different rack layouts, production arrangements, depot
layouts, restaurant plans and AI proposals. An alternative must never silently replace the approved
plan. The existing core already has immutable commands, revisions and deterministic validation, so a
variant should build on those guarantees rather than create a second state model.

A divergent development branch contained an early variants implementation, but it was based on an
older T7–T10 line. It could not be merged wholesale: notably, that branch's serializer did not carry
main's schema v1→v2 migration. This integration therefore ports the capability selectively onto the
current main architecture.

## Decision

1. **A variant is a normal project with its own id and revision history.**
   The projects table gets one nullable, additive variant_of column. Existing rows remain normal
   projects and old databases are upgraded with an idempotent ALTER TABLE.

2. **Variants form one family.**
   A variant created from another variant links to the original approved base. familyOf() returns
   the base first, then alternatives in deterministic creation order.

3. **The approved project is untouched while alternatives are explored.**
   A variant uses the same core commands, validation, server store, editor and agent tools as every
   other project.

4. **Adoption is explicit and reversible.**
   diffCommands(base, variant) produces ordinary core commands. The store applies them to the base
   as one validated revision named Adopted variant. The base keeps its id and name, and the
   alternative remains available for audit and comparison.

5. **Deleting a base does not delete its product-level alternatives.**
   Its variants become ordinary projects before the base row is deleted.

6. **Comparison is activity-aware but generic.**
   Each activity pack exposes a small list of comparable figures. Generic comparison also reports
   errors, warnings, failed rules and unknown rules. No opaque combined score is invented.

7. **AI uses the same flow.**
   Agents receive create_variant, compare_variants and adopt_variant. Adoption is described as
   an explicit action intended only after the person asks for it.

## Compatibility and safety

- Project JSON schema stays at the current version; variant linkage is server metadata, not embedded
  into saved project snapshots.
- Main's existing save migrations remain unchanged.
- Pre-variants SQLite databases are opened and upgraded by test.
- The core project-diff helper has reference and property tests.
- Store tests cover nested variants, isolation, one-revision adoption and deletion behaviour.
- A Playwright journey covers create → change variant → compare → adopt → preserved alternative.
- The whole repository must pass typecheck, unit tests, server build and browser tests before merge.

## Consequences

Variants are deliberately heavier than an in-memory branch because each one has a full project
history, but that makes them simple, auditable and compatible with the existing app. Storage
optimisation can come later if measurement shows it is needed.

AI optimisers should propose into variants rather than mutating an approved plan. This becomes the
safe foundation for later automatic layout generation and optimisation.
