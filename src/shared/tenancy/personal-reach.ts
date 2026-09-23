import "server-only";
import { isSharedCredential, type CredentialAxes } from "@/shared/auth/credential-audience";
import { findPersonalContainerId } from "./personal-container";

/**
 * May this caller reach their own personal shelf from where they stand — decided only here.
 * Open for everyone but a shared credential: an agent in any room reaches its operator's shelf, like a
 * person. The compensating control is prompt framing, not a gate
 * (`dopl-desktop-app/main/prompt-framing-text.js › PERSONAL_KNOWLEDGE_CONFIDENTIALITY`).
 * An open answer authorises nothing further: each row still passes `canSeeBase` / `canSeeIdentity` in
 * its own container. Not a default-workspace fallback: it adds the caller's own container, by owner,
 * to a call that already named its own.
 */

/** Why the shelf is out of reach — diagnostic only (server logs, tests). */
export type PersonalReachRefusal =
  /** A credential passed between humans points at no one person's shelf. */
  | "shared_credential"
  /** The owner has no `kind='personal'` workspace yet. */
  | "no_container"
  /** Never produced by {@link resolvePersonalReach}; kept so `personal-container.ts ›
   *  personalShelfRefusal` and gate-suite mocks type-check against one union. */
  | "unarmed_room";

/** Two shapes, not a boolean beside an id: `open` carries the container id, so no caller can read a
 *  null id as open. */
export type PersonalReach =
  | { readonly kind: "open"; readonly containerId: string }
  | { readonly kind: "closed"; readonly refusal: PersonalReachRefusal };

/** Who is asking and from where; structural, so feature contexts pass what they already hold. */
export interface PersonalReachCaller extends CredentialAxes {
  /** Always the caller: this answers "may I reach my shelf", never someone else's. */
  userId: string;
  /** The room the call stands in. {@link resolvePersonalReach} ignores it;
   *  {@link personalShelfContainerIds} uses it to skip the calling container. */
  workspaceId: string;
  /** Not read here; still discriminates in `knowledge/server/service-audience.ts`. */
  source?: string | null;
  /** `X-Dopl-Session-Id` (`<channelId>:<tail>`). Not read here. */
  sessionId?: string | null;
}

/** Closed for a shared credential or a missing personal container; open otherwise (a person, or an
 *  agent in any room). One container probe for everybody. */
export async function resolvePersonalReach(
  caller: PersonalReachCaller
): Promise<PersonalReach> {
  if (isSharedCredential(caller)) {
    return { kind: "closed", refusal: "shared_credential" };
  }
  const containerId = await findPersonalContainerId(caller.userId);
  if (containerId === null) {
    return { kind: "closed", refusal: "no_container" };
  }
  return { kind: "open", containerId };
}

/**
 * Personal container ids an enumerating surface reads in addition to its own container. Empty is the
 * fail-safe read (no reachable shelf, no personal rows) — never read it as "no filter". Never includes
 * the calling container, which would double every row when the caller stands on the shelf.
 */
export async function personalShelfContainerIds(
  caller: PersonalReachCaller
): Promise<string[]> {
  const reach = await resolvePersonalReach(caller);
  if (reach.kind === "closed") return [];
  return reach.containerId === caller.workspaceId ? [] : [reach.containerId];
}
