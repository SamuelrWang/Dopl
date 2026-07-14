# Claude instructions for this repo

Read [docs/ENGINEERING.md](docs/ENGINEERING.md) before making structural or architectural changes. It's the source of truth for directory layout, naming, file-size rules, the repository/service/handler data-access split, API route shape, state-management boundaries, and the refactor plan.

For ANY UI work, read [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) first. All interface code MUST use the global design tokens (semantic `text-*` type scale, token color utilities) and kit classes (`.page-float`, `.bento`, `.concave-field`, `.concave-sel`, `.concave-track`, `.raised-tab`, `.btn-light`) — never hardcode hex colors, raw px font sizes, or shadow/border recipes in components.

When the guideline doc conflicts with existing code, the doc wins and the code is a refactor candidate.

For live refactor context see [docs/REFACTOR-FINDINGS.md](docs/REFACTOR-FINDINGS.md) — open findings that need follow-up work are tracked there with `F-NNN` ids.

## Session-end doc ritual (definition of done)

The guideline docs are load-bearing: agents act on them instead of re-reading the codebase, so a stale doc produces confident wrong edits. Any session that changes architecture, conventions, API/MCP surface, or schema is NOT done until it has:

1. Updated [docs/ENGINEERING.md](docs/ENGINEERING.md) if a rule, layout, or pattern changed.
2. Recorded new debt or resolved findings in [docs/REFACTOR-FINDINGS.md](docs/REFACTOR-FINDINGS.md) (`F-NNN`).
3. Synced the "Dopl Development" knowledge base in the Dopl workspace (via dopl_kb) when the change affects what a future coding session must know — architecture, release flow, gotchas.

Do this before reporting the work complete, not as a follow-up.
