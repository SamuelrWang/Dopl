import "server-only";
import { isSharedCredential, type CredentialAxes } from "@/shared/auth/credential-audience";
import { findPersonalContainerId } from "./personal-container";

/**
 * 🔓 **MAY THIS CALLER REACH THEIR OWN PERSONAL SHELF FROM WHERE THEY ARE
 * STANDING?** — the ONE place that question is decided.
 *
 * ⚠ **DEFAULT-ON IN SHARED CHANNELS (2026-09-06, Samuel's reversal of task 11).**
 * The task-11 package (design #1077) narrowed an AGENT session in a SHARED room
 * to "armed rooms only", behind a per-(room, owner) switch. That narrowing is
 * REVERSED: an agent session reaches its operator's personal shelf
 * UNCONDITIONALLY — the same as a person, and the same as a solo room — so this
 * fence no longer reads `channel_personal_arming`, no longer counts the room's
 * members, and no longer consults the session header. The arming table survives
 * inert (see `20260925120000_channel_personal_arming.sql`) with NOTHING LEFT
 * THAT WRITES IT — the route and its service module are deleted (2026-09-07);
 * the reach decision simply stopped asking it.
 *
 * ⚠ **THE COMPENSATING CONTROL IS A PROMPT INSTRUCTION, NOT A GATE.** A shared-
 * channel session may READ its operator's personal/private knowledge and is
 * told — in its standing system-prompt framing (`dopl-desktop-app/main/
 * prompt-framing-text.js › PERSONAL_KNOWLEDGE_CONFIDENTIALITY`) — never to
 * reveal, quote, summarise or confirm that content to other channel members or
 * their agents. The knowledge serves its own operator; it is not shared into the
 * room by resolving here.
 *
 * ⚠ **REACH SPLITS BY ASKER, AND EVERY ASKER NOW CROSSES:**
 *   - **A PERSON** — crosses containers always. Their own shelf, their own
 *     screen. No gate.
 *   - **AN AGENT ON ITS OWN PERSONAL CONTAINER** — the shelf it stands on.
 *   - **AN AGENT IN ANY ROOM, SHARED OR SOLO** — its operator's shelf, by
 *     default. This is the reversed clause.
 *
 * ⚠ **AN OPEN ANSWER AUTHORISES NOTHING FURTHER.** Every row it exposes still
 * goes through `canSeeBase` / `canSeeTemplate` in its own container, exactly as
 * `personal-container.ts` insists. Two fences, in that order.
 *
 * ⚠ **IT IS NOT A RE-GROWN DEFAULT-WORKSPACE FALLBACK** (invariant 1 of #1077,
 * and the next reader is expected to check). It adds the caller's OWN container,
 * by owner, to a call that already named its own. Nothing is guessed, no call
 * silently lands somewhere else, and a closed answer never degrades into a wider
 * read.
 */

/** Why the shelf is out of reach. ⚠ Diagnostic only — see {@link PersonalReach}. */
export type PersonalReachRefusal =
  /** Clause 1 of the resolve fence, restated: a credential that may be passed
   *  between humans points at no one person's shelf. */
  | "shared_credential"
  /** The owner has no `kind='personal'` workspace yet (migration not run for
   *  them). Nothing to reach — the same answer `resolveShelfScope` gives. */
  | "no_container"
  /**
   * ⚠ **LEGACY — NO LONGER PRODUCED BY {@link resolvePersonalReach}** (2026-09-06
   * reversal). It named an agent, in a shared room, that the owner had not armed.
   * The reach is now unconditional, so nothing here ever answers it — the value
   * is retained only so `personal-container.ts › personalShelfRefusal` and the
   * gate suites that mock a closed reach still type-check against one union.
   */
  | "unarmed_room";

/**
 * WHERE the personal shelf is for this call, or WHY it is not.
 *
 * ⚠ **TWO SHAPES, NOT A BOOLEAN BESIDE AN ID.** `{ kind: "open" }` carries the
 * container id every caller needs next, so no surface can read a null id as
 * "open onto nothing" — the same argument `AgentAudience` makes for its two
 * shapes, and the same pair of opposite silent mistakes it avoids.
 *
 * ⚠ **`refusal` IS FOR THE SERVER'S OWN LOGS AND FOR TESTS.** It only ever names
 * `shared_credential` or `no_container` now — the two facts that genuinely leave
 * a caller with no shelf to reach.
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
  /**
   * The container the call is standing in — the ROOM half of (room, owner).
   * ⚠ **VESTIGIAL TO THE DECISION SINCE 2026-09-06** and kept only so callers
   * pass the context they already hold: reach no longer branches on which room
   * an agent stands in.
   */
  workspaceId: string;
  /**
   * WHO is asking. ⚠ **VESTIGIAL TO THE DECISION SINCE 2026-09-06** — a person
   * and an agent now reach the shelf alike, so this is no longer read here. It
   * still discriminates elsewhere (`service-audience.ts`), so the field stays on
   * the shared caller shape.
   */
  source?: string | null;
  /**
   * `X-Dopl-Session-Id`, shaped `<channelId>:<tail>`. ⚠ **NO LONGER READ HERE**
   * (2026-09-06): it narrowed the arming probe, which is gone. Retained on the
   * shared caller shape for the lanes that still carry it.
   */
  sessionId?: string | null;
}

/**
 * 🔓 THE FENCE, reduced to the two facts that still close it:
 *
 * ```
 * shared credential        → closed   (nobody's shelf to reach)
 * no personal container    → closed   (nothing to reach)
 * otherwise                → OPEN     (a person, or an agent in any room)
 * ```
 *
 * ⚠ **ONE READ FOR EVERYBODY.** A person, an agent on its own shelf and an agent
 * in a shared room all cost exactly the container probe now — the member count
 * and the arming probe are gone with the narrowing they served.
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
  // 🔓 DEFAULT-ON: a person crosses always, and an agent — in a shared room, a
  // solo room, or standing on the shelf itself — reaches its operator's shelf
  // unconditionally. The confidentiality of that shelf's contents is held by the
  // session's prompt framing, not by a refusal here.
  return { kind: "open", containerId };
}

/**
 * The personal container ids an ENUMERATING surface may read in ADDITION to the
 * container it was called in — the only form the widening takes.
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
