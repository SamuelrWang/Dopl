/**
 * Shared ref resolution + rendering for `dopl_agent`; `agent.ts` routes, the op modules render.
 * The `agent-` filename prefix is load-bearing: `tool-group-files.ts` groups a tool's files on it for the parity scans.
 */

import type { AgentIdentity, DoplClient, IdentityKnowledgeRef } from "@dopl/client";
import { AUDIENCE_LABELS, type AudienceLabel } from "./audience-label.js";
import { inlineOr, NO_NAME, UUID_RE } from "./narration.js";
import { apiMessage, err, isApiError, type ToolResponse } from "./respond.js";
import { AGENT_ERRORS, refusal } from "./tool-errors.js";

/** The server's 403 for a shared credential owning a private row; one spelling, shared with `knowledge-shared.ts › sharedCredentialPrivateBaseDenied`. */
export const PRIVATE_VISIBILITY_DENIED_CODE = "WORKSPACE_KEY_PRIVATE_VISIBILITY";

/** The server's 404 for an identity this caller cannot name — the only refusal the id door swallows. */
export const IDENTITY_NOT_FOUND_CODE = "AGENT_IDENTITY_NOT_FOUND";
/** The server's code for a name matching several visible identities (the launch lane's 409). */
export const IDENTITY_AMBIGUOUS_CODE = "AGENT_IDENTITY_AMBIGUOUS";

/** The advertised codes, by reason, so a refusal cannot render one the description lacks. */
const AGENT_ERRORS_BY_REASON = Object.fromEntries(
  AGENT_ERRORS.map((e) => [e.reason, e]),
) as Record<"identity_not_found" | "ambiguous_name", (typeof AGENT_ERRORS)[number]>;

/**
 * The MCP surface offers two visibility values; `team` survives in the column and is still rendered.
 * Narrows what is OFFERED, not what exists. One declaration for the tool enum, the list grouping and the write input.
 */
export const IDENTITY_VISIBILITY_VALUES = ["private", "workspace"] as const;

/** The visibility values `dopl_agent` accepts on a write. */
export type OfferedIdentityVisibility =
  (typeof IDENTITY_VISIBILITY_VALUES)[number];

/** zod's refusal for an unoffered `visibility`; it names the retired value so it does not read as a typo. */
export const VISIBILITY_ENUM_MESSAGE =
  'visibility must be "private" or "workspace", and nothing was written — "team" is no longer a sharing option on this surface.';

export type IdentityRefResolution =
  | { kind: "found"; identity: AgentIdentity }
  | { kind: "not-found" }
  | { kind: "ambiguous"; matches: AgentIdentity[] };

/**
 * Resolve `ref` (an identity id or exact name) against what this caller may see.
 * Names match exact and case-insensitive over rows the server already filtered — NOT a second copy of `canSeeIdentity`.
 * A UUID missing from the visible list goes to the server's id door and never falls back to a name lookup.
 * Only an API 404 `AGENT_IDENTITY_NOT_FOUND` is swallowed; transport errors rethrow (an outage must not read as "no such identity").
 * Unseen and nonexistent are one answer: 404-never-403, no existence oracle (INVARIANTS §5A).
 */
export async function resolveIdentityRef(
  client: DoplClient,
  ref: string,
): Promise<IdentityRefResolution> {
  const needle = ref.trim();
  if (needle === "") return { kind: "not-found" };
  // No shelf filter: a ref resolves wherever the row lives.
  const all = await client.listAgentIdentities();
  if (UUID_RE.test(needle)) {
    const byId = all.find((ident) => ident.id === needle);
    if (byId) return { kind: "found", identity: byId };
    try {
      return { kind: "found", identity: await client.getAgentIdentity(needle) };
    } catch (e) {
      if (!isApiError(e, 404, IDENTITY_NOT_FOUND_CODE)) throw e;
      return { kind: "not-found" };
    }
  }
  const matches = all.filter(
    (ident) => ident.name.toLocaleLowerCase() === needle.toLocaleLowerCase(),
  );
  if (matches.length === 0) return { kind: "not-found" };
  if (matches.length === 1) return { kind: "found", identity: matches[0] };
  return {
    kind: "ambiguous",
    matches: [...matches].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** {@link resolveIdentityRef} plus its two refusals: the row, or the tool error to return verbatim. */
export async function resolveIdentityOr(
  client: DoplClient,
  ref: string,
): Promise<AgentIdentity | ToolResponse> {
  const res = await resolveIdentityRef(client, ref);
  if (res.kind === "found") return res.identity;
  if (res.kind === "ambiguous") return ambiguousIdentity(ref, res.matches);
  return identityNotFound(ref);
}

/**
 * Identity names are not unique by design, so an ambiguous name refuses with every candidate listed and never picks.
 * The list discloses only what op="list" would.
 */
export function ambiguousIdentity(
  ref: string,
  matches: AgentIdentity[],
): ToolResponse {
  const label = inlineOr(ref, NO_NAME);
  return err(
    [
      refusal(
        AGENT_ERRORS_BY_REASON.ambiguous_name,
        `Nothing was read or written — the name ${label} matches ${matches.length} agent identities you can see, and this call refuses rather than picking one. Identity names are deliberately NOT unique (two members may each keep a "Researcher"). Re-issue with the ID of the one you meant:`,
      ),
      ...identityChoiceLines(matches),
    ].join("\n"),
  );
}

/** One line per candidate — the one rendering both identity lanes (`dopl_agent`, `dopl_channel` launch) use. */
export function identityChoiceLines(
  matches: ReadonlyArray<{ id: string; name: string; visibility: string }>,
): string[] {
  return matches.map((m) => `- \`${m.id}\` — ${inlineOr(m.name, NO_NAME)} (${m.visibility})`);
}

export function identityNotFound(ref: string): ToolResponse {
  return err(
    refusal(
      AGENT_ERRORS_BY_REASON.identity_not_found,
      `No agent identity ${inlineOr(ref, NO_NAME)} resolves for you, and nothing was read or written. Either there is no such identity or it is not shared with you — those are ONE answer here on purpose, so ids cannot be probed. Matching on a name is EXACT (case-insensitive), never fuzzy; list what you can see with dopl_agent(op="list").`,
    ),
  );
}

export function identityWriteDenied(e: unknown): ToolResponse | null {
  if (!isApiError(e, 403, "RESOURCE_ACCESS_DENIED")) return null;
  const msg = apiMessage(e);
  return err(
    msg
      ? `${msg} Nothing was changed.`
      : `Only the identity's creator or a workspace admin can change it. Nothing was changed.`,
  );
}

/** 404 `KNOWLEDGE_BASE_NOT_FOUND` on attach; kept 404-shaped so attach is not an existence oracle for private bases. */
export function knowledgeBaseNotAttachable(e: unknown): ToolResponse | null {
  if (!isApiError(e, 404, "KNOWLEDGE_BASE_NOT_FOUND")) return null;
  return err(
    `At least one knowledge id you passed does not resolve for you, so nothing was written. A base you cannot READ cannot be attached — that is what stops an identity laundering access to somebody else's private base — and "not yours" and "no such base" answer the same way here. The same answer covers a folder or an entry that is trashed, or that lives in a different base than the one you named. Check ids with dopl_kb(op="list_bases") and dopl_kb(op="get_tree").`,
  );
}

/** 403 `WORKSPACE_KEY_PRIVATE_VISIBILITY`, surfaced with the server's own sentence (this layer cannot tell which credential is in play). */
export function sharedCredentialPrivateDenied(e: unknown): ToolResponse | null {
  if (!isApiError(e, 403, PRIVATE_VISIBILITY_DENIED_CODE)) return null;
  return err(
    `${apiMessage(e) ?? "This credential cannot own a private agent identity."} Nothing was created. A credential that may be shared between humans has no "private to me" to write to — create it with visibility="workspace", or reconnect with a personal credential.`,
  );
}

/** An identity's knowledge attachments: `knowledge` wins, the base list is the older-server fallback, never their sum. */
export function identityScopes(
  ident: Pick<AgentIdentity, "knowledge" | "knowledgeBases">,
): IdentityKnowledgeRef[] {
  const scoped = ident.knowledge ?? [];
  if (scoped.length > 0) return scoped;
  return ident.knowledgeBases.map((kb) => ({
    baseId: kb.id,
    baseName: kb.name,
    scope: "base" as const,
    path: kb.name,
  }));
}

/** A stored visibility this surface does not offer (`team`): the audience is not stated, never guessed. */
const UNSTATED_AUDIENCE = "an audience this surface cannot state" as AudienceLabel;

/** "Who can see this": the container decides, the column only splits within it; in a home channel `workspace` means the room. */
export function identityAudience(
  ident: Pick<AgentIdentity, "visibility">,
  where: { personal: boolean; inHomeChannel: boolean },
): AudienceLabel {
  if (where.personal) return AUDIENCE_LABELS.you;
  if (where.inHomeChannel) {
    return ident.visibility === "workspace" ? AUDIENCE_LABELS.channel : AUDIENCE_LABELS.nobody;
  }
  if (ident.visibility === "private") return AUDIENCE_LABELS.you;
  if (ident.visibility === "workspace") return AUDIENCE_LABELS.workspace;
  return UNSTATED_AUDIENCE;
}

/** One identity as a list row; `audience` comes from the caller's grouping, not `ident.visibility` (`audience-label.ts`). */
export function identityRow(ident: AgentIdentity, audience: AudienceLabel): string {
  const desc = ident.description ? `\n  ${inlineOr(ident.description, "")}` : "";
  const runtime = ident.runtime ? ` · runtime ${inlineOr(ident.runtime, NO_NAME)}` : "";
  const model = ident.model ? ` · model ${inlineOr(ident.model, NO_NAME)}` : "";
  const scopeCount = identityScopes(ident).length;
  const kbs =
    scopeCount > 0
      ? ` · ${scopeCount} knowledge scope${scopeCount === 1 ? "" : "s"}`
      : "";
  return `- ${inlineOr(ident.name, NO_NAME)} (id: \`${ident.id}\` · seen by ${audience}${runtime}${model}${kbs})${desc}`;
}

/** Whose view a list is, stated on the result: the server filters it by `canSeeIdentity`. */
export const IDENTITIES_SCOPE_NOTE = `_Agent identities you can SEE here. Another member's private identities, and any you have no grant on, are not listed — this is your view, not the workspace's roster._`;
