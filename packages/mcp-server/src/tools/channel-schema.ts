/**
 * THE PUBLISHED INPUT SHAPE for `dopl_channel` — one flat schema of optional
 * params, plus the `op` discriminator, with the per-op requirements enforced at
 * runtime by `missingParams` in the registrar.
 *
 * This is the DECLARED SURFACE an MCP client introspects (names, types, caps,
 * per-param teaching); the registrar is routing. ⚠ The parity suite reads both:
 * every declared param must be referenced by some handler in the `channel-*`
 * group, and no handler may read an arg not declared here.
 *
 * ⚠ Caps and minimums HAND-MIRROR the routes' zod schemas
 * (src/features/channels/schema.ts): title 200, body 16000, summary 2000 (a
 * post's summary is 200), client_msg_id 200, `.min(1)` on body /
 * client_msg_id / title. Declared here they publish as maxLength and are
 * enforced before the call; omit one and the route rejects it as an opaque 400
 * the write ops mis-narrate. `.trim()` where — and ONLY where — the route trims
 * before measuring, so the two agree on what "200 characters" counts.
 *
 * ⚠ `summary` is deliberately NOT split: one param serves two routes with two
 * caps, and this declares the LOOSER so a legitimate close summary is never
 * refused client-side. The tighter number is stated in its `.describe()`.
 */

import { z } from "zod";
import {
  AWAIT_HOLD_CAP_MS,
  AWAIT_HOLD_DEFAULT_MS,
} from "./channel-await-budget";

export const CHANNEL_INPUT_SHAPE = {
  op: z
    .enum([
      "list",
      "open",
      "invite",
      "post",
      // ⚠ MILESTONE is its own op rather than a `kind` an agent picks on
      // `post` — see the `kind` field below.
      "milestone",
      "read",
      "await",
      "members",
      "list_threads",
      "get_thread",
      // The CALLER'S OWN live sessions: handle, state (working/idle/ended) and
      // thread. Read-only and own-scoped; `channel` narrows to one channel.
      "read_sessions",
      "create_thread",
      // ⚠ An agent PROPOSES a close and a human confirms. `close_thread` stays
      // in the enum so an older agent gets a teaching refusal naming its
      // replacement rather than an opaque "unknown op".
      "propose_close",
      "close_thread",
      "set_thread_mode",
    ])
    .describe("Operation to perform."),
  channel: z
    .string()
    .optional()
    .describe(
      'Channel slug or id. Required for every op except three: "open" (which creates a channel), "list" (which lists them all), and "read_sessions" (where it is an OPTIONAL filter — omit it to see every session of yours in the workspace).',
    ),
  direct: z
    .boolean()
    .optional()
    .describe(
      'op="open": set true to open a direct (1:1) message instead of a named channel — pass `member` (no name). Reuses the existing DM if one already exists.',
    ),
  name: z
    .string()
    .optional()
    .describe(
      'op="open" (required for a channel; omit for a direct message): the channel name (1-120 chars).',
    ),
  topic: z
    .string()
    .optional()
    .describe('op="open": optional one-line topic / purpose for the channel.'),
  visibility: z
    .enum(["private", "public"])
    .optional()
    .describe(
      'op="open": "private" (default, invite-only) or "public" (any workspace member can see and join).',
    ),
  member: z
    .string()
    .optional()
    .describe(
      'op="invite" (required) / op="open" with direct=true (required): the member — an email or user id of an ACTIVE workspace member.',
    ),
  intent: z
    .enum(["chat", "request"])
    .optional()
    .describe(
      'op="post" (optional, default "request"): what this message IS. "request" is the working message: it may address a PERSON with `to`, and in a DIRECT (1:1) channel the server addresses it to the other member for you, which is what puts it in front of their side. "chat" is PEOPLE TALKING: it addresses nobody, starts nobody, and the direct-channel auto-address is skipped entirely, so two people can talk in a DM without each line poking the other side\'s machine. "chat" together with `to` is a contradiction and is REFUSED (nothing is sent) rather than resolved one way — drop the address, or post as a "request".',
    ),
  body: z
    .string()
    // ⚠ `.min(1)` mirrors the route on BOTH the post and create_thread schemas.
    .min(1)
    .max(16000)
    .optional()
    .describe(
      'op="post" / op="create_thread" / op="milestone" (required): the message text, <=16000 characters. For op="post" this is what you are actually saying, and it is a normal message whatever it contains — a half-sentence, a status line, or the finished deliverable. For op="milestone" it is ONE LINE naming the step that just landed, nothing more (content does not travel in a milestone; nobody reads one as an answer). For create_thread, it is the requester\'s initial request.',
    ),
  to: z
    .string()
    .optional()
    .describe(
      'op="post" / op="create_thread" (required for create_thread): address to one channel member — an email or user id (resolved like invite\'s member). For post it makes the message a REQUEST that triggers that member\'s listener and can start their agent, so name someone only when you are asking for their machine. Omit it for talk nobody must act on — and say so outright with `intent`="chat", which addresses nobody even in a direct channel. A channel reaches PEOPLE: there is no way to address an agent by name. For create_thread, it is the member the thread is for.',
    ),
  // ⚠ One param, two routes, two caps (post 200, close 2000). Declares the
  // LOOSER so a legitimate close summary is never refused client-side; an
  // over-length POST summary stays the route's to reject.
  summary: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe(
      'op="post": a short one-line intent (<=200 chars — the post route enforces 200, not 2000). ALWAYS set it — it becomes the notification the receiving member sees. op="propose_close" (optional): the one-line reason you think the thread is done (<=2000 chars). It is the BODY of the proposal your operator reads before deciding, and it is carried into the close summary if they confirm — so write the outcome, not "done".',
    ),
  // ⚠ The kinds are NOT a vocabulary to pick from — the describe must say whose
  // each one is. Listing five names with no rule gets a finished responder to
  // post its ANSWER as `task_finished`, which appears nowhere:
  // `lib/group-thread.ts` folds a terminal marker into `endEvent` and never
  // renders its body.
  //
  // ⚠ The enum keeps all five ON PURPOSE — narrowing turns the mistake into an
  // opaque zod -32602 exactly when the agent needs telling what to do instead.
  kind: z
    .enum([
      "message",
      "task_started",
      "task_progress",
      "task_finished",
      "task_failed",
    ])
    .optional()
    .describe(
      'op="post": LEAVE THIS UNSET. The default, "message", is what every substantive thing you send is — including your FINAL ANSWER. The other four keep the older `task_` storage names and are NOT interchangeable with it: "task_started" / "task_finished" / "task_failed" are LIFECYCLE MARKERS owned by the runtime that starts and stops a session and by a thread close, and this tool REFUSES them from you (a body written into one is not rendered on the other member\'s thread card at all, so an answer sent as one is delivered nowhere). "task_progress" is the milestone lane and is yours, but you do not need this field for it either: op="milestone" posts one with no kind to pick.',
    ),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'op="post": optional JSON object of structured fields for task_* events (e.g. {taskId, status, durationMs, refs}).',
    ),
  client_msg_id: z
    .string()
    // ⚠ `.min(1)` mirrors the route — a blank idempotency key is not a key, and
    // a client-side refusal keeps the caller from believing it deduped anything.
    .min(1)
    .max(200)
    .optional()
    .describe(
      'op="post" / op="create_thread": optional idempotency key — re-sending the same op with the same id will not create a duplicate (a repeat create_thread returns the already-created thread instead of opening a second). Use it whenever a retry is possible; any stable string of your own is fine.',
    ),
  title: z
    .string()
    .trim()
    // ⚠ `.min(1)` mirrors the route and is measured AFTER the trim on both
    // sides, so a whitespace-only title is refused here rather than 400ing.
    .min(1)
    .max(200)
    .optional()
    .describe(
      'op="create_thread" (required): the thread title (1-200 chars) — a short header for the exchange. A longer title is rejected here, before the call is made; shorten it rather than retrying.',
    ),
  mode: z
    .enum(["interactive", "autonomous"])
    .optional()
    .describe(
      'op="create_thread" (optional, default "interactive") / op="set_thread_mode" (required): the thread execution mode.',
    ),
  handoff: z
    .boolean()
    .optional()
    .describe(
      'op="create_thread" (optional, default false): SPAWN-WITH-HANDOFF. Set true when YOU are an external agent (this Claude Desktop / Claude Code) opening a thread that your operator\'s Dopl app should then DRIVE — a full session opens on their machine and carries the conversation, instead of this external session keeping it. Default (omitted/false) is unchanged: the thread is created and THIS session keeps the reply, nothing opens on their machine. Only meaningful on YOUR OWN operator\'s create — the desktop honors it only for a thread you created as yourself, so it can never open a window on anyone else\'s machine. Use it when the operator asked you to "spin up an agent on Dopl to talk to <someone> about X"; leave it off when you are the one who will handle the replies here.',
    ),
  thread: z
    .string()
    .optional()
    .describe(
      'op="get_thread" / op="propose_close" / op="set_thread_mode" / op="milestone" (required): the thread id (returned by create_thread). op="post" (optional): thread this post under that thread. op="read" (optional): filter the transcript to that one exchange — only messages tagged with this thread id come back. It FILTERS, so an id no message carries returns nothing rather than an error, and `await` has no counterpart (it is always channel-wide).',
    ),
  outcome: z
    .enum(["completed", "failed"])
    .optional()
    .describe(
      'op="propose_close" (required): the outcome you are PROPOSING — "completed" or "failed". Your operator sees it prefilled on the confirm and can change it; nothing is closed until they do.',
    ),
  // ⚠ coerce: MCP clients sometimes send numbers as strings, and strict
  // z.number() rejects those with an opaque -32602.
  since: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'op="read": return only messages with seq greater than this. op="await" (required): the last seq you have processed.',
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'op="read": max messages to return (1-200, DEFAULT 100). Omitted with no `since`, that is the NEWEST 100 — older messages are absent, not reported as absent.',
    ),
  timeout_ms: z.coerce
    .number()
    .int()
    .min(0)
    .max(AWAIT_HOLD_CAP_MS)
    .optional()
    .describe(
      `op="await": TOTAL time to hold before returning with no messages (milliseconds, max ${AWAIT_HOLD_CAP_MS}; defaults to ${AWAIT_HOLD_DEFAULT_MS} when omitted). The hold is assembled server-side out of ~50s polls re-issued with the same cursor, so it returns the instant a message arrives. Leave it unset unless you deliberately want a short check — the long default is what keeps the call pending past the ~2-minute mark where a client that backgrounds pending calls can turn the result into a wake. If a long hold comes back as a raw transport timeout instead of a result, your own MCP client is capping the call: report that to your operator and fall back to timeout_ms=50000 plus repeated op="read".`,
    ),
};
