import { z } from "zod";
// ⚠ THE CHARSET GATE IS THE CHANNELS FEATURE'S, IMPORTED AND NOT RESTATED. A
// second copy of a neutralizer drifts, and the copy that drifts is the one that
// stops neutralizing (`shared/lib/safe-label.ts`'s own header).
import { safeOptionalLabel } from "@/shared/lib/safe-label";

/**
 * Request shapes for the home surface.
 *
 * ⚠ NOT under `server/`: this is the only module on the surface both sides
 * need, and the desktop renderer's ESLint fence blocks every `features/<x>/
 * server/` path outright. Keeping it here is what lets the SPA import the
 * request types instead of re-declaring them.
 */

/**
 * `POST /api/home/channels` — "New channel". The name is the CHANNEL's name and
 * the container's name both: the container is plumbing nobody navigates to, so
 * a second name for it would be a second thing to keep in sync and a second
 * thing to get wrong.
 *
 * ⚠ **`topic` IS THE FIELD THE PRODUCT CALLS "DESCRIPTION" (ruling, Samuel,
 * 2026-09-15).** The New-channel popup gained a Description field; it writes the
 * EXISTING `channels.topic` column (2000 chars, `channels/schema.ts ›
 * ChannelTopicSchema`, already on the `Channel` DTO and already rendered on the
 * MCP `rooms list` line). **There is no new column and there must not be one** —
 * the user-facing word is "Description" everywhere, the wire and DB field stays
 * `topic`. `createHomeChannel` used to pin `""` here and now passes this through.
 *
 * ⚠ THE CAP AND THE CHARSET GATE ARE THE CHANNELS FEATURE'S, not a looser local
 * pair: the value lands in the same column, is spliced into the same MCP server
 * narration, and `ChannelTopicSchema` is `safeOptionalLabel("Channel topic",
 * 2000)`. It is restated rather than imported only because that const is
 * module-private there; the ARGUMENTS must stay identical.
 * ⚠ `.optional()`, and `""` stays legal — the column is `NOT NULL DEFAULT ''`.
 */
export const HomeChannelCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  topic: safeOptionalLabel("Channel description", 2000).optional(),
});

export type HomeChannelCreateInput = z.infer<typeof HomeChannelCreateSchema>;

/**
 * `POST /api/home/links` — add a person to a channel that already exists.
 *
 * ⚠ `workspaceId` IS REQUIRED (2026-08-24, the inversion). A link is BOUND to
 * its container: claiming it inserts the claimer into that one, rather than
 * minting a new relationship out of nowhere. There is no unbound mint any more
 * — the legacy tokens that predate this are still claimable, but nothing can
 * produce another one.
 *
 * ⚠ `maxUses` IS GONE, and its absence is load-bearing rather than an omission.
 * A bound link admits ONE named person, so the service pins `maxUses: 1` by
 * construction and a client cannot ask for otherwise. The field used to
 * distinguish ABSENT from NULL — absent meaning "the caller said nothing" and
 * taking the safe single-use default, an explicit `null` meaning "multi-use, I
 * meant it" — a distinction bought by an incident where an omitted field minted
 * a link anybody could keep claiming. That reasoning is preserved where
 * reasoning lives, in ENGINEERING.md's 2026-08-24 stratum.
 *   ⚠ **AND IT MUST NOT COME BACK NOW THE MEMBER CAP HAS (2026-08-26,
 *   Samuel's ruling: a container takes MORE THAN TWO people).** The field was
 *   removed while the two-member cap was ALSO answering the question, which
 *   made single-use look over-determined; it is not, it is now the ONLY thing
 *   bounding how a container grows. A multi-use link into a room whose size
 *   nothing counts is a URL that admits everyone it is forwarded to. Adding
 *   person #3 is a FRESH MINT, deliberately.
 *
 * ⚠ `expiresAt` must be in the FUTURE. Minting an already-dead link is a
 * validation failure, not a link: the caller gets a URL that 410s on its first
 * open and no error to explain it.
 *
 * ⚠ `grantedRole` is the role the CLAIMER lands at (migration 20260825150000;
 * closes F-319). The enum is the DB CHECK's ceiling — `member` is the top a link
 * can confer, `admin`/`owner`-via-link being unrepresentable — and the service
 * adds a grant-above-self guard on top: a minter cannot hand out a role above
 * their own (`mintContainerLink`).
 *
 * 🔒 ⚠ IT IS `optional()` AND **NOT** `default("guest")`, AND THE DIFFERENCE IS
 * A ROTATION (2026-08-26). Under `.default("guest")` the parser could not tell
 * "the operator picked Guest" from "the field is absent" — so a pre-M2 client,
 * or any body omitting it, pressing "Add person" against an open **member** link
 * took the M3 mismatch branch: the operator's outstanding invitation was
 * REVOKED, a guest link minted in its place, 200, no signal. Before M3 that same
 * request returned the member link verbatim. **ABSENT now means "reuse whatever
 * is open"** — the pre-M3 semantics, restored — and only a body that STATES a
 * role can revoke one. The FRESH-mint default is still `guest` and still lives
 * in the service (`mintContainerLink › roleToMint`), where it fails closed;
 * moving it here is what conflated the two cases.
 */
export const HomeLinkMintSchema = z.object({
  workspaceId: z.string().uuid(),
  label: z.string().trim().min(1).max(80).nullish(),
  grantedRole: z.enum(["guest", "viewer", "member"]).optional(),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .refine((iso) => Date.parse(iso) > Date.now(), {
      message: "expiresAt must be in the future",
    })
    .nullish(),
});

/** The PARSED input. */
export type HomeLinkMintInput = z.infer<typeof HomeLinkMintSchema>;

/** What a client may SEND. */
export type HomeLinkMintBody = z.input<typeof HomeLinkMintSchema>;
