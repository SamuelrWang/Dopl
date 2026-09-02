/**
 * `@dopl/contracts` — THE ONE DECLARATION OF EVERY CLOSED SET THAT CROSSES A
 * TREE BOUNDARY (v2 architecture C18 / slice A13, 2026-09-02).
 *
 * ## Why this package exists
 *
 * `packages/dopl-client` and `packages/mcp-server` **cannot import `src/`** —
 * they are separate `tsc` programs with their own `rootDir`, published to the
 * app through `node_modules`. So every union that both a route and the SDK need
 * was re-typed by hand, and four `scripts/check-*-drift.ts` gates (1,038 lines)
 * existed to hold the copies together. This package is the shared module those
 * gates were standing in for: it is a workspace dependency of BOTH packages and
 * resolvable from `src/`, so the compiler now enforces what a regex used to
 * approximate.
 *
 * ## The two rules
 *
 * 1. **TYPE-ONLY. NOTHING HERE MAY BE A `const`, A FUNCTION, OR AN `enum`.**
 *    That is what lets the package have **no build step and no `dist/`**:
 *    `package.json` points `types` straight at `src/index.ts`, every import of it
 *    is an `import type`, and all four consumers (Next/webpack, the SPA's Vite,
 *    two `tsc` programs, three vitest runs) erase it at compile time. A single
 *    runtime export would make this a build input for every one of them and
 *    re-open the committed-`dist/` problem C18 exists to close.
 *    `isStandardWorkspace` is the worked example of something that therefore
 *    stays where it is — see `workspaces.ts`.
 * 2. **CLOSED SETS AND THE SHAPES BUILT DIRECTLY ON THEM. NOT DTOs.** A type
 *    belongs here when the SAME set is stated in two trees. A row shape that only
 *    one tree ever builds does not, however tempting: this package's value is
 *    that its contents are small, closed and argued-over, and a dumping ground
 *    for every wire type would be the fifth mirror rather than the end of them.
 *
 * ## What still needs a drift gate, and why
 *
 * The compiler reaches TypeScript. It does not reach a SQL `CHECK`, a zod
 * `z.enum`, a committed `.js`, or the desktop's own `main/*.js` copies — those
 * sites are still compared by `scripts/check-{message-kind,role,session-health}
 * -drift.ts`, which shrank to exactly those comparisons when the hand mirrors
 * went. INVARIANTS §14 lists what each one still holds.
 *
 * ⚠ **NO `export *`.** Every name is listed, so `grep` answers "what does this
 * package publish" and a new export is a reviewable line rather than a
 * side-effect of adding a file.
 */

export type {
  ChannelVisibility,
  ChannelRole,
  ThreadMode,
  ThreadStatus,
  ThreadOutcome,
  MessageAuthorKind,
  PostableAuthorKind,
  ChannelMessageKind,
  PostableMessageKind,
  MessageIntent,
} from "./channels.js";

export type {
  SessionPillState,
  ChannelSessionTelemetry,
  ChannelSessionHealth,
} from "./sessions.js";

export type {
  DirectionRefusalReason,
  LaunchRefusalReason,
  LaunchDirectiveKind,
  LaunchToolMode,
  LaunchMessageMode,
} from "./directives.js";

export type { PingKind, PingRecipientKind } from "./pings.js";

export type {
  WorkspaceRole,
  MembershipStatus,
  WorkspaceKind,
  TemplateVisibility,
} from "./workspaces.js";
