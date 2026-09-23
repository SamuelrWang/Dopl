import type { WorkspaceKind } from "@dopl/contracts";
import type { AgentIdentity, IdentityVisibility } from "../client/types";

/**
 * Where the wire's visibility meets the operator's words: `workspace` is the value everywhere, and
 * "Public" (or, in a container, "Shared in this channel") is only a label here. Array order = page order.
 */

export interface IdentitySectionDef {
  visibility: IdentityVisibility;
  /** What the panel is titled. */
  label: string;
  /** The line an empty section says; absent = nothing under the header. */
  emptyLine?: string;
}

export const SECTIONS: ReadonlyArray<IdentitySectionDef> = [
  {
    visibility: "private",
    label: "Private",
    emptyLine: "No private identities yet.",
  },
  {
    visibility: "team",
    label: "Team",
    emptyLine: "No team identities yet.",
  },
  {
    visibility: "workspace",
    label: "Public",
    emptyLine: "No public identities yet.",
  },
];

/**
 * Inside a link container only `workspace` is offered: a `private` container row is listed nowhere,
 * and a container has no teams. The container editor derives its control from this array.
 */
export const SECTIONS_CONTAINER: ReadonlyArray<IdentitySectionDef> = [
  {
    visibility: "workspace",
    label: "Shared in this channel",
  },
];

/** The /home Personal section — the caller's personal container. "Personal" is copy; the value is `private`. */
export const SECTION_PRIVATE_EVERYWHERE: IdentitySectionDef = {
  visibility: "private",
  label: "Personal",
  emptyLine: "You haven't created an identity here yet.",
};

/**
 * Group by `visibility` and nothing else — the server already filtered. A row with an unknown
 * visibility is dropped, never filed under a guess (INVARIANTS §11).
 */
export function groupByVisibility(
  identities: ReadonlyArray<AgentIdentity>
): Record<IdentityVisibility, AgentIdentity[]> {
  const grouped: Record<IdentityVisibility, AgentIdentity[]> = {
    private: [],
    team: [],
    workspace: [],
  };
  for (const identity of identities) {
    const bucket = grouped[identity.visibility];
    if (bucket) bucket.push(identity);
  }
  return grouped;
}

/**
 * No team scope outside a standard workspace (Samuel's ruling). Positive form, a hand mirror of
 * `workspaces/types.ts › isStandardWorkspace` (§1); the server fence is `assertTeamScopeGrantable`.
 */
function offersTeamScope(kind: WorkspaceKind): boolean {
  return kind === "standard";
}

/** On the stranded pill only (minimal copy, INVARIANTS §5). */
const TEAM_SCOPE_DEAD_HINT = "workspace only";

/** A stored `team` row in a container without teams: shown and hinted, Save refused — never rewritten. */
export function teamScopeStranded(
  kind: WorkspaceKind,
  selected: IdentityVisibility
): boolean {
  return selected === "team" && !offersTeamScope(kind);
}

/** One pill on the editor's Visibility row. */
interface VisibilityOption {
  visibility: IdentityVisibility;
  /** From {@link SECTIONS} / {@link SECTIONS_CONTAINER}, never hand-typed. */
  label: string;
  hint?: string;
}

/** The visibility pills a mount offers, in section order, minus `team` where the container kind has none. */
export function visibilityOptions(
  sections: ReadonlyArray<IdentitySectionDef>,
  kind: WorkspaceKind,
  selected: IdentityVisibility
): ReadonlyArray<VisibilityOption> {
  return sections.flatMap((section) => {
    if (section.visibility !== "team" || offersTeamScope(kind)) {
      return [{ visibility: section.visibility, label: section.label }];
    }
    // The stranded row keeps its pill (`teamScopeStranded`).
    return selected === "team"
      ? [
          {
            visibility: section.visibility,
            label: section.label,
            hint: TEAM_SCOPE_DEAD_HINT,
          },
        ]
      : [];
  });
}
