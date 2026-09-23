import { z } from "zod";
import { safeLabel } from "@/shared/lib/safe-label";
import { closedEnum } from "@/shared/lib/closed-enum";
import { AGENT_COLOR_KEYS } from "./lib/agent-colors";
import type { AgentColorKey, MachineDelivery, SessionPillState } from "./types";

// Bounds only the two INTEGER health columns (`turns`, `denied_calls`); past it, a 22003 fails the whole push.
const INT4_MAX = 2_147_483_647;

/** Validated: an unchecked value reaches `.eq("channel_id", …)` as a uuid cast and 500s. */
export const SessionStateQuerySchema = z.object({
  channelId: z.string().uuid().optional(),
});
export type SessionStateQuery = z.infer<typeof SessionStateQuerySchema>;

// The desktop's `<channelId>:<taskId>:<agentId>` (`main/session-store.js › sessionKey`), never re-derived here.
// Tight charset: the reconcile deletes by key. Two-segment form kept for older desktops (INVARIANTS §13).
// Keep on one line: `dopl-desktop-app/test/session-state-push.test.mjs` lifts this literal by regex.
const SESSION_KEY_RE = /^[0-9a-fA-F-]{1,64}:[0-9a-fA-F-]{0,64}(?::[0-9a-zA-Z-]{0,64})?$/;

/** Mirrors `channel_sessions.name`'s CHECK so a bad handle is a named 400, not an opaque 500. */
const SESSION_NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;

/** One reported session. Added fields are `.nullable().optional()` so an older desktop's push still
 *  parses (INVARIANTS §13); `null` means unknown — never default it to 0. */
const SessionStateEntrySchema = z.object({
  sessionKey: z.string().regex(SESSION_KEY_RE, "Invalid session key"),
  channelId: z.string().uuid(),
  threadId: z.string().uuid().nullable().optional(),
  name: z.string().regex(SESSION_NAME_RE, "Invalid session handle"),
  // The `state` CHECK's closed set (deliberately no `thinking`); typed so TS drift breaks the build.
  state: closedEnum<SessionPillState>()(["working", "idle", "ended"]),
  /** A request the server may overrule (`server/session-colors.ts`); closed because the palette is ours. */
  color: closedEnum<AgentColorKey>()(AGENT_COLOR_KEYS).nullable().optional(),
  // Counterparty text headed for MCP narration; bounds mirror the column CHECKs.
  channelName: safeLabel("Channel name", 120).nullable().optional(),
  threadTitle: safeLabel("Thread title", 200).nullable().optional(),

  /** Six closed keys (`main/session-detail.js › detailFor`), but a label rather than an enum so a newer
   *  desktop's key cannot 400 the push; `collab-dto.ts › narrowSessionDetail` narrows it on read. */
  detail: safeLabel("Session detail", 40).nullable().optional(),
  toolLabel: safeLabel("Tool label", 80).nullable().optional(),
  model: safeLabel("Model", 120).nullable().optional(),
  contextUsed: z.number().int().nonnegative().nullable().optional(),
  contextWindow: z.number().int().nonnegative().nullable().optional(),
  tokensSpent: z.number().int().nonnegative().nullable().optional(),
  /** `.datetime()`: these land in TIMESTAMPTZ, where an unparseable string is a cast-error 500. */
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  lastActivityAt: z.string().datetime({ offset: true }).nullable().optional(),

  /** The identity's name as of spawn. 120 mirrors the `agent_identities` name CHECK; operator-only,
   *  never in the peer projection (`collab-dto.ts › OPERATOR_ONLY_SESSION_COLUMNS`). */
  identityName: safeLabel("Identity name", 120).nullable().optional(),

  // ── HEALTH (2026-09-01, migration 20260909120000) ────────────────────────
  // (The sentinel above is read verbatim by `scripts/check-session-health-drift.ts`.)
  turns: z.number().int().nonnegative().max(INT4_MAX).nullable().optional(),
  /** Tokens since this session last posted (`main/session-health.js › tokensSinceLastPost`). */
  tokensDelta: z.number().int().nonnegative().nullable().optional(),
  /** The machine's wedged flag (`main/session-health.js › isStale`), not the server's row-freshness
   *  `sessionIsStale`. Never coerce: `Boolean("false")` is `true`. */
  stale: z.boolean().nullable().optional(),
  deniedCalls: z
    .number()
    .int()
    .nonnegative()
    .max(INT4_MAX)
    .nullable()
    .optional(),
  lastDeniedTool: safeLabel("Last denied tool", 80).nullable().optional(),
  /** What the machine enqueued (`main/session-gate.js › enqueue`) — never a delivery guarantee. */
  lastWakeSeq: z.number().int().nonnegative().nullable().optional(),
  lastWakeAt: z.string().datetime({ offset: true }).nullable().optional(),

  // ── THE OPERATOR-GIVEN AGENT NAME (2026-08-31, migration 20260905120000) ──
  /** Peer-visible by design, unlike `identityName`; 60 mirrors the column CHECK and `main/agent-names.js › MAX_NAME`. */
  displayName: safeLabel("Agent name", 60).nullable().optional(),
});
export type SessionStateEntryInput = z.infer<typeof SessionStateEntrySchema>;

/** A "cannot write a table here" fence, but it must stay above `main/session-windowless.js ›
 *  MAX_CONCURRENT_SESSIONS`: only live rows go on the wire, and an oversized array 400s the whole push. */
const SESSION_REPORT_MAX = 32;

/** One machine's receipt for one message, keyed by `seq` — only what the machine itself did. */
export const DeliveryAckSchema = z.object({
  /** The fence: must name a session in this same push (`service-writes-delivery.ts`), or any room
   *  member could forge a monotonic `woken`. Required is safe only because no older desktop sends `acks`. */
  sessionKey: z.string().regex(SESSION_KEY_RE, "Invalid session key"),
  channelId: z.string().uuid(),
  seq: z.number().int().positive(),
  delivery: closedEnum<MachineDelivery>()([
    "delivered",
    "woken",
    "idle",
    "refused",
  ]),
});
export type DeliveryAckInput = z.infer<typeof DeliveryAckSchema>;

/** Same bound as the session set: an oversized array 400s the whole push, sessions included. */
const DELIVERY_ACK_MAX = SESSION_REPORT_MAX;

/** POST body: the whole live set for one workspace, never a delta — anything not listed is gone.
 *  Duplicate keys are refused, not deduped: two `ON CONFLICT` hits in one statement are a 21000. */
export const SessionStateReportSchema = z.object({
  sessions: z
    .array(SessionStateEntrySchema)
    .max(SESSION_REPORT_MAX)
    .refine(
      (list) => new Set(list.map((s) => s.sessionKey)).size === list.length,
      { message: "Duplicate session keys in one report" }
    ),
  /** Optional: installed desktops omit it. Not deduped — `service-writes-delivery.ts` resolves by rank. */
  acks: z.array(DeliveryAckSchema).max(DELIVERY_ACK_MAX).optional(),
});
export type SessionStateReportInput = z.infer<typeof SessionStateReportSchema>;
