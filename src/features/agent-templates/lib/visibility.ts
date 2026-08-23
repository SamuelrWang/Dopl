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
