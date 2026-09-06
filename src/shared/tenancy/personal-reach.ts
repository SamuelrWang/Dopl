import "server-only";
import { isSharedCredential, type CredentialAxes } from "@/shared/auth/credential-audience";
import { isUuid } from "@/shared/lib/id/uuid";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { findPersonalContainerId } from "./personal-container";

/**
 * 🔒 **MAY THIS CALLER TOUCH THEIR OWN PERSONAL SHELF FROM WHERE THEY ARE
 * STANDING?** — the task 11 fence (design #1077, approved by Samuel at #1080,
 * option 1 "approve the package"), and the ONE place that question is decided.
 *
 * ⚠ **IT SPLITS REACH BY ASKER, NEVER BY RESOURCE.** That is the whole design,
 * and the reason it is one module rather than a flag on each surface:
 *
 *   - **A PERSON** — crosses containers always. Samuel sees his own shelf
 *     wherever he stands; his session, his data, his screen. No gate.
 *   - **AN AGENT IN A CONTAINER ITS OPERATOR IS ALONE IN** — the same reach.
 *     Nobody else can read the output, so there is no second audience to bound.
 *   - **AN AGENT IN A SHARED ROOM** — out of reach UNTIL THE ROOM IS ARMED for
 *     that owner. Unarmed, a personal row neither resolves nor enumerates.
 *
 * 🔒 **THIS IS A DELIBERATE NARROWING OF SHIPPED BEHAVIOUR, NOT A NEW GATE OVER
 * AN OLD REFUSAL.** `resolve-resource.ts` clause 3 already let a locked
 * credential resolve inside its lock *plus its own operator's personal
 * container*, so an agent session in a SHARED room could already read its
 * operator's personal bases today — before task 11 widened anything. #1077 found
 * it, #1078 seconded it, Samuel pressed option 1: the reversal is the security
 * half of the package and it is the half that had to land FIRST, because
 * widening enumeration (gap 1) over an open clause 3 turns a latent reach into a
 * discoverable one. ⚠ It changes behaviour for anyone relying on today's reach —
 * the fail-closed backfill Samuel approved at ruling (c), told once.
 *
 * ⚠ **ARMING IS PER (ROOM, OWNER), NOT PER (ROOM, BASE)** — ruling (b). Coarse
 * is right for the SWITCH; the fine-grained control already exists as the
 * per-channel base grant (`resource_grants`), so "arm the room, or lend the one
 * base" covers both ends without a prompt storm.
 *
 * ⚠ **NOT AN EXISTENCE ORACLE, AND NOT A VISIBILITY GATE.** A closed answer
 * removes the personal container from the set of places a read may LOOK, so an
 * unarmed room answers exactly what a nonexistent id answers — the same
 * 404-never-403 path another member's private row already takes, which is what
 * keeps arming state itself from being readable (invariant 2 of #1077). And an
 * OPEN answer authorises nothing: every row it exposes still goes through
 * `canSeeBase` / `canSeeTemplate` in its own container, exactly as
 * `personal-container.ts` insists. Two fences, in that order.
 *
 * ⚠ **IT IS NOT A RE-GROWN DEFAULT-WORKSPACE FALLBACK** (invariant 1 of #1077,
 * and the next reader is expected to check). MCP-2 deleted a fallback that
 * GUESSED a container when the call named none; this adds the caller's OWN
 * container, by owner, to a call that already named its own. Nothing is guessed,
 * no call silently lands somewhere else, and a closed answer never degrades into
 * a wider read.
 */

/** Why the shelf is out of reach. ⚠ Diagnostic only — see {@link PersonalReach}. */
export type PersonalReachRefusal =
  /** Clause 1 of the resolve fence, restated: a credential that may be passed
   *  between humans points at no one person's shelf. */
  | "shared_credential"
  /** The owner has no `kind='personal'` workspace yet (migration not run for
   *  them). Nothing to reach — the same answer `resolveShelfScope` gives. */
  | "no_container"
  /** An agent, in a room with somebody else in it, that the owner has not armed. */
  | "unarmed_room";

/**
 * WHERE the personal shelf is for this call, or WHY it is not.
 *
 * ⚠ **TWO SHAPES, NOT A BOOLEAN BESIDE AN ID.** `{ kind: "open" }` carries the
 * container id every caller needs next, so no surface can read a null id as
 * "open onto nothing" — the same argument `AgentAudience` makes for its two
 * shapes, and the same pair of opposite silent mistakes it avoids.
 *
 * ⚠ **`refusal` IS FOR THE SERVER'S OWN LOGS AND FOR TESTS. It must never be
 * rendered to an agent**, or "unarmed_room" becomes the oracle the 404 path
 * exists to close: the honest surface answer is that there is nothing there.
 */
export type PersonalReach =
  | { readonly kind: "open"; readonly containerId: string }
  | { readonly kind: "closed"; readonly refusal: PersonalReachRefusal };

/**
 * Who is asking, and from where. ⚠ **STRUCTURAL ON PURPOSE, LIKE
 * {@link CredentialAxes} AND `ResourceCaller`** — `KnowledgeContext`,
 * `AgentTemplateContext` and the chats/skills contexts already carry every field
 * under these names, so a surface adopts the fence by passing the context it
 * already has rather than by growing a second one.
 */
export interface PersonalReachCaller extends CredentialAxes {
  /** The owner whose shelf is in question. Always the caller: this module
   *  answers "may I reach MY shelf", never "may I reach yours". */
  userId: string;
  /** The container the call is standing in — the ROOM half of (room, owner). */
  workspaceId: string;
  /**
   * WHO is asking. ⚠ Only the literal `"agent"` gates; anything else, absent
   * included, is a PERSON and crosses. That asymmetry is deliberate and is the
   * one place this module does NOT fail closed: a human view is ungated by
   * ruling, and a lane that forgets to say `source` is a human web route, of
   * which there are hundreds. Every AGENT lane already states it — it is the
   * same field `service-audience.ts › resolveAgentAudience` reads first.
   */
  source?: string | null;
  /**
   * `X-Dopl-Session-Id`, shaped `<channelId>:<tail>`. ⚠ A DOCUMENTED
   * NON-AUTHORIZATION SIGNAL and it is used here for NARROWING ONLY — see
   * {@link armedChannelIds}.
   */
  sessionId?: string | null;
}

/**
 * 🔒 THE FENCE. Order is the query budget AND the argument:
 *
 * ```
 * shared credential        → closed   (nobody's shelf to reach)
 * no personal container    → closed   (nothing to reach)
 * source !== "agent"       → OPEN     (a person, anywhere — no gate, by ruling)
 * calling container IS the
 *   personal container     → OPEN     (an agent standing on the shelf itself)
 * solo container           → OPEN     (today's behaviour, audience of one)
 * armed (room, owner)      → OPEN
 * else                     → closed
 * ```
 *
 * ⚠ A HUMAN COSTS ONE READ, an agent on its own shelf costs one, and only an
 * agent inside a shared container pays the member count and the arming probe.
 * `listBases` runs on every knowledge page load; a fence that cost four reads
 * for everybody would be a performance regression dressed as a security control.
 *
 * ⚠ **AN UNREADABLE MEMBER COUNT FAILS CLOSED** — `null` is "not solo", so the
 * arming probe decides. Unknown is not the same as one, and the safe reading of
 * "I could not count the people in this room" is that there is somebody in it.
 * That is `resolveAgentAudience`'s rule, restated because it is the same risk.
 */
export async function resolvePersonalReach(
  caller: PersonalReachCaller
): Promise<PersonalReach> {
  // 🔒 Clause 1 of the resolve fence, and it costs nothing.
  if (isSharedCredential(caller)) {
    return { kind: "closed", refusal: "shared_credential" };
  }
  const containerId = await findPersonalContainerId(caller.userId);
  if (containerId === null) {
    return { kind: "closed", refusal: "no_container" };
  }
  // A PERSON crosses containers always. Ungated by ruling, not by omission.
  if (caller.source !== "agent") return { kind: "open", containerId };
  // An agent whose call already stands in the personal container is not in a
  // room at all — there is no second audience, and gating it would fence the
  // operator's own agent off the shelf it was launched to work on.
  if (caller.workspaceId === containerId) return { kind: "open", containerId };

  const db = supabaseAdmin();
  const memberCount = await countActiveMembers(db, caller.workspaceId);
  if (memberCount !== null && memberCount <= 1) {
    return { kind: "open", containerId };
  }
  const armed = await armedChannelIds(db, caller);
  return armed.length > 0
    ? { kind: "open", containerId }
    : { kind: "closed", refusal: "unarmed_room" };
}

/**
 * The personal container ids an ENUMERATING surface may read in ADDITION to the
 * container it was called in — gap 1 of #1077, and the only form the widening
 * takes.
 *
 * ⚠ **IT RETURNS A LIST BECAUSE THE REPOSITORIES TAKE ONE** (`.in()`), and an
 * EMPTY list is the fail-safe read: a caller with no reachable shelf has no
 * personal rows, which is the same shape `resolveShelfScope` already answers
 * with. A surface must never read empty as "no filter".
 *
 * ⚠ **IT NEVER INCLUDES THE CALLING CONTAINER**, even when that container IS the
 * personal one. The caller reads its own container by its own path; adding it
 * here would double every row on the one surface that stands on the shelf.
 */
export async function personalShelfContainerIds(
  caller: PersonalReachCaller
): Promise<string[]> {
  const reach = await resolvePersonalReach(caller);
  if (reach.kind === "closed") return [];
  return reach.containerId === caller.workspaceId ? [] : [reach.containerId];
}

/**
 * Active members of the calling container. ⚠ `workspace_members` is read here
 * rather than imported from `features/workspaces`: §1 forbids the cross-feature
 * import and this is one count of one table — the same argument
 * `resolve-resource.ts › listContainersForCaller` makes for the same table.
 *
 * ⚠ `status='active'` is load-bearing. `findMembership` carries the scar of
 * omitting it (a removed admin still measured as one), and here the same
 * omission would count a departed peer as an audience — the safe direction, but
 * for the wrong reason, and a REVOKED member would keep a room "shared" forever.
 */
async function countActiveMembers(
  db: ReturnType<typeof supabaseAdmin>,
  workspaceId: string
): Promise<number | null> {
  const { count, error } = await db
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  if (error) throw error;
  return count ?? null;
}

/**
 * 🔒 **THE ARMING PROBE: which of THIS container's channels has this owner armed
 * for their personal shelf?**
 *
 * ⚠ **THE CONTAINER JOIN IS THE FENCE, AND IT IS INSIDE THE QUERY.** Rows are
 * selected by `owner_id` AND by the channel's own `workspace_id`, so an arming
 * row for a DIFFERENT room can never open this one — which is the whole meaning
 * of "per (room, owner)". Nothing here reads a caller-supplied container.
 *
 * 🔒 **THE SESSION HEADER NARROWS AND CANNOT WIDEN.** `X-Dopl-Session-Id` is
 * forgeable (`shared/auth/session-header.ts`), so it is applied the way
 * `service-audience.ts › narrowToSessionChannel` applies it and for the same
 * reason: the armed set is computed from DB facts FIRST, and a header naming a
 * channel is only allowed to SELECT one already in that set. A forged value
 * selects a channel that is not armed and the caller fences ITSELF out — a
 * self-inflicted refusal. There is no value it can carry that adds a room.
 *
 * ⚠ **DO NOT "IMPROVE" THIS INTO A LOOKUP.** Resolving the named channel against
 * the database instead of against the set in hand would make the header an
 * ADDRESSING input, which is exactly the power it must not have.
 */
async function armedChannelIds(
  db: ReturnType<typeof supabaseAdmin>,
  caller: PersonalReachCaller
): Promise<string[]> {
  const { data, error } = await db
    .from("channel_personal_arming")
    .select("channel_id, channel:channels!inner(workspace_id)")
    .eq("owner_id", caller.userId)
    .eq("channels.workspace_id", caller.workspaceId);
  if (error) throw error;
  const armed = ((data ?? []) as unknown as Array<{ channel_id: string }>).map(
    (row) => row.channel_id
  );
  const head =
    typeof caller.sessionId === "string" ? caller.sessionId.split(":")[0] : "";
  // ⚠ SHAPE GUARD, NOT A FENCE — another client's opaque session handle may
  // carry a colon without naming a channel, and splitting one is noise rather
  // than a decision. The `includes` below is what refuses.
  if (!head || !isUuid(head)) return armed;
  return armed.includes(head) ? [head] : [];
}
