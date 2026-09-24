/**
 * The one place a lend is composed, for `dopl_kb(op="grant")` and `dopl_agent(op="grant")`. A grant
 * lends the ONE row (an edit reaches everyone it is lent to). The fence is the server's
 * (`src/shared/grants/service.ts`); the local ownership check only narrows an already-fenced read
 * so the refusal can name what the server's uniform 404 cannot.
 */

import { calledAs, callRef, legacyOnly } from "../call-ref.js";
import {
  isAmbiguousContainer,
  type WorkspaceDirectory,
} from "../workspace-directory.js";
import { ambiguousContainer } from "../container-resolve.js";
import { inlineOr, NO_NAME } from "./narration.js";
import { apiErrorCode, err, ok, type ToolResponse } from "./respond.js";

/** Scopes offered here. The table also takes `team`, deliberately not taught on MCP
 *  (`agent-team-axis.test.ts` holds that over the served strings). */
export const GRANT_SCOPE_VALUES = ["channel", "container"] as const;
export type GrantScopeArg = (typeof GRANT_SCOPE_VALUES)[number];

/** Two vocabularies in one enum: channel AUDIENCES (`visible`/`agent_only`, not a high/low pair) and
 *  container levels (`read`/`edit`); the pairing is checked by {@link levelForScope}, as the DB CHECK does. */
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

/** The level to send, or the refusal. An omitted level is the narrower word, never the widening one. */
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

/** Translates the server's `SCOPE_NOT_ALLOWED_IN_WORKSPACE` (channel scope is a home-channel
 *  mechanism). Not provable locally: `to` is a bare channel uuid. */
export function channelScopeRefusal(e: unknown): ToolResponse | null {
  if (apiErrorCode(e) !== "SCOPE_NOT_ALLOWED_IN_WORKSPACE") return null;
  return err(
    `Refused: NOTHING was shared. In a WORKSPACE, a resource is scoped to the whole workspace — everyone in it already reaches it — so there is no such thing as lending one to a single channel. Narrow it with a TEAM instead. \`scope="channel"\` is for HOME channels, where the channel IS the container.`,
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

/** You lend what you created, not what you can read. Fails closed on an unknown creator or caller. */
export function notOwnedRefusal(
  createdBy: string | null | undefined,
  selfUserId: string | null,
  noun: string,
  ref: string,
): ToolResponse | null {
  if (selfUserId && createdBy && createdBy === selfUserId) return null;
  return err(
    `Refused: ${calledAs("grant")} lends ${noun}s YOU created, and ${inlineOr(ref, NO_NAME)} is not one of them. NOTHING was shared. Being able to read it is not the same as being able to lend it — a grant puts it in front of everyone in the scope you named. ${
      selfUserId
        ? `Ask its owner to share it.`
        : `(This session could not resolve who you are, so ownership cannot be proved at all — reconnect with a credential that carries your user id.)`
    }`,
  );
}

/**
 * `to` → the scope id. A channel is named by id; a container goes through
 * `workspace-directory.ts › resolveContainerRef` (slug, uuid, `home`, container id; honours the
 * container lock; refuses an ambiguous slug rather than picking, F-719). Never falls back to the
 * calling workspace. Not-found stays one uniform answer (no existence oracle).
 */
export async function resolveGrantScopeId(
  directory: WorkspaceDirectory,
  scope: GrantScopeArg,
  to: string,
): Promise<string | ToolResponse> {
  const needle = to.trim();
  if (needle === "") return unresolvableScope(scope, to);
  if (scope !== "container") return needle;
  const target = await directory.resolveContainerRef(needle);
  if (!target) return unresolvableScope(scope, to);
  if (isAmbiguousContainer(target)) {
    return err(ambiguousContainer("to", needle, target.ambiguous));
  }
  return target.id;
}

/** Where a container id comes from, worded for the refusal. */
const containerIdSource = () => `Container ids come from ${callRef("workspaces.list")};`;

function unresolvableScope(scope: GrantScopeArg, to: string): ToolResponse {
  return err(
    `\`to\` ${inlineOr(to, "`(unreadable ref)`")} does not resolve as a ${scope} you can act in, so NOTHING was shared — this op never falls back to the workspace you are calling from. Either there is no such ${scope} or it is not one you can act in; those are one answer here on purpose. ${containerIdSource()} a channel id is a uuid from ${callRef("channel.rooms.list")}.`,
  );
}

/**
 * The three argument descriptions, shared by both legacy tools (the enums are published as
 * keywords); a granular tool describes its own (`granular-text.ts › SHARED_PARAMS`).
 */
export const GRANT_SCOPE_ARG_DESCRIPTION = legacyOnly(
  `op=grant (required): WHERE to lend it — "channel" (a home channel's room) or "container" (a home channel or workspace, by ref). The scope decides the audience; the row itself never moves.`,
);

export const GRANT_TO_ARG_DESCRIPTION = legacyOnly(
  `op=grant (required): the scope's handle — a channel UUID, or for scope="container" a workspace slug/UUID or a home-channel CONTAINER id from dopl_workspaces(op="list"). It must be one you are a member of; an id that does not resolve for you refuses and shares nothing, and there is no fallback to the workspace you are calling from.`,
);

export const GRANT_LEVEL_ARG_DESCRIPTION = legacyOnly(
  `op=grant: "visible" or "agent_only" on a CHANNEL scope — two AUDIENCES in the room, not a high/low pair, and both READ-ONLY; "read" or "edit" on a container. Omitted, the narrower one. Mixing the vocabularies is refused.`,
);

/**
 * What a channel level permits, said on the result (not the pushed describe): an audience, read-only
 * to the peer — `resource_grants.guest_write` is off by default and not settable over MCP. A
 * container level is not claimed either way.
 */
function levelReach(scope: GrantScopeArg): string {
  if (scope !== "channel") return "";
  return (
    ` A channel level is an AUDIENCE, not a permission: everyone it names can READ this,` +
    ` and NOBODY gains write access. The write axis (\`guest_write\`) is off by default and can only be` +
    ` turned on from the Dopl app.`
  );
}

/** The `granted` line both tools answer with. */
export function grantedLine(
  noun: string,
  name: string,
  scope: GrantScopeArg,
  scopeId: string,
  level: GrantLevelArg,
): ToolResponse {
  return ok(
    `Shared the ${noun} ${inlineOr(name, NO_NAME)} into the ${scope} \`${scopeId}\` at \`${level}\`. It is ONE row, still yours and still where you edit it — an edit reaches everyone it is lent to, which is the whole difference from the copy this replaced. Re-sending the same call only changes the level.${levelReach(scope)}`,
  );
}
