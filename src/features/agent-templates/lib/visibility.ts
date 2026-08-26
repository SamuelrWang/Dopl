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
 * ⚠ **TWO OPTIONS, BECAUSE `team` IS A DEAD VALUE HERE.** A container has no
 * teams (§4A: one channel, one or two members), so `team` has no referent and a
 * third option would offer a scope that can never resolve to anybody. The
 * editor mounted against a container derives its visibility control from THIS
 * array for the same reason the workspace page derives it from {@link SECTIONS}.
 * ⚠ A `team` row that arrives anyway is DROPPED by {@link groupByVisibility} —
 * never re-filed under `private` or `workspace`, which would be this surface
 * inventing a sharing fact (INVARIANTS §11).
 *
 * ⚠ THE ORDER IS THE PANE: SHARED first, then PRIVATE. It is the reverse of the
 * workspace page's, and deliberately so — "who else can wear this identity" is
 * the question a relationship surface leads with (`home-agents-tab.plan.md` §1).
 */
export const SECTIONS_CONTAINER: ReadonlyArray<TemplateSectionDef> = [
  {
    visibility: "workspace",
    label: "Shared in this channel",
    emptyLine: "No agent is shared into this channel yet.",
  },
  {
    visibility: "private",
    label: "Private",
    emptyLine: "You haven't created an agent in this channel.",
  },
];

/**
 * Scope C — the caller's OWN workspace, asked the same private question from
 * inside a channel pane. Not a member of {@link SECTIONS_CONTAINER}: it reads a
 * DIFFERENT workspace, so it is a scope of the private section rather than a
 * fourth section, and its empty sentence has to differ from the container's or
 * the two states read as one (`home-agents-tab.plan.md` §4.3).
 */
export const SECTION_PRIVATE_EVERYWHERE: TemplateSectionDef = {
  visibility: "private",
  label: "Private",
  emptyLine: "You have no private agents in your own workspace.",
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
