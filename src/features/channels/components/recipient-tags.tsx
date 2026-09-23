"use client";

/**
 * Channels — **WHO THIS POST REACHED, BESIDE THE PILL THAT SAYS WHO WROTE IT**
 * (Samuel, 2026-09-22, decision #2200 option 1).
 *
 * ⚠ **THE FACES ARRIVE AS WORDS AND THIS FILE RESOLVES NOTHING.**
 * `lib/recipient-tags.ts › recipientTags` turns the server-stamped `to=` ids into
 * `{face, title}` pairs; a component that looked an id up itself would be a second
 * spelling of one address, and it would put a machine token one typo away from the
 * screen (`agent-id-visibility.test.ts`).
 *
 * ⚠ **BLUE INK, GREY GROUND, `text-micro` — COMPOSED, NOT INVENTED** (docs/DESIGN-SYSTEM.md).
 * `--link` is this surface's ROUTING colour: a tinted `@handle` in a body
 * (`message-markdown-mentions.tsx`), the composer's live tint, the unread dot — so
 * an ADDRESS is the one thing it should mean here, and `authored-row.tsx ›
 * FLASH_TINT` carries the note about what tinting something blue claims. The
 * capsule is `attribution-pill.tsx › AgentChip`'s own shape, for the reason that
 * one states: an explicit height plus `items-center` centres the text BOX at every
 * font size, where a bare inline span sits it on a baseline.
 *
 * ⚠ **UNOBTRUSIVE IS PART OF THE ASK.** It sits a step below the name it follows
 * and never above the body text: the reader who wants it glances, and the reader
 * who does not skips the line.
 */

import type { RecipientTag } from "../lib/recipient-tags";

/** ⚠ ONE SHAPE FOR BOTH NAMESPACES. An agent and a person are addressed the same
 *  way and reached the same way, so a second face here would be the transcript
 *  claiming a difference the delivery does not have. */
const TAG_FACE =
  "inline-flex h-[16px] min-w-0 max-w-[14rem] items-center rounded-full bg-bg-inset px-1.5 text-micro font-medium leading-none text-link";

/**
 * The delivered-to faces, in order, or NOTHING at all.
 *
 * ⚠ **EMPTY DRAWS NOTHING AND NEVER A MARKER.** A record reached nobody by design,
 * and so does every row written before the address columns existed — one silence
 * for both, because a "record" badge on the first would be missing from the second
 * and a reader cannot tell them apart anyway (`lib/recipient-tags.ts` carries the
 * argument).
 */
export function RecipientTags({ tags }: { tags: readonly RecipientTag[] }) {
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((tag) => (
        <span
          key={`${tag.kind}:${tag.id}`}
          /* ⚠ ONLY WHERE THE FACE REPLACED SOMETHING — `message-markdown-mentions.tsx`'s
             rule: a title equal to the visible text is noise the browser still renders. */
          title={tag.title === tag.face ? undefined : tag.title}
          /* A STABLE HOOK, on `attribution-pill.tsx`'s `data-attribution-pill` precedent and
             for a sharper reason: the same face can legitimately appear in the BODY as a typed
             mention, so a test asking "is there a tag on this row" cannot ask for its text.
             Carries no meaning and is never read back by this tree. */
          data-recipient-tag={tag.kind}
          className={TAG_FACE}
        >
          <span className="truncate">{tag.face}</span>
        </span>
      ))}
    </>
  );
}
