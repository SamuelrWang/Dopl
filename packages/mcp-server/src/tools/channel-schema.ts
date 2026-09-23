/**
 * Published input shape for `dopl_channel`: one flat schema; per-op requirements are enforced at
 * runtime by `missingParams`. Parity suite: every param is read by some `channel-*` handler and no
 * handler reads an undeclared one. Every `.describe()` is pushed on every connection and budgeted
 * (`channel-schema-budget.test.ts`): a rule goes in the pulled `channel-doctrine.ts › FIELDS`, a
 * describe carries one field's contract and never hand-types a bound the schema publishes.
 * Caps hand-mirror the route zod (`src/features/channels/schema.ts`); `.trim()` only where it trims.
 */

import { z } from "zod";
import { RESPONSE_FORMAT_FIELD } from "./response-size";
// Lane fields: own modules, spread in their original positions so the published schema is unchanged.
import { LAUNCH_INPUT_FIELDS } from "./channel-schema-launch-fields";
import { ROOMS_INPUT_FIELDS } from "./channel-schema-rooms-fields";
import { DECISION_INPUT_FIELDS } from "./channel-schema-decision-fields";
import { HOLD_CAP_MS } from "./channel-hold-budget";

import { CHANNEL_OPS, CHANNEL_ACTION_NAMES, unknownOpRefusal } from "./channel-vocab";

export const SCHEMA_MAX_CHARS = 9_155; // Re-derive through `channel-schema-budget.test.ts`, never quote.

export const PARAM_DESCRIPTION_MAX_CHARS = 400; // Per-`.describe()` cap.

export const CHANNEL_INPUT_SHAPE = {
  // Inert, not refused, on ops other than read/status: a 400 teaches agents to stop passing it.
  response_format: RESPONSE_FORMAT_FIELD,

  // Unknown or retired names get `channel-vocab.ts › unknownOpRefusal` via zod's error hook.
  op: z
    .enum(CHANNEL_OPS, { error: (issue) => unknownOpRefusal(issue.input) })
    .describe("Operation to perform."),

  // One sub-verb param for every dispatching op; the vocabularies are disjoint.
  action: z
    .enum(CHANNEL_ACTION_NAMES)
    .optional()
    .describe(
      'op="manage" (required): "launch", "end", "rename", "posture" or "direct" — all on YOUR OWN operator\'s machine. op="rooms" (required): "list", "open", "invite", "members", "threads", "thread_mode", "update" or "help". op="artifact" (required): "create", "add", "remove" or "dissolve".',
    ),

  channel: z
    .string()
    .optional()
    .describe(
      'Channel slug or id. Required except on op="rooms" action="list" / "open" / "help"; omitting it WIDENS op="read" and op="status".',
    ),

  // Resolved server-side (`service-writes-metadata-recipient.ts › resolveToRecipients`). On op="send" a
  // comma-separated list in one string: a `string | string[]` union would publish as `anyOf`.
  to: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      // Handle forms are per-op: op="manage" resolves no names (`channel-agent-target.ts` refuses them).
      'WHO this call is about.\nop="send": who it is FOR — a member (email or user id), `@agent-<id>` or an agent handle; SEVERAL, comma-separated, mixed.\nop="manage": which ONE of YOUR OWN agents — `@agent-<id>` ONLY, no handle.\nop="rooms": the member to "invite", or open a 1:1 with.',
    ),

  body: z
    .string()
    .min(1)
    .max(16000)
    .optional()
    .describe(
      // `<=2000` is the launch cap (`schema-launch.ts › LaunchCreateSchema.goal`), unpublishable here as
      // this field serves three routes. The recipient clause is pushed on purpose; nothing validates it.
      'op="send" (required): the message text. ⚠ The recipient is `to=` and is rendered from it — never write a routing header or a name into the body. op="manage" (required on "launch" and "direct"): the agent\'s opening instruction (launch: <=2000), or the private message.',
    ),

  // `decision` must store as a `message` row or `targeting.js › classify` drops the card; `record`
  // sends `intent:"chat"`, so a send naming nobody can be refused instead of guessed at.
  kind: z
    .enum(["message", "milestone", "decision", "record"])
    .optional()
    .describe(
      'op="send" (optional, default "message"): "record" takes no `to`; "milestone" marks a step on a thread; "decision" is a card answered in one press.',
    ),

  thread: z
    .string()
    .optional()
    .describe(
      // "its metadata header plus only that exchange" is pinned by `channel-law.test.ts`.
      'A thread id. ⚠ "new" on op="send" OPENS one and returns its id, with `summary` as its title. Required on op="send" kind="milestone" and on op="rooms" action="thread_mode"; on op="read" it narrows to its metadata header plus only that exchange.',
    ),

  summary: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe(
      // "description" is the UI label; the wire field and column stay `topic`.
      'The one-line intent. ALWAYS set it on op="send" — it becomes the notification the receiving member sees; on kind="decision" it is the QUESTION the card asks, on op="rooms" action="open"/"update" it is the description, and on op="artifact" it is what the folded run was about.',
    ),

  // Both routes dedupe per-author (`channel_messages` and `channel_tasks`).
  client_msg_id: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      // PER-AUTHOR and the op names are pinned by `channel-schema-caps.test.ts`.
      'op="send" / op="manage" / op="artifact" (optional): an idempotency key; a re-sent key hands back YOUR first call\'s result instead of acting twice. The dedupe is PER-AUTHOR on every op.',
    ),

  ...DECISION_INPUT_FIELDS,

  // No `.uuid()`: zod publishes it as a `pattern`, which `tool-style.test.ts` refuses on a
  // published property; `channel-ops-artifact.ts` refuses a malformed id by name.
  artifact: z
    .string()
    .optional()
    .describe(
      'op="artifact" (required on "add", "remove", "dissolve"): its id, as action="create" returned it.',
    ),

  // Named by `seq` (what a read prints); exactly-one is `channel-ops-artifact.ts › oneMessage`.
  // Cap hand-mirrors `src/features/channels/schema-artifacts.ts › ARTIFACT_CREATE_MAX_MESSAGES`.
  messages: z
    .array(z.coerce.number().int().positive())
    .min(1)
    .max(200)
    .optional()
    .describe(
      'op="artifact" (required on "create", "add" and "remove"): the message `seq`s — the whole set on "create", exactly ONE on "add" and "remove".',
    ),

  // coerce: MCP clients send numbers as strings, and strict z.number() 400s an opaque -32602.
  since: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      // "THREAD-SCOPED read" and "hands back none" are pinned by `channel-schema-caps.test.ts` and
      // `channel-thread-scope.test.ts`.
      'op="read" (optional, and REQUIRED with `wait_ms`): the last MESSAGE seq you have processed; only higher ones come back. A THREAD-SCOPED read hands back none.',
    ),

  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'op="read" (optional): max messages to return — with no `since` that is the NEWEST page.',
    ),

  // One hold param for both lanes. The published cap is the read hold's (`HOLD_CAP_MS`); the
  // directive lane clamps to `channel-directive-hold.ts › DIRECTIVE_WAIT_CAP_MS`.
  wait_ms: z.coerce
    .number()
    .int()
    .min(0)
    .max(HOLD_CAP_MS)
    .optional()
    .describe(
      'Optional HOLD. op="read": long-poll for messages after `since` instead of returning a page. op="manage" (<=30000): how long to hold for your operator\'s desktop to answer.',
    ),

  ...ROOMS_INPUT_FIELDS,

  ...LAUNCH_INPUT_FIELDS,
};
