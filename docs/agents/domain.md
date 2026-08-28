# Domain Docs

## Before exploring, read these

- `CONTEXT.md` at the repository root, if present
- `CONTEXT-MAP.md`, if present
- Relevant ADRs under `docs/adr/`

If these files do not exist, proceed silently. Domain-modeling skills create them lazily when
terminology or decisions require them.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Vocabulary

Use terminology defined in `CONTEXT.md`. Do not substitute synonyms that the glossary explicitly
avoids.

If a necessary concept is missing, reconsider whether new terminology is needed or note it for
domain modeling.

## ADR conflicts

Surface contradictions with existing ADRs explicitly rather than silently overriding them.
