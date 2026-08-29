import type { AgentTemplate, TemplateVisibility } from "../client/types";

/**
 * THE ONE PLACE the wire's visibility vocabulary meets the operator's.
 *
 * ⚠ `workspace` READS AS "PUBLIC" (Samuel's mock). Two names for one fact is
 * exactly the drift this module exists to contain: the value on the wire stays
 * `workspace` everywhere — request bodies, the grouping below, the editor's
 * segmented control — and the WORD "Public" exists only in {@link SECTIONS}. A
 * second `visibility === "public"` comparison anywhere is a bug that type-checks
 * (the union has no such member) or a label hand-typed into a component, which
 * does not.
 *
 * ⚠ THE ORDER IS THE PAGE. The three panels stack Private → Team → Public, and
 * the page renders `SECTIONS` rather than an array literal of its own, so the
 * order cannot be stated twice.
 *
 * ⚠ TWO SURFACES, TWO LABEL SETS, ONE MODULE ({@link SECTIONS} for a STANDARD
 * workspace, {@link SECTIONS_CONTAINER} + {@link SECTION_PRIVATE_EVERYWHERE} for
 * a link CONTAINER — the /home Agents face, INVARIANTS §5A). They live side by
 * side ON PURPOSE: two arrays in one module cannot drift the way two components
 * hand-typing their own headings can, and the container's section-A heading is
 * **"Shared in this channel", never "Public"** — inside a container `workspace`
 * means "the other person in this relationship", which is a different sentence
 * from "everyone in your company".
 */

export interface TemplateSectionDef {
  visibility: TemplateVisibility;
  /** What the panel is titled. */
  label: string;
  /** The quiet line a section with no templates says. */
  emptyLine: string;
}

export const SECTIONS: ReadonlyArray<TemplateSectionDef> = [
  {
    visibility: "private",
    label: "Private",
    emptyLine: "No private templates yet.",
  },
  {
    visibility: "team",
    label: "Team",
    emptyLine: "No team templates yet.",
  },
  {
    visibility: "workspace",
    label: "Public",
    emptyLine: "No public templates yet.",
  },
];

/**
 * The same axis inside a link CONTAINER — the /home Agents face.
 *
 * 🔒 ⚠ **ONE OPTION SINCE 2026-08-27, AND THE DELETED ONE IS THE POINT.** It
 * held `workspace` AND `private`; Samuel's ruling removed the per-channel
 * private section from this pane (converging it on the Knowledge face), which
 * makes a `private` CONTAINER template **reachable from nowhere**: /home no
 * longer lists it, and a container is not navigable at all — `isStandardWorkspace`
 * keeps it off the rail, so it has no workspace Agents page of its own.
 * **Offering `private` here would create write-only rows.** The container
 * editor derives its visibility control from this array, so trimming the array
 * is what closes that door — do not "restore" the second entry.
 *
 * ⚠ `team` WAS ALREADY DEAD HERE and still is: a container has no teams (§4A),
 * so the value has no referent. A `team` (or `private`) row that arrives anyway
 * is DROPPED by {@link groupByVisibility} — never re-filed, which would be this
 * surface inventing a sharing fact (INVARIANTS §11).
 *
 * ⚠ INSIDE A CONTAINER, `workspace` MEANS "THE OTHER PEOPLE IN THIS
 * RELATIONSHIP" — hence "Shared in this channel", never "Public".
 */
export const SECTIONS_CONTAINER: ReadonlyArray<TemplateSectionDef> = [
  {
    visibility: "workspace",
    label: "Shared in this channel",
    emptyLine: "No agent is shared into this channel yet.",
  },
];

/**
 * The PERSONAL section — the caller's own HOME SHELF, always (Samuel's ruling
 * 2026-08-27). Not a member of {@link SECTIONS_CONTAINER} because it reads a
 * DIFFERENT workspace: the container array describes what lives in the channel,
 * this describes what lives on the operator's own shelf.
 *
 * ⚠ **"Personal", NOT "Private" — UI COPY ONLY.** `visibility: 'private'` is
 * unrenamed everywhere it is stored, read or fenced (this def still carries it);
 * the word above a section and the value in a column are different things and
 * must not be conflated in a predicate or a grep.
 *
 * ⚠ ITS ROWS ARE ALSO `home_scoped` — the visibility field here is the audience
 * axis, and the SHELF axis is a server filter the client never sees
 * (`../types.ts › TemplateShelf`).
 */
export const SECTION_PRIVATE_EVERYWHERE: TemplateSectionDef = {
  visibility: "private",
  label: "Personal",
  emptyLine: "You haven't created an agent here yet.",
};

/**
 * Group the list the server returned by its `visibility` field, and NOTHING
 * else.
 *
 * ⚠ THE CLIENT DOES NOT FILTER. The server decides what the caller may see —
 * their own private templates, their teams' templates, the workspace's public
 * ones — so a row arriving here has already passed that gate. A second
 * "is this mine?" test on the client would either duplicate the rule (and drift
 * from it) or hide a row the server deliberately sent.
 *
 * ⚠ A ROW WITH AN UNKNOWN VISIBILITY IS DROPPED FROM THE SECTIONS, not forced
 * into one. A newer server may mint a fourth scope, and filing it under "Private"
 * would be this page claiming something it does not know (INVARIANTS §11 —
 * UNKNOWN is not EMPTY, and it is not a guess either).
 */
export function groupByVisibility(
  templates: ReadonlyArray<AgentTemplate>
): Record<TemplateVisibility, AgentTemplate[]> {
  const grouped: Record<TemplateVisibility, AgentTemplate[]> = {
    private: [],
    team: [],
    workspace: [],
  };
  for (const template of templates) {
    const bucket = grouped[template.visibility];
    if (bucket) bucket.push(template);
  }
  return grouped;
}
