/**
 * THE HOME SUITE'S SHARED IDENTIFIERS — the container, its segment, its channel.
 *
 * 🔒 **THIS FILE EXISTS TO BREAK AN IMPORT CYCLE, AND THE CYCLE WAS A REAL BUG
 * (2026-09-01).** When the harness was relieved by face
 * (`overview-test-harness.ts`, `knowledge-test-harness.ts`), each sub-harness
 * imported `LINK_WORKSPACE_ID` back out of `home-test-harness.tsx` — which
 * imports THEM. Under that cycle the sub-harness module body runs FIRST, while
 * the constant is still uninitialised, so every fixture built at module scope
 * baked in `undefined`: `HOME_OVERVIEW.threads[0].workspaceId` was `undefined`,
 * and the Overview face's jump minted the row id `"rel:undefined"`. **Nothing
 * failed at the seam** — the ids only ever travelled between two fixtures, so
 * the suites stayed green while asserting against a payload the server cannot
 * emit, until a test finally read one of them.
 *
 * ⚠ **A LEAF: it imports nothing from this directory, and it must stay that
 * way.** That is the whole property that makes the cycle impossible; a single
 * `from "./home-test-harness"` here puts it straight back.
 *
 * ⚠ `home-test-harness.tsx` re-exports all of these, so every suite still reads
 * them from the one door and no call site moved.
 */

export const LINK_WORKSPACE_ID = "ws-link-1";
export const LINK_SEGMENT = "link-priya-aa11bb";
export const CHANNEL_ID = "chan-1";
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
