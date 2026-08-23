import { z } from "zod";

/**
 * `POST /api/home/links`. The default link is unlabelled, never expires and is
 * SINGLE-USE — a home link is "here, talk to me", sent to one person, and the
 * desktop's own picker defaults to Single use beside it
 * (`pages/home/new-link-popover.tsx`).
 *
 * ⚠ `maxUses` DISTINGUISHES ABSENT FROM NULL, which is why it is `.nullable()
 * .default(1)` rather than `.nullish()`. Absent = "the caller said nothing" and
 * takes the safe default; an explicit `null` = "multi-use, I meant it". Folding
 * the two together made an omitted field mint a link anybody could keep
 * claiming.
 *
 * ⚠ `expiresAt` must be in the FUTURE. Minting an already-dead link is a
 * validation failure, not a link: the caller gets a URL that 410s on its first
 * open and no error to explain it.
 *
 * ⚠ NOT under `server/`: this is the only module on the surface both sides
 * need, and the desktop renderer's ESLint fence blocks every `features/<x>/
 * server/` path outright. Keeping it here is what lets the SPA import the
 * request type instead of re-declaring it.
 */
export const HomeLinkMintSchema = z.object({
  label: z.string().trim().min(1).max(80).nullish(),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .refine((iso) => Date.parse(iso) > Date.now(), {
      message: "expiresAt must be in the future",
    })
    .nullish(),
  maxUses: z.number().int().min(1).max(1000).nullable().default(1),
});

/** The PARSED input — `maxUses` is resolved, so the service never defaults again. */
export type HomeLinkMintInput = z.infer<typeof HomeLinkMintSchema>;

/** What a client may SEND. Differs from the parsed shape by the `maxUses`
 *  default, which is exactly the distinction the two types exist to keep. */
export type HomeLinkMintBody = z.input<typeof HomeLinkMintSchema>;
