/**
 * **`@desktop` AND THE OUTSIDE-SESSION LABEL, AS THIS PACKAGE SEES THEM**
 * (2026-09-18, Samuel's ruling on the external-session group tag).
 *
 * ⚠ **HAND-COPIED CONSTANTS from `src/features/channels/lib/desktop-handle.ts`**
 * — `packages/*` cannot import the app's `src/` (INVARIANTS §13), the same
 * arrangement `identity.ts › DESKTOP_SESSION_RUNTIME` has with
 * `shared/auth/runtime-header.ts`. ⚠ Drift is SILENT and looks like "the tag
 * stopped working", so it is pinned by `channel-desktop-tag.test.ts`, which
 * reads the web tree's file directly.
 *
 * ⚠ **THIS PACKAGE ONLY READS.** The write side — resolution, stripping,
 * stamping — is entirely in the web tree; what lives here is how a STORED row
 * renders. So nothing in this file decides anything, and a value it does not
 * recognize must render as *absent*, never as a guess.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`channel-law.test.ts`).
 */

import type { ChannelMessage } from "@dopl/client";
import { metaString } from "./channel-shared";

/** The reserved group handle, bare. ⚠ Mirror of `lib/desktop-handle.ts`. */
export const DESKTOP_GROUP_HANDLE = "desktop";

/** How `@desktop` renders in an addressing arrow. ⚠ One spelling, imported. */
export const DESKTOP_HANDLE_TAG = `@${DESKTOP_GROUP_HANDLE}`;

/** Server-owned key carrying the operator whose outside sessions were addressed. */
export const DESKTOP_TO_METADATA_KEY = "to_desktop";

/** Server-owned key marking a post an OUTSIDE SESSION wrote. */
export const EXTERNAL_SESSION_METADATA_KEY = "external_session";

/**
 * **WHOSE OUTSIDE SESSIONS THIS MESSAGE WAS ADDRESSED TO**, or `undefined`.
 *
 * ⚠ **`undefined` IS "NOT ADDRESSED TO ANY DESKTOP LANE", AND THAT IS THE ONLY
 * READING.** It is also what every row written before this key existed carries,
 * and what an older server stamps — all three collapse to the same rendering,
 * which is the pre-2026-09-18 one. There is no third state to tell apart here,
 * unlike `recipientAgentIds`' `[]`-versus-`null`.
 */
export function desktopAddresseeOf(m: ChannelMessage): string | undefined {
  return metaString(m, DESKTOP_TO_METADATA_KEY);
}

/**
 * **WAS THIS POST WRITTEN BY AN OUTSIDE SESSION?**
 *
 * ⚠ **STRICTLY `=== true`.** The web tree stamps the key ONLY when the answer is
 * yes and never writes an explicit `false`, so any other value — absent, `null`,
 * a string some older build wrote — means *this server did not say*, and the
 * honest rendering of that is the ordinary agent label. Coercing with `!!` would
 * turn a truthy junk value into a confident claim about who wrote somebody's
 * message.
 */
export function isExternalSessionPost(m: ChannelMessage): boolean {
  const value = (m.metadata as Record<string, unknown> | undefined)?.[
    EXTERNAL_SESSION_METADATA_KEY
  ];
  return value === true;
}

/**
 * **THE AUTHOR VIEW — the word a renderer labels this row with** (2026-09-18).
 *
 * ⚠ **IT IS A PROJECTION, AND IT IS DELIBERATELY NOT `ChannelMessage.authorKind`.**
 * That field is the stored COLUMN, whose set is closed at three and gated by
 * `scripts/check-message-kind-drift.ts` — a gate that reads the `CHECK` out of
 * one named migration and fails on any later one that re-constrains a `kind`
 * column. Widening the column was therefore the expensive road; widening the
 * VIEW costs nothing and, more importantly, degrades correctly: a row with no
 * flag renders exactly as it rendered yesterday.
 *
 * ⚠ **BATCH A (`fix/r1-a`) READS THIS FUNCTION, NOT A DTO FIELD.** The agreed
 * word is `external`; the agreed carrier is this projection. Both `ChannelMessage`
 * declarations (`src/features/channels/types.ts` and the SDK's
 * `channel-types.ts`) sit AT the 500-line cap, so a new field would have forced a
 * §1 split in two trees for one boolean.
 */
export type MessageAuthorView = ChannelMessage["authorKind"] | "external";

export function authorViewOf(m: ChannelMessage): MessageAuthorView {
  // ⚠ ONLY AN `agent` ROW CAN BE ONE. A human composer post is `user` whatever
  // metadata it carries, and `system` is server-minted — promoting either would
  // be inventing an authorship claim from a flag that was never about them.
  return m.authorKind === "agent" && isExternalSessionPost(m)
    ? "external"
    : m.authorKind;
}
