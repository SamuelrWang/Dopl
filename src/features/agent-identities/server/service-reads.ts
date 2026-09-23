import "server-only";
import {
  readResourceById,
  type ContainerRead,
} from "@/shared/tenancy/read-resource";
import type {
  AgentIdentity,
  AgentIdentityContext,
  ResolvedAgentIdentity,
  IdentityShelf,
} from "../types";
import { AgentIdentityNotFoundError } from "./errors";
import * as repo from "./repository";
// ⚠ THE KB DECORATION MOVED OUT ON 2026-09-05 at the §2 cap — same seam
// `repository-knowledge-links.ts` was cut on. This file owns which rows a caller
// may SEE; that one owns what their attachments RESOLVE TO.
import { decorateWithKnowledgeBases } from "./service-knowledge-decoration";
import {
  canSeeIdentity,
  shareCtxForIdentities,
  withSharingSet,
} from "./service-shared";

/**
 * Agent-identity reads. `getIdentityById` is THE visibility-checked lookup
 * every other op funnels through — writes included — so there is exactly one
 * place a caller can be told an identity exists.
 */

/**
 * Every identity the caller may see, name-ordered, each carrying its
 * `visibility` so the client can GROUP without a second call. ⚠ The server
 * deliberately does NOT group: grouping is a rendering decision (a picker wants
 * flat-with-headers, a settings page wants sections) and a grouped payload
 * forces one of those on every consumer.
 *
 * ⚠ `opts.shelf` NARROWS TO ONE SHELF (`../types.ts › IdentityShelf`) — the
 * /home pane's Personal section asks for `"home"`, the workspace Agents page for
 * `"workspace"`, and everything else (the launch picker, `resolveIdentityRef`,
 * MCP) omits it and gets BOTH. It is applied in the QUERY, not over the result,
 * so a shelf the caller did not ask for never reaches the wire (INVARIANTS §11).
 *
 * 🔒 THE SHELF IS ORTHOGONAL TO `canSeeIdentity`, which runs AFTER it and is
 * unchanged. Shelf = which surface lists it; visibility = who may read it. A
 * narrowed read can only ever return a SUBSET of what the unfiltered one would.
 */
export async function listIdentities(
  ctx: AgentIdentityContext,
  opts: { shelf?: IdentityShelf } = {}
): Promise<AgentIdentity[]> {
  const all = await repo.listIdentitiesForWorkspace(ctx.workspaceId, opts.shelf);
  if (all.length === 0) return [];
  const share = await shareCtxForIdentities(ctx, all);
  const visible = all
    .filter((t) => canSeeIdentity(ctx, t, share))
    .map((t) => withSharingSet(ctx, t, share));
  return decorateByContainer(ctx, visible);
}

/**
 * Decorate each row against ITS OWN container (P7-02): an unfiltered or `home`
 * list spans the calling container and the caller's personal one, and junction
 * rows are filed under the row's container. Keyed to `ctx` alone, a personal
 * row read `knowledge: []` and an editor save replaced the hidden set.
 * ⚠ The foreign container is the caller's personal one (`resolveShelfScope`),
 * which holds no team-scoped rows, so `role: null` neither widens nor narrows.
 */
async function decorateByContainer(
  ctx: AgentIdentityContext,
  rows: AgentIdentity[]
): Promise<AgentIdentity[]> {
  const groups = new Map<string, AgentIdentity[]>();
  for (const row of rows) {
    groups.set(row.workspaceId, [...(groups.get(row.workspaceId) ?? []), row]);
  }
  const byId = new Map<string, AgentIdentity>();
  for (const [workspaceId, group] of groups) {
    const here =
      workspaceId === ctx.workspaceId ? ctx : { ...ctx, workspaceId, role: null };
    for (const row of await decorateWithKnowledgeBases(here, group)) byId.set(row.id, row);
  }
  return rows.map((row) => byId.get(row.id) ?? row);
}

/**
 * Which of `identities` sit on the caller's PERSONAL (/home) shelf — the sibling
 * key behind `GET /api/agent-identities › homeScopedIdentityIds` (2026-08-28).
 *
 * 🔒 ⚠ **A LABEL OVER AN ALREADY-FENCED LIST.** It takes the rows `listIdentities`
 * already put through `canSeeIdentity`, and answers which of THOSE carry the
 * flag. No visibility of its own; never a wider set. Twin of
 * `knowledge/server/service-bases.ts › listHomeScopedBaseIds`, and the pair must
 * move together — two list surfaces disagreeing about whether a shelf is
 * knowable is exactly the confusion the one-mapping rule exists to prevent.
 */
export async function listHomeScopedIdentityIds(
  ctx: AgentIdentityContext,
  identities: AgentIdentity[]
): Promise<string[]> {
  if (identities.length === 0) return [];
  const visible = new Set(identities.map((t) => t.id));
  const scoped = await repo.listHomeScopedIdentityIds(ctx.workspaceId, [
    ...visible,
  ]);
  return scoped.filter((id) => visible.has(id));
}

/**
 * ⚠ 404 — NEVER 403 — WHEN THE CALLER CANNOT SEE IT. A distinguishable
 * "forbidden" would confirm that a private identity with that id exists, which
 * is exactly the oracle the visibility matrix is there to close. Same rule as
 * `getSkillBySlug`.
 *
 * 🔒 ⚠ **KEYED TO `ctx.workspaceId`: ONE CONTAINER, ONE MATRIX.** It is the
 * in-container load the other two doors are built from — {@link readIdentityById}
 * follows an id with it, and {@link getIdentityForWrite} is that follow plus the
 * container it landed in.
 *
 * ⚠ **IT IS NO LONGER "THE WRITE GATE"** (2026-09-06, Samuel's ruling — see
 * `shared/tenancy/read-resource.ts`). A caller still on it refuses a
 * cross-container id, which is narrow rather than wrong; making one follow the
 * id means switching it to {@link getIdentityForWrite} AND giving every
 * workspace-keyed call after it the returned context.
 */
export async function getIdentityById(
  ctx: AgentIdentityContext,
  id: string
): Promise<AgentIdentity> {
  const identity = await loadVisibleIdentity(ctx, id);
  if (!identity) throw new AgentIdentityNotFoundError(id);
  return identity;
}

/**
 * 🔒 **THE ID-RESOLVING READ (A12).** The same row, the same matrix, the same
 * 404 — but the id says which container to apply them in, so `workspace=` is
 * optional on the way in.
 *
 * ⚠ **A `workspace=` THAT CONTRADICTS A RESOLVABLE ID IS IGNORED, NOT REFUSED.**
 * An id is globally unique, so a caller who names one has said everything the
 * read needs; the workspace it was asked in was only ever the key the query
 * happened to be built on, and answering "not here" to a caller holding a
 * perfectly good id is the defect the "it lives elsewhere" subsystem existed to
 * apologise for.
 *
 * ⚠ **RESOLUTION IS NOT AUTHORISATION AND THE ORDER SAYS SO.** The resolver
 * (`shared/tenancy/resolve-resource.ts`) is strictly NARROWER than
 * `canSeeIdentity` — it names only rows the caller could already list — and the
 * matrix then runs AGAIN in the container it named, with the caller's real role
 * there. Two fences, and a row that clears one and not the other is the same
 * 404 as a row that exists nowhere.
 *
 * ⚠ IT COSTS TWO EXTRA READS **ONLY ON A MISS IN THIS TENANCY**; an identity that
 * resolves where it was asked for is byte-identical to before.
 *
 * ⚠ **THE FOLLOW ITSELF IS `shared/tenancy/read-resource.ts › readResourceById`
 * SINCE B2**, where it was twelve hand-written lines here. Knowledge bases,
 * skills and chats compose the same function, and the copy that would have gone
 * wrong is the one this file used to be the only example of: the re-based
 * context's `role`.
 */
export async function readIdentityById(
  ctx: AgentIdentityContext,
  id: string
): Promise<AgentIdentity> {
  return (await readIdentityInContext(ctx, id)).value;
}

/**
 * 🔒 **THE SAME READ, PLUS THE CONTAINER IT LANDED IN** — the twin of
 * `knowledge/server/service-bases.ts › readBaseInContext`, and for the same
 * reason: an identity's TEAM LINKS, KNOWLEDGE LINKS and row update are all
 * workspace-keyed, so a caller that followed an id and then composed against the
 * original context would gate on one container and write junctions into another.
 */
export async function readIdentityInContext(
  ctx: AgentIdentityContext,
  id: string
): Promise<ContainerRead<AgentIdentityContext, AgentIdentity>> {
  const hit = await readResourceById(
    ctx,
    "agent_identity",
    id,
    loadVisibleIdentity
  );
  if (!hit) throw new AgentIdentityNotFoundError(id);
  return hit;
}

/**
 * 🔓 **THE WRITE GATE (2026-09-06, Samuel's ruling).** An id names its own
 * container on a PATCH and a DELETE exactly as it already did on a GET, and the
 * caller gets that container back so the write lands in it.
 *
 * ⚠ **IT AUTHORISES NOTHING.** `assertMayWrite`, the shared-credential fence and
 * the team-scope checks are still the caller's to run — against the RETURNED
 * ctx, so the caller's role is the one they hold where the row lives.
 */
export async function getIdentityForWrite(
  ctx: AgentIdentityContext,
  id: string
): Promise<ContainerRead<AgentIdentityContext, AgentIdentity>> {
  return readIdentityInContext(ctx, id);
}

/** The read every door shares: one row, in ONE named container, through the
 *  matrix and the viewer-filtered decoration. `null` = not visible, which the
 *  callers turn into the single 404. */
async function loadVisibleIdentity(
  ctx: AgentIdentityContext,
  id: string
): Promise<AgentIdentity | null> {
  const identity = await repo.findIdentityById(ctx.workspaceId, id);
  if (!identity) return null;
  const share = await shareCtxForIdentities(ctx, [identity]);
  if (!canSeeIdentity(ctx, identity, share)) return null;
  const [decorated] = await decorateWithKnowledgeBases(ctx, [
    withSharingSet(ctx, identity, share),
  ]);
  return decorated;
}

/**
 * THE LAUNCH-RESOLUTION PAYLOAD. Flattened, id-free, and the contract the
 * desktop fetches at spawn time with its device token.
 *
 * ⚠ IT GOES THROUGH `getIdentityById`, SO IT IS GATED BY THE SAME MATRIX AS
 * EVERY OTHER READ. A "resolve" endpoint that resolved more than a "get" would
 * be a second, weaker door onto the same row — and the desktop presents a
 * user's credential, not a privileged one.
 *
 * ⚠ THE ATTACHMENT LIST IS VIEWER-FILTERED, NOT IDENTITY-DEFINED. A KB the
 * SPAWNING caller cannot read is omitted, even though the identity names it, so
 * a shared identity cannot be used as a delivery vehicle for someone else's
 * private base. The consequence, stated so the integration builder does not
 * read it as a bug: **two people resolving the same identity can get different
 * `knowledgeBases` arrays.**
 *
 * ── ⚠ `authoredByCaller` — THE SIXTH KEY, ADDED 2026-08-22 (G-1) ──────────
 *
 * The desktop's ROLE block wears a DIFFERENT SECURITY HEADER depending on who
 * wrote the identity it is about to run as: the operator's own configuration
 * gets the operator posture, and another member's gets the
 * `UNTRUSTED_SKILL_BODY_HEADER`-shaped one. That gate cannot be built without
 * this field, and it is the tree's established pattern —
 * `packages/mcp-server/src/tools/narration.ts › isForeignAuthored` gates the
 * untrusted headers on authorship for exactly the same reason
 * `knowledge-shared.ts` states in one line: *"noise is how a security header
 * stops being read."*
 *
 * ⚠ A COMPUTED BOOLEAN, NEVER `createdBy`. A raw creator id in a LAUNCH payload
 * is ownership information the launcher does not need, and this endpoint's whole
 * design is that it carries no ids, no visibility and no timestamps. The boolean
 * discloses nothing the caller does not already know from the list endpoint,
 * where `createdBy` is on the DTO for the selector's authorship marker.
 *
 * ⚠ IT IS ABOUT AUTHORSHIP, NOT ABOUT PERMISSION. `createdBy` is `SET NULL` when
 * a member leaves the workspace, so an identity whose author is gone resolves
 * `false` — the stronger header — for everyone including a workspace admin. That
 * is the correct direction: nobody left can vouch for it.
 * ⚠ AND THE DESKTOP FAILS FOREIGN INDEPENDENTLY: `identity-resolve.js › narrow`
 * treats anything that is not an explicit `true` as somebody else's, so an older
 * server that does not send this field cannot silently downgrade a header.
 *
 * ── ⚠ THE MISS THAT USED TO CARRY A TENANCY NOW RESOLVES INSTEAD (A12) ──────
 *
 * This door composes {@link readIdentityById}, so a launch that names an identity
 * of the operator's own living in ANOTHER container of theirs now SUCCEEDS
 * rather than 404-ing with an `elsewhere` label the desktop could only log. The
 * classification was the apology for a read that could not follow its own id;
 * `service-resolve-ref.ts › classifyMissingIdentityRef` still answers the MCP
 * create fence, where a NAME cannot resolve a tenancy.
 * ⚠ THE REFUSAL IS UNCHANGED WHERE IT STILL BITES — still 404, still never 403,
 * and an identity the operator could not list for themselves anywhere resolves
 * nowhere.
 */
export async function resolveIdentityForLaunch(
  ctx: AgentIdentityContext,
  id: string
): Promise<ResolvedAgentIdentity> {
  const identity = await readIdentityById(ctx, id);
  return {
    name: identity.name,
    instructions: identity.instructions,
    model: identity.model,
    runtime: identity.runtime ?? null,
    fields: identity.fields,
    knowledgeBases: identity.knowledgeBases,
    // ⚠ **BESIDE `knowledgeBases`, NEVER INSTEAD OF IT** (2026-09-08). The
    // desktop narrows this payload through an ALLOWLIST, so a build older than
    // this release drops the key it does not know — and if the base list had
    // moved into it, every such build would launch a role naming no knowledge at
    // all. §13's older-peer rule, on the payload where the failure is silent.
    knowledge: identity.knowledge ?? [],
    // ⚠ CARRIED, NOT RECOMPUTED, and `?? 0` reads "the decoration did not run",
    // which on this door cannot happen — `readIdentityById` always decorates.
    // The coalesce is the honest default rather than a claim of reachability:
    // saying "1 unreachable" on a row nobody counted would be an invention, and
    // saying nothing is what the launch already did before today.
    unreachableKnowledgeBaseCount: identity.unreachableKnowledgeBaseCount ?? 0,
    authoredByCaller:
      identity.createdBy !== null && identity.createdBy === ctx.userId,
  };
}

