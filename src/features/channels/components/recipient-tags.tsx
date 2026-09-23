"use client";

/** Channels — who a post reached, beside the attribution pill. Faces are resolved in
 *  `lib/recipient-tags.ts`, never here (keeps raw ids off screen). */

import type { RecipientTag } from "../lib/recipient-tags";

/** One shape for agents and people; explicit height + `items-center` centres the text box. */
const TAG_FACE =
  "inline-flex h-[16px] min-w-0 max-w-[14rem] items-center rounded-full bg-bg-inset px-1.5 text-micro font-medium leading-none text-link";

/** The delivered-to faces, in order; empty draws nothing (never a marker). */
export function RecipientTags({ tags }: { tags: readonly RecipientTag[] }) {
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((tag) => (
        <span
          key={`${tag.kind}:${tag.id}`}
          title={tag.title === tag.face ? undefined : tag.title}
          /* Test hook: the same face can also appear in the body as a typed mention. */
          data-recipient-tag={tag.kind}
          className={TAG_FACE}
        >
          <span className="truncate">{tag.face}</span>
        </span>
      ))}
    </>
  );
}
