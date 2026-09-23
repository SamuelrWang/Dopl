/**
 * The confirm class: a dry-run preview plus an opaque server-minted token the acting call must echo back.
 * A tripwire, not a fence, for publishing into a container other people stand in (any second member, whatever the
 * kind — F-513): it proves the agent SAW the act, not that a human approved it. What refuses is the server
 * (credential lock, audience ceiling in `service-audience.ts`, and `shared-publish.ts`'s 400).
 * The store is module-scoped (the server boots per request); an unknown token refuses, so a lost store means "preview again".
 */

import { randomBytes, createHash } from "node:crypto";
import { workspaceContext } from "@dopl/client";
import type { DoplClient } from "@dopl/client";
import { isSharedRoom } from "../shared-room.js";
import { inlineOr } from "./narration.js";
import { err, isApiError, type ToolResponse } from "./respond.js";

/** Short-lived so the preview is still in the agent's context when it acts. */
const TOKEN_TTL_MS = 5 * 60_000;
/** Expired rows linger so "expired" can be said rather than answered as "never existed". */
const TOKEN_GRACE_MS = 30 * 60_000;
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
  // Evict oldest (insertion order) rather than refuse to mint: a full store must never block a preview.
  while (TOKENS.size >= TOKEN_STORE_MAX) {
    const oldest = TOKENS.keys().next();
    if (oldest.done) break;
    TOKENS.delete(oldest.value);
  }
}

/** Digest binding the token to the caller who previewed, the target workspace and the exact act (key-sorted). */
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
  // Random, never payload-derived: a computable token would let the agent skip the preview.
  const token = randomBytes(18).toString("base64url");
  TOKENS.set(token, { fingerprint: fp, expiresAt: now + TOKEN_TTL_MS });
  return token;
}

type ConsumeResult = "ok" | "unknown" | "expired" | "mismatch";

function consume(token: string, fp: string): ConsumeResult {
  const rec = TOKENS.get(token);
  if (!rec) return "unknown";
  if (Date.now() > rec.expiresAt) return "expired";
  // A mismatch does not burn the token: it stays valid for the payload it was minted for.
  if (rec.fingerprint !== fp) return "mismatch";
  // Single use.
  TOKENS.delete(token);
  return "ok";
}

/** What the gate knows about the workspace a call resolved to. `unknown` fails closed (treated as shared). */
export interface ConfirmTarget {
  workspaceId: string | null;
  /** Neutralized display name, or a fallback. */
  label: string;
  /** Any container with more than one active member, whatever the kind. */
  sharedContainer: boolean;
  unknown: boolean;
}

const UNKNOWN_TARGET: ConfirmTarget = {
  workspaceId: null,
  label: "`(workspace could not be read)`",
  sharedContainer: true,
  unknown: true,
};

/** Resolves the workspace this call landed in — the per-call ALS override first, then the session default. */
export async function resolveConfirmTarget(
  client: DoplClient,
): Promise<ConfirmTarget> {
  const workspaceId = workspaceContext.getStore() ?? client.getWorkspaceId();
  if (!workspaceId) return UNKNOWN_TARGET;
  try {
    const { workspaces } = await client.listWorkspaces();
    const found = workspaces.find((w) => w.id === workspaceId);
    if (!found) return { ...UNKNOWN_TARGET, workspaceId };
    return {
      workspaceId,
      label: inlineOr(found.name, "`(unnamed workspace)`"),
      // Member count only, no kind term (F-513); an unreadable count is not solo (`../shared-room.js`).
      sharedContainer: isSharedRoom(found.memberCount),
      unknown: false,
    };
  } catch {
    return { ...UNKNOWN_TARGET, workspaceId };
  }
}

export interface ConfirmAct {
  tool: string;
  op: string;
  callerUserId: string | null;
  /** One line naming what will exist afterwards. Values must be neutralized. */
  what: string;
  /** Who will be able to see it. Values must be neutralized. */
  audience: string;
  /** Every field that decides what lands and who sees it; one left out can change between preview and act. */
  payload: Record<string, unknown>;
}

/** `acknowledgedShared` is true only when a token was spent on this act; the caller sends it as `acknowledgeShared`. */
export type ConfirmVerdict =
  | { kind: "proceed"; acknowledgedShared: boolean }
  | { kind: "halt"; response: ToolResponse };

const PROCEED: ConfirmVerdict = { kind: "proceed", acknowledgedShared: false };
const PROCEED_ACKNOWLEDGED: ConfirmVerdict = {
  kind: "proceed",
  acknowledgedShared: true,
};

/** A token on a call outside the confirm class is refused, not ignored (as `registrar.ts › strictInput` does). */
export function refuseStrayToken(tool: string, op: string): ToolResponse {
  return err(
    `\`confirm_token\` was passed to ${tool} op="${op}", but this call is not audience-changing — it creates something only you can see, so there is no preview to confirm and nothing was created. Re-issue WITHOUT \`confirm_token\`. Tokens are only ever minted for a write that publishes into a shared home channel.`,
  );
}

/** Maps the server's 400 `CONTAINER_PUBLISH_UNACKNOWLEDGED`; the remedy is the caller's because it differs by op. */
export function containerPublishUnacknowledged(
  e: unknown,
  remedy: string,
): ToolResponse | null {
  if (!isApiError(e, 400, "CONTAINER_PUBLISH_UNACKNOWLEDGED")) return null;
  return err(
    `Nothing was written. This would publish into a home channel somebody ELSE is standing in, and the server requires that the audience change be acknowledged. ${remedy}`,
  );
}

/** For a previewed op, that 400 means the room changed under the token, so the remedy is a fresh preview. */
export const RECONFIRM_REMEDY =
  `Re-issue the SAME call WITHOUT \`confirm_token\` to get a fresh preview of who would see it, then confirm THAT one.`;

/**
 * The gate: call after local refusals, before the client write. Not publishing or a solo room proceeds (a stray token
 * is refused); a shared room with no token runs `precheck`, then previews with a fresh token; with a token it verifies
 * and proceeds with `acknowledgedShared: true`.
 */
export async function confirmGate(
  client: DoplClient,
  act: ConfirmAct,
  opts: {
    publishes: boolean;
    token?: string;
    /** Asked once, right before minting: a response halts, `null` previews. A throw propagates — "could not check"
     *  must never mint a token for an act the confirmed call would refuse. */
    precheck?: () => Promise<ToolResponse | null>;
  },
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
    // Precheck before `mint`: the preview text is built from the token.
    const refusal = opts.precheck ? await opts.precheck() : null;
    if (refusal) return { kind: "halt", response: refusal };
    return { kind: "halt", response: preview(act, target, mint(fp)) };
  }
  const verdict = consume(token, fp);
  if (verdict === "ok") return PROCEED_ACKNOWLEDGED;
  return { kind: "halt", response: tokenRefusal(act, verdict) };
}

/** The dry run, returned as `isError` so nothing reads as a success. */
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
      `**Where:** ${target.label}${target.unknown ? " — ⚠ this home channel could not be read, so it is being treated as a shared room" : " (a home channel with at least one other person in it)"}`,
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

/** Test-only: clears the process-lifetime store. */
export function __resetConfirmTokensForTest(): void {
  TOKENS.clear();
}
