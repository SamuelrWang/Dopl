import { z } from "zod";

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
 */
export const HomeChannelCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
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
 * A bound link fills the container's ONE free seat, so the service pins
 * `maxUses: 1` by construction and a client cannot ask for otherwise. The field
 * used to distinguish ABSENT from NULL — absent meaning "the caller said
 * nothing" and taking the safe single-use default, an explicit `null` meaning
 * "multi-use, I meant it" — a distinction bought by an incident where an omitted
 * field minted a link anybody could keep claiming. That reasoning is preserved
 * where reasoning lives, in ENGINEERING.md's 2026-08-24 stratum; what removed
 * the field is that the two-member cap now answers the question the field asked.
 *
 * ⚠ `expiresAt` must be in the FUTURE. Minting an already-dead link is a
 * validation failure, not a link: the caller gets a URL that 410s on its first
 * open and no error to explain it.
 */
export const HomeLinkMintSchema = z.object({
  workspaceId: z.string().uuid(),
  label: z.string().trim().min(1).max(80).nullish(),
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
