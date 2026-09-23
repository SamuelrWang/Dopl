import type { WorkspaceKind } from "@dopl/contracts";
import type { AgentIdentity, IdentityVisibility } from "../client/types";

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

export interface IdentitySectionDef {
  visibility: IdentityVisibility;
  /** What the panel is titled. */
  label: string;
  /** The quiet line a section with no identities says. Absent = an empty
   *  section says nothing under its header (the /home Agents face's shared
   *  section, Samuel 2026-09-19). */
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
 * The same axis inside a link CONTAINER — the /home Agents face.
 *
 * 🔒 ⚠ **ONE OPTION SINCE 2026-08-27, AND THE DELETED ONE IS THE POINT.** It
 * held `workspace` AND `private`; Samuel's ruling removed the per-channel
 * private section from this pane (converging it on the Knowledge face), which
 * makes a `private` CONTAINER identity **reachable from nowhere**: /home no
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
export const SECTIONS_CONTAINER: ReadonlyArray<IdentitySectionDef> = [
  {
    visibility: "workspace",
    label: "Shared in this channel",
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
 * ⚠ ITS ROWS ALSO LIVE IN THE CALLER'S PERSONAL CONTAINER — the visibility field
 * here is the AUDIENCE axis, and the SHELF axis is a tenancy the client never
 * sees on a row (`../types.ts › IdentityShelf`).
 */
export const SECTION_PRIVATE_EVERYWHERE: IdentitySectionDef = {
  visibility: "private",
  label: "Personal",
  emptyLine: "You haven't created an identity here yet.",
};

/**
 * Group the list the server returned by its `visibility` field, and NOTHING
 * else.
 *
 * ⚠ THE CLIENT DOES NOT FILTER. The server decides what the caller may see —
 * their own private identities, their teams' identities, the workspace's public
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
 * 🔒 **NO TEAM SCOPE OUTSIDE A STANDARD WORKSPACE — SAMUEL'S RULING,
 * 2026-09-08.** Verbatim, because this function exists for it: *"we should
 * remove the team option, if it's in the home space, because the team thing is
 * for workspaces."*
 *
 * ⚠ **IT WAS ALREADY BROKEN ON THE WIRE, WHICH IS WHY IT IS A RULE AND NOT A
 * PREFERENCE.** The /home Agents pane's Personal mount writes with `shelf:
 * "home"`, which routes the row into the caller's PERSONAL container — and
 * `server/service-write-gates.ts › resolveIdentityCreateDestination` has
 * refused `team` on that path since the container migration. So the option was
 * a control whose only outcome was a 403 the operator could not act on. A link
 * CONTAINER is the same story from the other side: it holds members and no team
 * rows (INVARIANTS §4A), so the value has no referent there either.
 *
 * ⚠ **POSITIVE FORM — `=== "standard"`, never `!== "link"`.** The negative
 * spelling admits every kind nobody has designed yet, and a team GRANT is the
 * wrong thing to hand a future container kind by default (`workspaces/types.ts ›
 * isStandardWorkspace` states the same rule for the listing predicate; this is a
 * mirror rather than an import, §1).
 *
 * ⚠ **THE CLIENT IS THE SECOND FENCE, NEVER THE ONLY ONE.** The server's is
 * `server/service-write-gates.ts › assertTeamScopeGrantable`, on the create AND
 * the update path.
 */
function offersTeamScope(kind: WorkspaceKind): boolean {
  return kind === "standard";
}

/** ⚠ A WORD OR TWO, on the STRANDED pill only (INVARIANTS §5, minimal copy). */
const TEAM_SCOPE_DEAD_HINT = "workspace only";

/**
 * A row that is ALREADY `team` inside a container that has no teams.
 *
 * 🔒 ⚠ **IT IS NOT REWRITTEN, AND THAT IS THE WHOLE OF THE STATE.** Silently
 * moving a stored audience to `private` on open would be this editor deciding a
 * sharing fact nobody asked it to decide (INVARIANTS §11) — and doing it on a
 * form the operator might close without saving, so the surface and the row would
 * disagree. It is SHOWN, hinted, and Save is refused until the operator picks a
 * value the container can hold.
 */
export function teamScopeStranded(
  kind: WorkspaceKind,
  selected: IdentityVisibility
): boolean {
  return selected === "team" && !offersTeamScope(kind);
}

/** One pill on the editor's Visibility row. */
interface VisibilityOption {
  visibility: IdentityVisibility;
  /** ⚠ FROM {@link SECTIONS} / {@link SECTIONS_CONTAINER}, never hand-typed. */
  label: string;
  hint?: string;
}

/**
 * THE VISIBILITY PILLS a mount offers, IN THE SECTION ARRAY'S ORDER.
 *
 * ⚠ **THE ARRAY IS STILL THE CONTROL** (the container mount's one option is
 * `SECTIONS_CONTAINER`, and this function does not second-guess it); what this
 * adds is the KIND axis, which no array can carry because one array serves a
 * standard workspace and a personal shelf alike.
 */
export function visibilityOptions(
  sections: ReadonlyArray<IdentitySectionDef>,
  kind: WorkspaceKind,
  selected: IdentityVisibility
): ReadonlyArray<VisibilityOption> {
  return sections.flatMap((section) => {
    if (section.visibility !== "team" || offersTeamScope(kind)) {
      return [{ visibility: section.visibility, label: section.label }];
    }
    // The stranded row keeps its pill — see `teamScopeStranded`.
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
