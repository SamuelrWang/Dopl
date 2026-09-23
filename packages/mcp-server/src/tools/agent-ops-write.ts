/**
 * `dopl_agent` WRITE op handlers: create, update, grant. Routed from the
 * registrar in `agent.ts`.
 *
 * ── THE TWO THINGS EVERY LINE IN HERE RESPECTS ────────────────────────────
 *
 * ⚠ **THE SHELF FENCE THIS HEADER OPENED WITH IS GONE (2026-09-02, slice B15,
 * ruling B10).** It had three numbered rules; the first two were about
 * `resolveIdentityHomeScope` and about not confusing it with the credential's
 * container lock (F-336). The `home_scoped` column is dropped and a personal
 * identity is an ordinary row in the caller's own `kind='personal'` container,
 * so there is no shelf to fence and no contradiction to refuse before the round
 * trip. **The container LOCK is untouched** — it was always the thing doing the
 * work in rule 2 — and it is still what answers a container-locked session that
 * reaches for a tenancy it is not in.
 *
 * 1. ⚠ **THE CONFIRM GATE IS A TRIPWIRE, AND SINCE G16 IT FEEDS A FENCE.** See
 *    `confirm-token.ts`'s header for the tripwire half — nothing here stops an
 *    agent previewing and echoing the token back without showing a human. What
 *    is new is that a SPENT token now sets `acknowledgeShared: true` on the
 *    write body, and `src/features/workspaces/server/shared-publish.ts` 400s
 *    the write WITHOUT it: an agent that skips the preview no longer skips the
 *    refusal, because the refusal belongs to the server that owns the rows.
 *    It fires only for a row landing at `visibility: "workspace"` inside a SHARED
 *    link container — publishing the operator's agent identity into the room a
 *    peer is standing in.
 *    ⚠ IT READS THE EXPLICIT `visibility` ONLY. An OMITTED visibility takes the
 *    server's default, which is `private` for every credential that stands for a
 *    person and `workspace` for one that does not — and a credential that does
 *    not is `isSharedCredential`, which B1 keeps out of containers entirely. So
 *    the omitted case cannot publish into a shared room; said here because the
 *    reasoning is not local to this file.
 *
 * 2. 🔒 **A GRANT LENDS ONE ROW AND THE FENCE IS BOTH SIDES OF IT** — see
 *    {@link opGrantIdentity} and `grant.ts`. It replaced `op="copy"`, whose
 *    two-leg cross-tenancy create is deleted.
 */

import type {
  AgentIdentityCreateInput,
  AgentIdentityUpdateInput,
  DoplClient,
  IdentityField,
  IdentityKnowledgeScope,
} from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { inlineOr, NO_NAME } from "./narration.js";
import {
  channelScopeRefusal,
  grantedLine,
  isGrantRefusal,
  levelForScope,
  notOwnedRefusal,
  resolveGrantScopeId,
  type GrantLevelArg,
  type GrantScopeArg,
} from "./grant.js";
import { ok, err, isApiError, isConflict, type ToolResponse } from "./respond.js";
import { refusal, versionConflict } from "./tool-errors.js";
import {
  confirmGate,
  containerPublishUnacknowledged,
  RECONFIRM_REMEDY,
} from "./confirm-token.js";
import {
  knowledgeBaseNotAttachable,
  resolveIdentityOr,
  sharedCredentialPrivateDenied,
  identityWriteDenied,
  type OfferedIdentityVisibility,
} from "./agent-shared.js";
import { isErr } from "./channel-shared.js";
import { duplicateNameNoteFor } from "./duplicate-name.js";
import {
  homeChannelRowNotShared,
  resolveHomeChannelContainer,
} from "./container-destination.js";

export interface IdentityWriteInput {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  model?: string | null;
  fields?: IdentityField[];
  visibility?: OfferedIdentityVisibility;
  knowledge_bases?: string[];
  knowledge?: Array<{ base: string; folder?: string; entry?: string }>;
  confirm_token?: string;
  /** op="update" only — the Version from `op="get"`. See {@link opUpdate}. */
  expected_version?: string;
  /** op="update" only — the `expected_version` escape. */
  force?: boolean;
}

/**
 * THE ONE TRANSLATION between the agent-facing shape (`{base, folder?, entry?}`)
 * and the wire's discriminated union. ⚠ `folder` WINS over `entry` if a caller
 * somehow sends both — zod already refused that pair, so this arm is
 * unreachable and exists so the mapper is TOTAL rather than throwing on a shape
 * the type says cannot occur.
 */
function toKnowledgeScopes(
  scopes: IdentityWriteInput["knowledge"],
): IdentityKnowledgeScope[] | undefined {
  if (scopes === undefined) return undefined;
  return scopes.map((s) =>
    s.folder
      ? { baseId: s.base, scope: "folder" as const, folderId: s.folder }
      : s.entry
        ? { baseId: s.base, scope: "entry" as const, entryId: s.entry }
        : { baseId: s.base, scope: "base" as const },
  );
}

/**
 * THE DIGEST'S KNOWLEDGE LINE, deterministically sorted (2026-09-08).
 *
 * ⚠ **SORTED, BECAUSE A CONFIRM TOKEN IS BOUND TO THIS PAYLOAD.** The preview an
 * operator was shown and the payload the proceed re-hashes must be byte-equal;
 * a set the agent happened to type in a different order the second time would
 * spend no token and loop. `knowledge_bases` has been `[...].sort()` for exactly
 * this reason, and this is the same rule for a shape with three fields — the key
 * is the SHAPE plus its id, so a base and a folder of it sort apart.
 */
function knowledgeDigest(input: IdentityWriteInput): string[] {
  const scopes = toKnowledgeScopes(input.knowledge) ?? [];
  return scopes
    .map((s) =>
      s.scope === "folder"
        ? `folder:${s.baseId}/${s.folderId}`
        : s.scope === "entry"
          ? `entry:${s.baseId}/${s.entryId}`
          : `base:${s.baseId}`,
    )
    .sort();
}

/**
 * ⚠ **DECLARED, NOT HAND-WRITTEN** — `tool-errors.ts › versionConflict` is the
 * one producer of this `reason=` string, so the wire and any description that
 * teaches it move together. `op="get"` is the remedy because that is the op
 * whose result carries an identity's Version.
 */
const IDENTITY_VERSION_CONFLICT = versionConflict('op="get"');

/** Map the write errors that have an actionable sentence; rethrow anything
 *  else. ⚠ ONE mapper for both verbs so the two cannot answer differently. */
function mapWriteError(e: unknown): ToolResponse | null {
  // 🔒 G16 — only ever a RACE on these two verbs: `confirmGate` already
  // previewed and spent a token, so reaching this means the room gained a
  // member in between.
  const unacknowledged = containerPublishUnacknowledged(e, RECONFIRM_REMEDY);
  if (unacknowledged) return unacknowledged;
  return (
    // 🔒 The home-channel destination fence (2026-09-18) — reachable on BOTH
    // verbs, which is why it is mapped here rather than inside `opCreate`: the
    // update path can move a row to `private` inside a channel too.
    homeChannelRowNotShared(e) ??
    sharedCredentialPrivateDenied(e) ??
    knowledgeBaseNotAttachable(e) ??
    identityWriteDenied(e)
  );
}

/**
 * 🔒 **THE TWO DESTINATIONS, ON THE IDENTITY LANE** (Samuel's ruling
 * 2026-09-18) — see `container-destination.ts` for the model.
 *
 * Inside a home channel the ONLY audience that exists is the channel itself, so
 * `visibility` defaults to `"workspace"` there and an explicit `"private"` is
 * refused before the round trip. Everywhere else the default is `"private"`,
 * unchanged.
 *
 * ⚠ **THE REFUSAL IS THE SERVER'S AND THIS IS THE SENTENCE** — `assertHomeChannelRowIsShared`
 * 400s the same write, so a caller that reaches the route directly gets the same
 * answer. What this buys is that the COMMON call — `op="create"` with no
 * `visibility`, into a channel — lands where the operator meant it to instead of
 * being refused for a value the agent never chose.
 */
function homeChannelVisibility(
  requested: OfferedIdentityVisibility | undefined,
): OfferedIdentityVisibility | ToolResponse {
  if (requested === "private") {
    return err(
      `Nothing was created. A home channel holds only what is shared into it, so an agent identity cannot be private there. Create it with visibility="workspace" to share it with everyone in this channel, or pass container="home" to keep it to yourself in your home space.`,
    );
  }
  return "workspace";
}

export async function opCreate(
  client: DoplClient,
  callerUserId: string | null,
  input: IdentityWriteInput & { name: string },
  /** ⚠ OPTIONAL — see `container-destination.ts ›
   *  resolveHomeChannelContainer`: absent means "not known", which degrades to
   *  the pre-2026-09-18 behaviour and leaves the refusal with the server. */
  directory?: WorkspaceDirectory,
): Promise<ToolResponse> {
  // 🔒 **VISIBILITY IS ALWAYS SENT, NEVER LEFT TO THE SERVER'S DEFAULT**
  // (2026-09-02).
  //
  // ⚠ **AN OMITTED VISIBILITY WAS AN UNESCAPABLE LOOP.** The server's default is
  // credential-dependent (`service-writes.ts › createIdentity`: a SHARED
  // credential defaults to `workspace`, everyone else to `private`), and this
  // process cannot see which it holds. So the gate below computed
  // `publishes: false`, minted no token, and the server then resolved
  // `workspace`, hit its own G16 precondition and answered 400 — whose remedy is
  // "re-issue WITHOUT `confirm_token` for a fresh preview", which is what the
  // caller had just done. Round and round, with nothing the agent could change.
  // ⚠ Sending it makes the wire match what the tool's own description promises
  // ("default 'private'"), so the branch cannot fire at all; a shared credential
  // then gets its clean, named 403 instead of an unanswerable 400.
  //
  // 🔒 **AND SINCE 2026-09-18 THE DEFAULT IS THE DESTINATION'S, NOT A CONSTANT.**
  // A home channel has one audience — the channel — so `"private"` there names
  // the destination Samuel deleted. See {@link homeChannelVisibility}.
  const inHomeChannel = await resolveHomeChannelContainer(client, directory);
  const chosen: OfferedIdentityVisibility | ToolResponse = inHomeChannel
    ? homeChannelVisibility(input.visibility)
    : (input.visibility ?? "private");
  if (typeof chosen !== "string") return chosen;
  const visibility: OfferedIdentityVisibility = chosen;

  const verdict = await confirmGate(
    client,
    {
      tool: "dopl_agent",
      op: "create",
      callerUserId,
      what: `an agent identity named ${inlineOr(input.name, NO_NAME)}, shared with the whole home channel`,
      audience: `everyone in that home channel — the peer standing in it can list it, read its instructions, and launch it`,
      payload: {
        name: input.name,
        description: input.description ?? null,
        instructions: input.instructions ?? null,
        model: input.model ?? null,
        visibility,
        knowledge_bases: [...(input.knowledge_bases ?? [])].sort(),
        knowledge: knowledgeDigest(input),
        fields: (input.fields ?? []).map((f) => [f.key, f.value]),
      },
    },
    { publishes: visibility === "workspace", token: input.confirm_token },
  );
  if (verdict.kind === "halt") return verdict.response;

  const body: AgentIdentityCreateInput = {
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    model: input.model,
    fields: input.fields,
    visibility,
    knowledgeBaseIds: input.knowledge_bases,
    knowledge: toKnowledgeScopes(input.knowledge),
    // 🔒 G16 — THE TOKEN, SPENT, BECOMES THE SERVER'S PRECONDITION. Only ever
    // `true`, and only from a token this call actually consumed: the server
    // ignores the flag outside its predicate, and sending it on a proceed that
    // showed nobody anything would re-create the client-side confirm this
    // replaces. See `confirm-token.ts › ConfirmVerdict`.
    acknowledgeShared: verdict.acknowledgedShared || undefined,
  };
  let identity;
  try {
    identity = await client.createAgentIdentity(body);
  } catch (e) {
    const mapped = mapWriteError(e);
    if (mapped) return mapped;
    throw e;
  }
  // ⚠ TWO ARMS, because `create` sends the two-arm enum and nothing else: the
  // server's own default for an omitted `visibility` is `private`, so this
  // response cannot describe a row at a visibility this surface never offered.
  // ⚠ **THREE ARMS SINCE 2026-09-18, AND THE THIRD IS A DIFFERENT SENTENCE**:
  // inside a home channel `workspace` means "the other people in this
  // relationship", never "everyone in your company" — the same split
  // `src/features/agent-identities/lib/visibility.ts › SECTIONS_CONTAINER` makes,
  // and its heading is the wording reused here.
  const audience =
    identity.visibility === "private"
      ? "Private to you — only you and your own agents can see it."
      : inHomeChannel
        ? "Shared in this channel — everyone here can list it and launch it."
        : "Shared with everyone in this workspace — every member can list it and launch it.";
  // ⚠ Q3's warning — AFTER the create, so a list that throws costs the caller
  // nothing. An identity collision is the sharper of the two: `resolveIdentityRef`
  // REFUSES every name-addressed `get`/`update` from now on. See
  // `duplicate-name.ts`.
  const dup = await duplicateNameNoteFor(
    identity,
    () => client.listAgentIdentities(),
    "agent identity",
    true,
  );
  return ok(
    [
      `Created agent identity ${inlineOr(identity.name, NO_NAME)} (id: \`${identity.id}\`). ${audience}${dup}`,
      `Launch it into a channel with dopl_channel(op="manage", action="launch", channel=…, identity="${identity.id}") — which ASKS the operator's machine and does not start anything by itself.`,
    ].join("\n"),
  );
}

export async function opUpdate(
  client: DoplClient,
  callerUserId: string | null,
  ref: string,
  input: IdentityWriteInput,
): Promise<ToolResponse> {
  const patch: AgentIdentityUpdateInput = {
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    model: input.model,
    fields: input.fields,
    visibility: input.visibility,
    knowledgeBaseIds: input.knowledge_bases,
    knowledge: toKnowledgeScopes(input.knowledge),
  };
  if (Object.values(patch).every((v) => v === undefined)) {
    return err(
      `op="update" changed nothing because no field was passed. Pass at least one of: name, description, instructions, model, fields, visibility, knowledge_bases, knowledge.`,
    );
  }

  const identity = await resolveIdentityOr(client, ref);
  if (isErr(identity)) return identity;

  const verdict = await confirmGate(
    client,
    {
      tool: "dopl_agent",
      op: "update",
      callerUserId,
      what: `sharing the agent identity ${inlineOr(identity.name, NO_NAME)} (id: \`${identity.id}\`) with the whole home channel`,
      audience: `everyone in that home channel — the peer standing in it can list it, read its instructions, and launch it`,
      payload: {
        identity: identity.id,
        name: patch.name ?? null,
        description: patch.description ?? null,
        instructions: patch.instructions ?? null,
        model: patch.model ?? null,
        visibility: patch.visibility ?? null,
        knowledge_bases: [...(input.knowledge_bases ?? [])].sort(),
        knowledge: knowledgeDigest(input),
        fields: (input.fields ?? []).map((f) => [f.key, f.value]),
      },
    },
    { publishes: patch.visibility === "workspace", token: input.confirm_token },
  );
  if (verdict.kind === "halt") return verdict.response;

  let updated;
  try {
    // 🔒 G16 — the spent token, as the server's precondition. ⚠ SET AFTER the
    // "changed nothing" check above, which counts only fields that move a
    // column: an acknowledgement is an assertion ABOUT a change, never one.
    updated = await client.updateAgentIdentity(
      identity.id,
      {
        ...patch,
        acknowledgeShared: verdict.acknowledgedShared || undefined,
      },
      // ⚠ THE CLIENT'S TRI-STATE, SPELLED OUT: `force` → null (blind
      // overwrite), else the version the caller passed — and `undefined` is the
      // arm the SDK refuses without a round trip.
      input.force ? null : input.expected_version,
    );
  } catch (e) {
    // ⚠ **BOTH 412s, AND THEY ARE ONE REFUSAL TO THE AGENT.** The SDK raises
    // `EXPECTED_VERSION_REQUIRED` before the wire when no version was passed;
    // the server raises `AGENT_IDENTITY_STALE_VERSION` when the row moved. The
    // remedy is the same call either way, so a second wording would be a second
    // string for an agent to match on and no new fact.
    if (isApiError(e, 412, "EXPECTED_VERSION_REQUIRED") || isConflict(e)) {
      return err(
        refusal(
          IDENTITY_VERSION_CONFLICT,
          `Nothing was written to ${inlineOr(identity.name, NO_NAME)} (id: \`${identity.id}\`). Re-read it, reconcile your changes, and retry with that Version — or pass force=true to overwrite the other edit.`,
        ),
      );
    }
    const mapped = mapWriteError(e);
    if (mapped) return mapped;
    throw e;
  }
  const note =
    patch.visibility !== undefined
      ? ` Sharing is now: ${updated.visibility}.`
      : "";
  // ⚠ THE NEW VERSION IS PART OF THE SUCCESS, not something to go and fetch —
  // an agent making two edits in a row would otherwise have to `op="get"`
  // between them to satisfy the precondition it just satisfied.
  return ok(
    `Updated agent identity ${inlineOr(updated.name, NO_NAME)} (id: \`${updated.id}\`).${note}\nVersion: \`${updated.updatedAt}\` (pass as expected_version to the next op="update")`,
  );
}

/**
 * `op="grant"` — lend ONE identity to a channel, container or team. The op that
 * REPLACED `op="copy"` (Wave B slice B15, ruling B11).
 *
 * ⚠ **THIS IS THE `op="share"` §5A SAID WOULD NEVER EXIST, AND THE PREMISE THAT
 * REFUSED IT DIED IN THE SAME WAVE.** The argument was *"an identity has no grant
 * table, so sharing into a container IS `visibility: 'workspace'` on
 * `op='update'` — a second verb would be two doors onto one write"*. Since
 * `20260914120000` an identity HAS a grant table (`resource_grants` accepts
 * `resource_type='agent_identity'`), and the two verbs are no longer one write:
 * `visibility` says who inside THIS container may use the identity, and a grant
 * lends the row to a scope somewhere else. A personal identity lives in the
 * caller's own personal container, where `visibility:"workspace"` reaches an
 * audience of one — which is exactly why sharing it needs this op.
 */
export async function opGrantIdentity(
  client: DoplClient,
  directory: WorkspaceDirectory,
  selfUserId: string | null,
  ref: string,
  scope: GrantScopeArg,
  to: string,
  level: GrantLevelArg | undefined,
): Promise<ToolResponse> {
  const chosen = levelForScope(scope, level);
  if (isGrantRefusal(chosen)) return chosen;
  const found = await resolveIdentityOr(client, ref);
  if (isErr(found)) return found;
  const notOwned = notOwnedRefusal(found.createdBy, selfUserId, "agent identity", found.name);
  if (notOwned) return notOwned;
  const scopeId = await resolveGrantScopeId(directory, scope, to);
  if (isGrantRefusal(scopeId)) return scopeId;
  try {
    await client.grantResource({
      resourceType: "agent_identity",
      resourceId: found.id,
      scopeType: scope,
      scopeId,
      level: chosen,
    });
  } catch (e) {
    // 🔒 The container-KIND refusal, said in this surface's own words rather
    // than as a bare 400 (Samuel's ruling 2026-09-17). Every other failure
    // rethrows — a catch that swallowed them would report a refusal for an
    // outage.
    const refused = channelScopeRefusal(e);
    if (refused) return refused;
    throw e;
  }
  return grantedLine("agent identity", found.name, scope, scopeId, chosen);
}
