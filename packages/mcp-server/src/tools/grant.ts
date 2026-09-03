/**
 * grant.ts — 🔒 **THE ONE PLACE A LEND IS COMPOSED**, shared by
 * `dopl_kb(op="grant")` and `dopl_agent(op="grant")` exactly as `copy-target.ts`
 * was shared by the two copy ops it replaces (Wave B slice B15, Samuel's ruling
 * B11: *grants replace copies*; F-419 disposed by deletion).
 *
 * ── WHY A GRANT AND NOT A COPY ──────────────────────────────────────────────
 *
 * A copy made a SECOND ROW that was a stranger to the first from the moment it
 * landed: no FK, no back-pointer, no sync, and an edit to the original reached
 * nothing. It also dropped everything that could not cross a tenancy — a
 * template's attached bases, a base's grants — so what arrived was a thinner
 * thing wearing the same name. **A grant lends the ONE row.** It stays where its
 * author edits it, an edit reaches everyone it is lent to, and the scope decides
 * the audience rather than the copier's tenancy.
 *
 * ── 🔒 THE FENCE, WHICH IS THE SERVER'S, RESTATED HERE FOR THE SENTENCE ─────
 *
 * `PUT /api/resource-grants` fences both sides (`src/shared/grants/service.ts`):
 * the resource must be one the caller CREATED, the scope must be one they reach
 * at `member`+, and `enforce_resource_grant()` refuses whatever is left. This
 * module runs the OWNERSHIP half LOCALLY as well ({@link notOwnedRefusal}) and
 * that is NOT a second fence: the resolvers already read the row, so a refusal
 * costs no round trip and can name what the server's uniform 404 deliberately
 * cannot. ⚠ **It is a NARROWING of a read that was already fenced** — R2,
 * carried over from the copy ops verbatim rather than re-decided.
 */

import type { WorkspaceDirectory } from "../workspace-directory.js";
import { inlineOr } from "./narration.js";
import { err, ok, type ToolResponse } from "./respond.js";

/** A row with nothing nameable left after neutralization. */
const NO_NAME = "`(unnamed)`";

/**
 * Where a resource can be lent, **AS OFFERED HERE**.
 *
 * ⚠ **THE TABLE TAKES A THIRD SCOPE AND THIS SURFACE DOES NOT OFFER IT.**
 * `resource_grants.scope_type` also accepts the team axis (ruling B4 kept the
 * capability), and `src/shared/grants/schema.ts` accepts it from the app. It is
 * absent HERE under A8's standing rule — **this surface does not teach an axis
 * with zero live rows behind it**, because every arm of an enum is read, weighed
 * and occasionally PICKED by every connected client forever, whether or not
 * anything is behind it. `agent-team-axis.test.ts` is what holds that, over the
 * SERVED strings, so this enum and every description below it are scanned.
 * ⚠ Adding the arm back is a DECISION that goes through that test, not a widening.
 */
export const GRANT_SCOPE_VALUES = ["channel", "container"] as const;
export type GrantScopeArg = (typeof GRANT_SCOPE_VALUES)[number];

/**
 * ⚠ **TWO VOCABULARIES IN ONE ENUM, AND THE PAIRING IS CHECKED, NOT PUBLISHED
 * AS FOUR INTERCHANGEABLE WORDS.** `agent_only`/`visible` are CHANNEL words —
 * two AUDIENCES inside a room, never a high/low pair — and `read`/`edit` are the
 * other two scopes'. `resource_grants_level_check` is a `CASE` over exactly
 * this, so a mismatched pair is refused at the door by {@link levelForScope}
 * rather than by a `23514` with no field name.
 */
export const GRANT_LEVEL_VALUES = [
  "visible",
  "agent_only",
  "read",
  "edit",
] as const;
export type GrantLevelArg = (typeof GRANT_LEVEL_VALUES)[number];

const LEVELS_BY_SCOPE: Record<GrantScopeArg, readonly GrantLevelArg[]> = {
  channel: ["visible", "agent_only"],
  container: ["read", "edit"],
};

/**
 * The level to send, or the refusal. ⚠ **THE DEFAULT IS THE NARROWER WORD IN
 * EVERY VOCABULARY** (`visible` names the humans in the room but hands nobody a
 * pen; `read` likewise), because an omitted argument must never be the widening
 * one — the same rule the deleted shelf fence stated as "the default is false
 * and silent".
 */
export function levelForScope(
  scope: GrantScopeArg,
  level: GrantLevelArg | undefined,
): GrantLevelArg | ToolResponse {
  const legal = LEVELS_BY_SCOPE[scope];
  if (level === undefined) return legal[0];
  if (legal.includes(level)) return level;
  return err(
    `Refused before writing: \`level="${level}"\` is not a ${scope} level, so nothing was shared. A ${scope} scope takes ${legal.map((l) => `\`${l}\``).join(" or ")} — the two vocabularies are different questions, not a high/low pair, and the database refuses the mismatch.`,
  );
}

/** Narrow the `resolve → value | refusal` union. */
export function isGrantRefusal(x: unknown): x is ToolResponse {
  return (
    typeof x === "object" &&
    x !== null &&
    "isError" in x &&
    (x as ToolResponse).isError === true
  );
}

/**
 * 🔒 **R2 — YOU LEND WHAT YOU CREATED, NOT WHAT YOU CAN READ** (Desktop Agent
 * default 2026-09-02, carried from `copy-target.ts › notOwnedRefusal`; Samuel
 * may loosen).
 *
 * Both ops resolve their resource through the ordinary READ resolvers, which
 * answer everything the caller can SEE — a teammate's `workspace`-visible
 * template, a shared base. Lending one of those into a room that teammate is not
 * in is the one direction a grant widens somebody ELSE's audience.
 *
 * ⚠ **AND IT FAILS CLOSED ON AN UNKNOWN.** `createdBy` is nullable (rows older
 * than the column, and an author who left — `SET NULL`) and the caller's own id
 * is nullable (auth did not resolve). Neither is evidence of ownership, so
 * neither passes.
 */
export function notOwnedRefusal(
  createdBy: string | null | undefined,
  selfUserId: string | null,
  noun: string,
  ref: string,
): ToolResponse | null {
  if (selfUserId && createdBy && createdBy === selfUserId) return null;
  return err(
    `Refused: op="grant" lends ${noun}s YOU created, and ${inlineOr(ref, NO_NAME)} is not one of them. NOTHING was shared. Being able to read it is not the same as being able to lend it — a grant puts it in front of everyone in the scope you named. ${
      selfUserId
        ? `Ask its owner to share it.`
        : `(This session could not resolve who you are, so ownership cannot be proved at all — reconnect with a credential that carries your user id.)`
    }`,
  );
}

/**
 * `to` → the scope id to write.
 *
 * ⚠ **A CHANNEL AND A TEAM ARE NAMED BY ID; A CONTAINER GOES THROUGH THE
 * SESSION'S OWN RESOLVER.** `workspace-directory.ts › resolveWorkspaceRef` is
 * the one resolver that takes a slug, a uuid **or** a home-channel CONTAINER id
 * (§4A: it deliberately does not filter) and that answers `null` for every ref
 * but the locked one under a container lock — so the lend inherits B3's fence
 * for free and never falls back to the workspace the call is in.
 *
 * ⚠ **THE REFUSAL IS UNIFORM.** "No such scope" and "not one you can act in"
 * stay ONE answer; a sentence that distinguished them is an existence oracle
 * over the operator's other rooms.
 */
export async function resolveGrantScopeId(
  directory: WorkspaceDirectory,
  scope: GrantScopeArg,
  to: string,
): Promise<string | ToolResponse> {
  const needle = to.trim();
  if (needle === "") return unresolvableScope(scope, to);
  if (scope !== "container") return needle;
  const target = await directory.resolveWorkspaceRef(needle);
  return target ? target.id : unresolvableScope(scope, to);
}

function unresolvableScope(scope: GrantScopeArg, to: string): ToolResponse {
  return err(
    `\`to\` ${inlineOr(to, "`(unreadable ref)`")} does not resolve as a ${scope} you can act in, so NOTHING was shared — this op never falls back to the workspace you are calling from. Either there is no such ${scope} or it is not one you can act in; those are one answer here on purpose. Container ids come from dopl_home(op="list_channels") and \`list_workspaces\`; a channel id is a uuid from dopl_channel(op="rooms", action="list").`,
  );
}

/**
 * The three argument descriptions, worded ONCE for both tools. ⚠ They name the
 * SCOPE/level pairing rather than restating the enums — the JSON Schema already
 * publishes those as keywords, and a description that repeats a keyword is the
 * same fact pushed twice on every connection (`tool-budget.test.ts`).
 */
export const GRANT_SCOPE_ARG_DESCRIPTION =
  `op=grant (required): WHERE to lend it — "channel" (everyone in that room) or "container" (a home channel or workspace, by ref). The scope decides the audience; the row itself never moves.`;

export const GRANT_TO_ARG_DESCRIPTION =
  `op=grant (required): the scope's handle — a channel UUID, or for scope="container" a workspace slug/UUID or a home-channel CONTAINER id from dopl_home(op="list_channels"). It must be one you are a member of; an id that does not resolve for you refuses and shares nothing, and there is no fallback to the workspace you are calling from.`;

export const GRANT_LEVEL_ARG_DESCRIPTION =
  `op=grant: "visible" or "agent_only" on a CHANNEL scope (two audiences inside the room, not a high/low pair); "read" or "edit" on a container. Omitted, the narrower one for the scope. Mixing the two vocabularies is refused.`;

/** The `granted` line both tools answer with. ⚠ ONE sentence per fact, and the
 *  DIVERGENCE sentence is the one the copy ops had to carry as a warning: a
 *  grant does not have that problem, and saying so is what stops a caller
 *  reaching for a copy that no longer exists. */
export function grantedLine(
  noun: string,
  name: string,
  scope: GrantScopeArg,
  scopeId: string,
  level: GrantLevelArg,
): ToolResponse {
  return ok(
    `Shared the ${noun} ${inlineOr(name, NO_NAME)} into the ${scope} \`${scopeId}\` at \`${level}\`. It is ONE row, still yours and still where you edit it — an edit reaches everyone it is lent to, which is the whole difference from the copy this replaced. Re-sending the same call only changes the level.`,
  );
}
