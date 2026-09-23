/**
 * Shared ref resolution + rendering for `dopl_agent`; `agent.ts` routes, the op modules render.
 * The `agent-` filename prefix is load-bearing: `tool-group-files.ts` groups a tool's files on it for the parity scans.
 */
import type { AgentIdentity, DoplClient, IdentityKnowledgeRef } from "@dopl/client";
import { type AudienceLabel } from "./audience-label.js";
import { type ToolResponse } from "./respond.js";
/** The server's 403 for a shared credential owning a private row. */
export declare const PRIVATE_VISIBILITY_DENIED_CODE = "WORKSPACE_KEY_PRIVATE_VISIBILITY";
/** The server's 404 for an identity this caller cannot name — the only refusal the id door swallows. */
export declare const IDENTITY_NOT_FOUND_CODE = "AGENT_IDENTITY_NOT_FOUND";
/** The server's code for a name matching several visible identities (the launch lane's 409). */
export declare const IDENTITY_AMBIGUOUS_CODE = "AGENT_IDENTITY_AMBIGUOUS";
/**
 * The MCP surface offers two visibility values; `team` survives in the column and is still rendered.
 * Narrows what is OFFERED, not what exists. One declaration for the tool enum, the list grouping and the write input.
 */
export declare const IDENTITY_VISIBILITY_VALUES: readonly ["private", "workspace"];
/** The visibility values `dopl_agent` accepts on a write. */
export type OfferedIdentityVisibility = (typeof IDENTITY_VISIBILITY_VALUES)[number];
/** zod's refusal for an unoffered `visibility`; it names the retired value so it does not read as a typo. */
export declare const VISIBILITY_ENUM_MESSAGE = "visibility must be \"private\" or \"workspace\", and nothing was written \u2014 \"team\" is no longer a sharing option on this surface.";
export type IdentityRefResolution = {
    kind: "found";
    identity: AgentIdentity;
} | {
    kind: "not-found";
} | {
    kind: "ambiguous";
    matches: AgentIdentity[];
};
/**
 * Resolve `ref` (an identity id or exact name) against what this caller may see.
 * Names match exact and case-insensitive over rows the server already filtered — NOT a second copy of `canSeeIdentity`.
 * A UUID missing from the visible list goes to the server's id door and never falls back to a name lookup.
 * Only an API 404 `AGENT_IDENTITY_NOT_FOUND` is swallowed; transport errors rethrow (an outage must not read as "no such identity").
 * Unseen and nonexistent are one answer: 404-never-403, no existence oracle (INVARIANTS §5A).
 */
export declare function resolveIdentityRef(client: DoplClient, ref: string): Promise<IdentityRefResolution>;
/** {@link resolveIdentityRef} plus its two refusals: the row, or the tool error to return verbatim. */
export declare function resolveIdentityOr(client: DoplClient, ref: string): Promise<AgentIdentity | ToolResponse>;
/**
 * Identity names are not unique by design, so an ambiguous name refuses with every candidate listed and never picks.
 * The list discloses only what op="list" would.
 */
export declare function ambiguousIdentity(ref: string, matches: AgentIdentity[]): ToolResponse;
/** One line per candidate — the one rendering both identity lanes (`dopl_agent`, `dopl_channel` launch) use. */
export declare function identityChoiceLines(matches: ReadonlyArray<{
    id: string;
    name: string;
    visibility: string;
}>): string[];
export declare function identityNotFound(ref: string): ToolResponse;
export declare function identityWriteDenied(e: unknown): ToolResponse | null;
/** 404 `KNOWLEDGE_BASE_NOT_FOUND` on attach; kept 404-shaped so attach is not an existence oracle for private bases. */
export declare function knowledgeBaseNotAttachable(e: unknown): ToolResponse | null;
/** 403 `WORKSPACE_KEY_PRIVATE_VISIBILITY`, surfaced with the server's own sentence (this layer cannot tell which credential is in play). */
export declare function sharedCredentialPrivateDenied(e: unknown): ToolResponse | null;
/** An identity's knowledge attachments: `knowledge` wins, the base list is the older-server fallback, never their sum. */
export declare function identityScopes(ident: Pick<AgentIdentity, "knowledge" | "knowledgeBases">): IdentityKnowledgeRef[];
/** "Who can see this": the container decides, the column only splits within it; in a home channel `workspace` means the room. */
export declare function identityAudience(ident: Pick<AgentIdentity, "visibility">, where: {
    personal: boolean;
    inHomeChannel: boolean;
}): AudienceLabel;
/** One identity as a list row; `audience` comes from the caller's grouping, not `ident.visibility` (`audience-label.ts`). */
export declare function identityRow(ident: AgentIdentity, audience: AudienceLabel): string;
/** Whose view a list is, stated on the result: the server filters it by `canSeeIdentity`. */
export declare const IDENTITIES_SCOPE_NOTE = "_Agent identities you can SEE here. Another member's private identities, and any you have no grant on, are not listed \u2014 this is your view, not the workspace's roster._";
