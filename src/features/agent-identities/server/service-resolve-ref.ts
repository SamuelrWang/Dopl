import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import { readResourceById } from "@/shared/tenancy/read-resource";
import {
  resolveResourcesByName,
  type ResolvedResource,
} from "@/shared/tenancy/resolve-resource";
import type { AgentIdentityContext, IdentityVisibility } from "../types";
import * as repo from "./repository";
import { canSeeIdentity, shareCtxForIdentities } from "./service-shared";
import { loadVisibleIdentityRow } from "./service-reads";

/**
 * Id-or-name identity resolution for the launch-directive lane — the one thing this feature exposes
 * to another feature's service, so the visibility matrix is composed, never copied (F-278).
 * It returns ids only: identity content is resolved on the desktop at spawn, under the operator's
 * credential, so the orchestrator's viewer filter never reaches the operator's run.
 */

/** One row in an ambiguity refusal — only ever a row the caller can already see. */
export interface IdentityRefMatch {
  id: string;
  name: string;
  visibility: IdentityVisibility;
}

/**
 * A union, not a throw: the calling feature words its own error. `not-found` covers both "no such
 * row" and "not visible to you" (404-never-403).
 */
export type IdentityRefResolution =
  | { kind: "found"; id: string; name: string }
  | { kind: "not-found" }
  /** A name the caller could already list, living in another tenancy (T35). */
  | { kind: "elsewhere"; identity: IdentityElsewhere }
  | { kind: "ambiguous"; matches: IdentityRefMatch[] };

/** An identity the caller holds elsewhere; the label names a tenancy, never a roster. */
export interface IdentityElsewhere {
  name: string;
  /** "your home space" / "the workspace \u201cAcme\u201d" / a home channel's container id. */
  label: string;
}

/**
 * Resolve `ref` against what this caller may see:
 *   1. a UUID → exact id, in whichever of the caller's containers it lives; never falls back to a name.
 *   2. otherwise → case-insensitive exact name (no prefix or fuzzy match).
 *   3. more than one → refuse and list (names are not unique by design).  4. none → not found.
 */
export async function resolveIdentityRef(
  ctx: AgentIdentityContext,
  ref: string
): Promise<IdentityRefResolution> {
  const needle = ref.trim();
  if (needle === "") return { kind: "not-found" };
  // An id follows its own tenancy (ruling #18), matching the desktop's `readIdentityById` lane.
  if (isUuid(needle)) {
    const hit = await readResourceById(
      ctx,
      "agent_identity",
      needle,
      loadVisibleIdentityRow
    );
    return hit
      ? { kind: "found", id: hit.value.id, name: hit.value.name }
      : { kind: "not-found" };
  }
  const here = await resolveNameInThisTenancy(ctx, needle);
  if (here.kind !== "not-found") return here;
  const identity = await classifyMissingIdentityRef(ctx, needle);
  return identity ? { kind: "elsewhere", identity } : { kind: "not-found" };
}

/** The name steps, inside `ctx.workspaceId` only — the one place that decides "not here". */
async function resolveNameInThisTenancy(
  ctx: AgentIdentityContext,
  needle: string
): Promise<IdentityRefResolution> {
  const all = await repo.listIdentitiesForWorkspace(ctx.workspaceId);
  if (all.length === 0) return { kind: "not-found" };
  const share = await shareCtxForIdentities(ctx, all);
  // Visibility filters before the name compare, so no branch can learn of an invisible match.
  const matches = all
    .filter((t) => canSeeIdentity(ctx, t, share))
    .filter((t) => t.name.toLocaleLowerCase() === needle.toLocaleLowerCase());

  if (matches.length === 0) return { kind: "not-found" };
  if (matches.length === 1) {
    return { kind: "found", id: matches[0].id, name: matches[0].name };
  }
  return {
    kind: "ambiguous",
    // Already name-ordered by the repository, so the list is stable across calls.
    matches: matches.map((t) => ({
      id: t.id,
      name: t.name,
      visibility: t.visibility,
    })),
  };
}

/**
 * Why a name missed when it lives in another of the caller's tenancies (T35). Every fence is
 * `shared/tenancy/resolve-resource.ts`'s; this is the label over its answer — one name, one place.
 */
export async function classifyMissingIdentityRef(
  ctx: AgentIdentityContext,
  needle: string
): Promise<IdentityElsewhere | null> {
  const matches = await resolveResourcesByName(ctx, "agent_identity", needle);
  // Only matches outside the tenancy this call resolves in.
  const labelled = matches
    .filter(
      (row): row is ResolvedResource => row.containerId !== ctx.workspaceId
    )
    .map((row) => ({ name: row.name, label: tenancyLabel(row) }))
    // One deterministic answer (never a roster), sorted by the label the caller reads.
    .sort((a, b) => a.label.localeCompare(b.label));
  return labelled[0] ?? null;
}

/**
 * The phrase for a tenancy the caller belongs to, by container kind. A link container is named by id
 * (the actionable `workspace=` value, §4A). No markdown: renderers neutralize punctuation in it.
 */
function tenancyLabel(row: ResolvedResource): string {
  if (row.containerKind === "home") return "your home space";
  if (row.containerKind !== "standard") {
    return `a home channel of yours, container ${row.containerId}`;
  }
  return row.containerName
    ? `the workspace “${row.containerName}”`
    : "another workspace you belong to";
}
