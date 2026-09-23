/**
 * The two create-time identity refusals of `manage action="launch"` (`AGENT_IDENTITY_AMBIGUOUS`,
 * `AGENT_IDENTITY_NOT_FOUND`). `channel-` filename prefix is required by the parity split-scan (`tool-group-files.ts`).
 */

import { err, type ToolResponse } from "./respond";
import { inlineOr } from "./channel-shared";
// One wording of the tenancy rule, shared with the doctrine.
import { TENANCY_FIX, TENANCY_RULE } from "./channel-doctrine";
import { NO_NAME } from "./narration";
import { identityChoiceLines } from "./agent-shared";

/** One `details.matches` row; each already passed the caller's `canSeeIdentity`, so listing it is not an oracle. */
type IdentityMatch = { id: string; name: string; visibility: string };

export function identityMatches(e: unknown): IdentityMatch[] {
  const details = (e as { details?: unknown } | null)?.details;
  const raw = (details as { matches?: unknown } | null)?.matches;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((m) => ({
      id: typeof m.id === "string" ? m.id : "",
      name: inlineOr(typeof m.name === "string" ? m.name : "", NO_NAME),
      visibility: typeof m.visibility === "string" ? m.visibility : "unknown",
    }))
    .filter((m) => m.id !== "");
}

/**
 * Lists the matches and never picks: identity names are deliberately not unique (a unique index would
 * leak private rows). `err`, because nothing was filed.
 */
export function launchIdentityAmbiguous(ref: string, matches: IdentityMatch[]): ToolResponse {
  const label = inlineOr(ref, NO_NAME);
  if (matches.length === 0) {
    return err(
      `No agent was requested — the identity name \`${label}\` matches MORE THAN ONE identity you can see, and nothing was started. Identity names are deliberately not unique, so this call will not guess between them. List them with the agent-identities surface, then re-issue with the identity's ID instead of its name.`,
    );
  }
  return err(
    [
      `No agent was requested — the identity name \`${label}\` matches ${matches.length} identities you can see, and **nothing was filed**. Identity names are deliberately NOT unique (two members may each keep a "Researcher"), so this call refuses rather than picking one for you.`,
      `Re-issue with the ID of the one you meant:`,
      ...identityChoiceLines(matches),
      `⚠ Every identity listed is one YOU can see. Whether the OPERATOR whose machine runs the agent can see it is a separate question, answered on their machine at start time.`,
    ].join("\n"),
  );
}

/** `details.elsewhere`: an identity the caller holds in another of their own tenancies; duck-typed. */
type IdentityElsewhere = { name: string; label: string };

export function identityElsewhere(e: unknown): IdentityElsewhere | null {
  const details = (e as { details?: unknown } | null)?.details;
  const raw = (details as { elsewhere?: unknown } | null)?.elsewhere;
  if (!raw || typeof raw !== "object") return null;
  const { name, label } = raw as { name?: unknown; label?: unknown };
  if (typeof name !== "string" || typeof label !== "string") return null;
  if (name === "" || label === "") return null;
  return { name, label };
}

/**
 * The caller's own visibility failing at create time (`no-identity` is the operator's, after filing).
 * Never says whether the identity exists (404-never-403). A NAME resolves only in the channel's
 * container, while an ID resolves wherever it lives (`src/features/agent-identities/server/service-resolve-ref.ts ›
 * resolveIdentityRef`); `details.elsewhere` is fenced by `classifyMissingIdentityRef` to identities the caller could already list.
 */
export function launchIdentityNotFound(
  ref: string,
  elsewhere: IdentityElsewhere | null,
): ToolResponse {
  if (elsewhere) {
    return err(
      [
        // `inlineOr` already returns a code span, so no backticks of our own.
        `No agent was requested, and **nothing was filed** — identity ${inlineOr(elsewhere.name, NO_NAME)} lives in ${inlineOr(elsewhere.label, "another tenancy of yours")}, not in this channel's own container.`,
        `⚠ ${TENANCY_RULE} Owning it is not enough; it has to live here. ${TENANCY_FIX}`,
      ].join("\n"),
    );
  }
  return err(
    [
      // True of a name; the ID case is stated by `TENANCY_RULE`.
      `No agent was requested — no agent identity ${inlineOr(ref, NO_NAME)} resolves in THIS CHANNEL'S container, and **nothing was filed**. Either there is no such identity, or it is not shared with you; those are ONE answer here on purpose, so ids cannot be probed.`,
      `⚠ CHECK THE TENANCY BEFORE THE SPELLING. ${TENANCY_RULE} If it really should resolve here, the NAME is the other suspect — matching is exact, not fuzzy. ${TENANCY_FIX}`,
    ].join("\n"),
  );
}
