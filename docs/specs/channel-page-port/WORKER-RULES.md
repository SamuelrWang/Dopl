# Worker rules: home channel page + tasks port

Read first: `CLAUDE.md`, `docs/INVARIANTS.md`, `docs/specs/channel-page-port/PLAN.md` (§2 rulings are
binding), and for UI work `docs/DESIGN-SYSTEM.md` + `docs/DESIGN-LANGUAGE.md`.

## Samuel's code standard (verbatim, 2026-10-26)

"All the coding agents need to make sure that they are writing very clean code. They do not
overcomment, and they do not comment unnecessarily. The code does not have repeated code."

"We need to make sure that it's not just code being slapped on top of the existing channel
features. We need to cleanly remove or delete any code that is now obsolete or is old, like
obsolete UI designs and stuff like that, so that we can actually rebuild in a very sustainable and
clean manner. We don't want a bunch of dead code or confusing code. We also need to clean up any
comments that refer to now-removed features or removed UI."

"There might be features on the desktop app that weren't fully transferred over to the playground.
In that case, we need to make sure that we don't lose that stuff."

## Rules

1. Staging (`src/features/channels-staging`, `ui-staging`) is the VISUAL spec. Product components
   carry the logic. Restyle/restructure product code in place; never swap in a staging copy. Every
   handler, state, gate and capability the product has today survives (PLAN.md §3 "Must stay
   intact").
2. One implementation per face. Reuse `src/shared/ui` primitives; extend one rather than adding a
   second.
3. Delete what you replace, in the same commit: components, classes, tokens, tests, doc anchors,
   and comments that mention removed UI. No commented-out code, no tombstone comments.
4. Comments only for a non-obvious why. No narration, no history, no restating code, no dated
   rulings in code comments.
5. Tokens/kit only; kit recipes in both `src/app/globals.css` and `apps/desktop-ui/src/styles/kit.css`;
   500-line cap per file (split, don't squeeze).
6. "task" means the NEW tasks feature. Anything meaning a thread is named `thread`.
7. Unknowns: do not stop. Choose the conservative option, note it in
   `docs/specs/channel-page-port/OPEN-QUESTIONS.md` (append a `## <slice>` section: question,
   what you chose, where), and continue.
8. Never push, deploy, release, or apply a migration to production. Write migrations; the
   orchestrator applies them.
9. Do NOT open a browser, start a dev server, or take screenshots.
10. Gates: targeted typecheck(s) (`npm run typecheck`, plus `npm run typecheck -w @dopl/desktop-ui`
    when SPA files change), `npx eslint --max-warnings 0 <changed files>`, `npx vitest run <changed
    tests and their direct neighbours>`, and every drift script your change can affect. Run heavy
    commands under `lockf /tmp/dopl-gate.lock`. No full suite.
11. Worktree setup: branch from local `master`; symlink `node_modules` from the main checkout
    (`/Users/samuelwang/Downloads/setup-intelligence-engine`) and copy its `.env.local`.
12. Commit by path with messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
    Several small commits are fine. Do not touch the main checkout.
13. Session-end doc ritual (CLAUDE.md) for your slice: INVARIANTS/DESIGN docs updated where your
    change makes them wrong, in the same branch.

## Report format

Branch, worktree path, commit list, files changed (grouped), what was deleted, gates run with
results, migration files (if any) with md5, items appended to OPEN-QUESTIONS.md.
