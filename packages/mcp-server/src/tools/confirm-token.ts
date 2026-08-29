/**
 * confirm-token.ts — THE CONFIRM CLASS: a dry-run PREVIEW plus an opaque,
 * server-minted token that the acting call must echo back (Samuel's ruling Q10
 * (ii), 2026-08-28; spec `docs/specs/mcp-surface-v2.plan.md` §7.3).
 *
 * 🔒 ⚠ **A CONFIRM TOKEN IS A TRIPWIRE, NOT A FENCE.** Nothing here stops an
 * agent calling the preview and echoing the token back without ever showing a
 * human. What actually REFUSES the human-reaching acts is the `sessionOnly`
 * set, the `source === "agent"` refusals, B1 (the credential lock) and layer A
 * (the audience ceiling in `src/features/knowledge/server/service-audience.ts`).
 * The token buys that the agent SAW what it was about to do — which is worth
 * having, and is not the same as a person having approved it. Do not describe
 * this module as containment, and do not let a caller's copy imply it.
 *
 * ⚠ SCOPED TO THE AUDIENCE-CHANGING WRITE CLASS AND NOTHING ELSE. A confirm on
 * every write trains the agent to skip it — the identical argument INVARIANTS
 * §10 makes for untrusted-content headers ("a header on every result trains
 * agents to skip headers"). Today the class is exactly: a template or a
 * knowledge base landing at an audience BEYOND THE CALLER inside a SHARED link
 * container, i.e. the room a peer is standing in.
 *
 * ── THE STORE, AND WHY ITS FAILURE MODE IS THE RIGHT ONE ───────────────────
 * ⚠ THE MCP SERVER BOOTS ONCE PER HTTP REQUEST (`factory.ts › bootServer`), so
 * the store is MODULE-scoped, not session-scoped — it lives as long as the Node
 * process. A token minted in one process is UNKNOWN in another, and an unknown
 * token REFUSES: the failure mode of a lost store is "preview again", never
 * "the write goes through". That is the only direction this may ever fail.
 */

import { randomBytes, createHash } from "node:crypto";
import { workspaceContext, isStandardWorkspace } from "@dopl/client";
import type { DoplClient } from "@dopl/client";
import { inlineOr } from "./narration.js";
import { err, type ToolResponse } from "./respond.js";

/** ⚠ SHORT-LIVED on purpose: the preview must be the thing the agent is still
 *  holding when it acts, not something it found in an old turn. */
const TOKEN_TTL_MS = 5 * 60_000;
/** Expired rows are kept this much longer so "expired" can be SAID rather than
 *  answered as "never existed" — two different next actions. */
const TOKEN_GRACE_MS = 30 * 60_000;
/** Hard bound on the store; a preview an agent never confirms costs one row. */
const TOKEN_STORE_MAX = 200;

interface TokenRecord {
  fingerprint: string;
  expiresAt: number;
}

const TOKENS = new Map<string, TokenRecord>();

function sweep(now: number): void {
  for (const [token, rec] of TOKENS) {
    if (now > rec.expiresAt + TOKEN_GRACE_MS) TOKENS.delete(token);
  }
  // ⚠ Insertion-ordered map: the oldest key is the first. Evicting the oldest
  // beats refusing to mint — a full store must never turn a confirm-class call
  // into an un-previewable one.
  while (TOKENS.size >= TOKEN_STORE_MAX) {
    const oldest = TOKENS.keys().next();
    if (oldest.done) break;
    TOKENS.delete(oldest.value);
  }
}

/**
 * The exact act, canonicalised. ⚠ KEY-SORTED so two spellings of the same
 * payload fingerprint identically, and the CALLER and the WORKSPACE are part of
 * it — a token minted for one person's act in one room cannot be spent on
 * another's.
 */
function fingerprint(act: ConfirmAct, target: ConfirmTarget): string {
  const canonical = JSON.stringify({
    tool: act.tool,
    op: act.op,
    caller: act.callerUserId ?? "unresolved",
    workspace: target.workspaceId ?? "unresolved",
    payload: sortedPayload(act.payload),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function sortedPayload(payload: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(payload)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function mint(fp: string): string {
  const now = Date.now();
  sweep(now);
  // ⚠ UNGUESSABLE IS THE WHOLE MECHANISM. A token derived from the payload
  // would be computable by the agent, and the preview it is supposed to force
  // into context could be skipped.
  const token = randomBytes(18).toString("base64url");
  TOKENS.set(token, { fingerprint: fp, expiresAt: now + TOKEN_TTL_MS });
  return token;
}

type ConsumeResult = "ok" | "unknown" | "expired" | "mismatch";

function consume(token: string, fp: string): ConsumeResult {
  const rec = TOKENS.get(token);
  if (!rec) return "unknown";
  if (Date.now() > rec.expiresAt) return "expired";
  // ⚠ A MISMATCH DOES NOT BURN THE TOKEN. It is still valid for the payload it
  // was minted for, and the caller's fix is to send THAT payload — burning it
  // here would make a typo cost a second preview.
  if (rec.fingerprint !== fp) return "mismatch";
  // ⚠ SINGLE USE. Deleted on success so a replayed token cannot create a second
  // row nothing can tell apart from the first.
  TOKENS.delete(token);
  return "ok";
}

// ── The target: which room is this write landing in? ─────────────────

/**
 * What the confirm gate needs to know about the workspace a call resolved to.
 *
 * ⚠ `unknown` FAILS CLOSED — it is treated as a shared container. Reading "I
 * could not tell how many people are in this room" as "nobody" is the inversion
 * `factory.ts › bootServer`'s `?? 0` exists to refuse, and this module inherits
 * that rule rather than restating a softer one.
 */
export interface ConfirmTarget {
  workspaceId: string | null;
  /** Neutralized display name, or a fallback — this is a VALUE. */
  label: string;
  /** A `kind='link'` container with more than one active member. */
  sharedContainer: boolean;
  unknown: boolean;
}

const UNKNOWN_TARGET: ConfirmTarget = {
  workspaceId: null,
  label: "`(workspace could not be read)`",
  sharedContainer: true,
  unknown: true,
};

/**
 * Resolve the workspace this call actually landed in.
 *
 * ⚠ READS THE ALS OVERRIDE FIRST. `registrar.ts` runs the handler inside
 * `workspaceContext.run(resolvedId, …)` for a per-call `workspace=`, and the
 * transport's stored id is the SESSION default — reading only the latter would
 * ask "is my default workspace a container" about a call that went elsewhere.
 *
 * ⚠ ONE loopback, on a COLD path: it runs only for a write that is already
 * asking to publish. Nothing on the hot read paths pays for it.
 */
export async function resolveConfirmTarget(
  client: DoplClient,
): Promise<ConfirmTarget> {
  const workspaceId = workspaceContext.getStore() ?? client.getWorkspaceId();
  if (!workspaceId) return UNKNOWN_TARGET;
  try {
    const { workspaces } = await client.listWorkspaces();
    const found = workspaces.find((w) => w.id === workspaceId);
    if (!found) return { ...UNKNOWN_TARGET, workspaceId };
    const container = !isStandardWorkspace(found);
    return {
      workspaceId,
      label: inlineOr(found.name, "`(unnamed workspace)`"),
      // ⚠ SHARED, NOT SOLO, and `?? 0` is NOT SOLO. A one-member container is
      // the operator's own agent surface with no second audience in it; the
      // class exists because a PEER arrived.
      sharedContainer: container && (found.memberCount ?? 0) !== 1,
      unknown: false,
    };
  } catch {
    return { ...UNKNOWN_TARGET, workspaceId };
  }
}

// ── The gate ─────────────────────────────────────────────────────────

/** One audience-changing act, as the gate needs to see it. */
export interface ConfirmAct {
  tool: string;
  op: string;
  callerUserId: string | null;
  /** One line naming what will exist afterwards. Values must be neutralized. */
  what: string;
  /** Who will be able to see it. Values must be neutralized. */
  audience: string;
  /** ⚠ EVERY field that decides what lands and who sees it. A field left out
   *  is a field the agent can change between the preview and the act. */
  payload: Record<string, unknown>;
}

export type ConfirmVerdict =
  | { kind: "proceed" }
  | { kind: "halt"; response: ToolResponse };

const PROCEED: ConfirmVerdict = { kind: "proceed" };

/**
 * ⚠ A TOKEN ON A CALL THAT IS NOT IN THE CONFIRM CLASS IS REFUSED, not ignored.
 * The house rule is that an unknown argument is refused rather than stripped
 * (`registrar.ts › strictInput`), and the same reasoning applies one level up: a
 * caller echoing a token into a private create has mis-modelled the surface, and
 * silently accepting it teaches the wrong shape.
 */
export function refuseStrayToken(tool: string, op: string): ToolResponse {
  return err(
    `\`confirm_token\` was passed to ${tool} op="${op}", but this call is not audience-changing — it creates something only you can see, so there is no preview to confirm and nothing was created. Re-issue WITHOUT \`confirm_token\`. Tokens are only ever minted for a write that publishes into a shared home channel.`,
  );
}

/**
 * THE GATE. Call it after the local contradiction refusals and before the
 * client write.
 *
 *   - not publishing, no token   → proceed
 *   - not publishing, with token → refuse (stray token)
 *   - publishing, not a shared container → proceed (nobody else is in the room)
 *   - publishing into a shared container, no token → PREVIEW + a fresh token
 *   - publishing into a shared container, token    → verify, then proceed
 */
export async function confirmGate(
  client: DoplClient,
  act: ConfirmAct,
  opts: { publishes: boolean; token?: string },
): Promise<ConfirmVerdict> {
  const token = opts.token?.trim() ?? "";
  if (!opts.publishes) {
    return token
      ? { kind: "halt", response: refuseStrayToken(act.tool, act.op) }
      : PROCEED;
  }

  const target = await resolveConfirmTarget(client);
  if (!target.sharedContainer) {
    return token
      ? { kind: "halt", response: refuseStrayToken(act.tool, act.op) }
      : PROCEED;
  }

  const fp = fingerprint(act, target);
  if (!token) {
    return { kind: "halt", response: preview(act, target, mint(fp)) };
  }
  const verdict = consume(token, fp);
  if (verdict === "ok") return PROCEED;
  return { kind: "halt", response: tokenRefusal(act, verdict) };
}

/**
 * THE DRY RUN. ⚠ `isError`, deliberately: NOTHING was created, and an `ok`
 * result reading as a normal outcome invites an agent to report success — the
 * same reasoning `channel-ops-launch.ts › ambiguousTemplate` states for its own
 * refusal.
 */
function preview(
  act: ConfirmAct,
  target: ConfirmTarget,
  token: string,
): ToolResponse {
  return err(
    [
      `NOTHING WAS CREATED — this is a dry run. ${act.tool} op="${act.op}" would publish into a home channel somebody ELSE is in, so it previews first.`,
      "",
      `**What would be created:** ${act.what}`,
      `**Where:** ${target.label}${target.unknown ? " — ⚠ the workspace could not be read, so this is being treated as a shared room" : " (a home channel with at least one other person in it)"}`,
      `**Who would see it:** ${act.audience}`,
      "",
      `To go ahead, re-issue the SAME call with \`confirm_token="${token}"\` and every other argument UNCHANGED. The token is single-use, expires in 5 minutes, and is bound to this exact payload — changing any field invalidates it and you get a fresh preview instead of a surprise.`,
      `⚠ This is a step that makes you LOOK, not a permission check. If you are not sure your operator wants this shared with the other people in that channel, ASK THEM rather than echoing the token back.`,
    ].join("\n"),
  );
}

function tokenRefusal(act: ConfirmAct, verdict: ConsumeResult): ToolResponse {
  const why =
    verdict === "expired"
      ? `that \`confirm_token\` EXPIRED (they last 5 minutes)`
      : verdict === "mismatch"
        ? `that \`confirm_token\` was minted for a DIFFERENT payload — at least one argument changed since the preview`
        : `that \`confirm_token\` is not recognised: it was already used, it was minted somewhere this request cannot see, or it was never issued`;
  return err(
    `Nothing was created — ${why}. Re-issue ${act.tool} op="${act.op}" WITHOUT \`confirm_token\` to get a fresh preview of exactly what would land and who would see it, then confirm that one. Do not guess a token: they are random and a wrong one can only ever refuse.`,
  );
}

/** ⚠ TEST-ONLY. Nothing in the server calls it; the store is process-lifetime
 *  state and a suite that cannot clear it tests the previous suite's leftovers. */
export function __resetConfirmTokensForTest(): void {
  TOKENS.clear();
}
