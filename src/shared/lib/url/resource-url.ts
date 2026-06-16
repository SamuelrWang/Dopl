import { composeSegment } from "./parse-segment";

interface SegmentParts {
  slug: string;
  publicId: string;
}

/**
 * Build the absolute web URL for a single knowledge-base entry:
 * `{origin}/{workspaceSegment}/knowledge/{baseSegment}?entryId={id}`.
 *
 * Lives in `shared/` because it composes a workspace segment with a
 * knowledge segment — spanning two features, it can't live in either
 * feature's `url.ts` without a sideways import (ENGINEERING §3). It
 * depends only on `composeSegment`, never on feature code.
 *
 * Callers MUST pass `workspace`/`base` resolved through the access-
 * checked service getters — never raw repository rows — so the URL can
 * only ever reference a resource the caller is entitled to.
 */
export function knowledgeEntryUrl(input: {
  origin: string;
  workspace: SegmentParts;
  base: SegmentParts;
  entryId: string;
}): string {
  const ws = composeSegment(input.workspace.slug, input.workspace.publicId);
  const kb = composeSegment(input.base.slug, input.base.publicId);
  return `${input.origin}/${ws}/knowledge/${kb}?entryId=${encodeURIComponent(input.entryId)}`;
}

/**
 * Build the absolute web URL for a skill:
 * `{origin}/{workspaceSegment}/skills/{skillSegment}`. A skill is a
 * single addressable resource — there is no per-file URL. Same access-
 * checked-input contract as {@link knowledgeEntryUrl}.
 */
export function skillUrl(input: {
  origin: string;
  workspace: SegmentParts;
  skill: SegmentParts;
}): string {
  const ws = composeSegment(input.workspace.slug, input.workspace.publicId);
  const sk = composeSegment(input.skill.slug, input.skill.publicId);
  return `${input.origin}/${ws}/skills/${sk}`;
}
