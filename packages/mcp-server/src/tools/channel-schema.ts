/**
 * THE PUBLISHED INPUT SHAPE for `dopl_channel` — one flat schema of optional
 * params, plus the `op` discriminator, with the per-op requirements enforced at
 * runtime by `missingParams` in the registrar.
 *
 * Split out of `channel.ts` at the §2 500-line cap alongside
 * `channel-description.ts`. The seam is the same one: this is the DECLARED
 * SURFACE an MCP client introspects (names, types, caps, and the prose that
 * teaches each param), while the registrar is routing. The parity suite reads
 * both — every declared param must be referenced by some handler in the
 * `channel-*` group, and no handler may read an arg that is not declared here.
 *
 * The caps below MIRROR the routes' own zod schemas
 * (src/features/channels/schema.ts): title 200, body 16000, summary 2000 (the
 * tighter 200 applies to a post's summary), client_msg_id 200. Declared here
 * they are published in the tool's inputSchema (the model sees a maxLength) and
 * enforced before the call is made at all. `.trim()` where — and only where —
 * the route trims before measuring, so the two agree on what "200 characters"
 * counts.
 *
 * F5 (2026-08-01) — THE MINIMUMS MIRROR TOO. `body` / `client_msg_id` / `title`
 * carried a maximum and no minimum while the route required `.min(1)` on all
 * three, so an empty body, a blank idempotency key and a whitespace-only title
 * each passed the tool and died at the route as an opaque 400 that the write ops
 * then mis-narrated (see `channel-errors.ts`). A client-side refusal is a -32602
 * that names the field.
 *
 * THE NAMED-AGENT PARAMS ARE GONE (channels rollback §1, 2026-08-05):
 * `to_agent` / `to_agents` / `as_agent` / `participants` / `status`, and the
 * seven ops that read them. They are DROPPED FROM THE ENUM rather than kept for
 * a teaching refusal, unlike `close_thread` below — a removed op whose
 * capability is genuinely gone gets a plain "invalid enum value", which is the
 * honest answer, where `close_thread`'s capability moved and its refusal names
 * where it moved to.
 *
 * `summary` IS DELIBERATELY NOT SPLIT and its declared 2000 stays. One param
 * serves two routes with two caps (post 200, close_thread 2000) and this schema
 * declares the LOOSER one so a legitimate close summary is never refused
 * client-side; the tighter number is stated in its `.describe()`. See the note
 * above the field.
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
      // P0-3 (2026-08-04) — the MILESTONE gets its own op rather than staying a
      // `kind` an agent has to pick on `post`. See the `kind` field below for
      // what that choice cost.
      "milestone",
      "read",
      "await",
      "members",
      "list_threads",
      "get_thread",
      // READ-SESSION-STATE (rollback §3.5) — "what is flint doing?" answered
      // over MCP: the CALLER'S OWN live sessions, each with its handle, its
      // state (working/idle/ended) and the thread it is on. Read-only and
      // own-scoped; `channel` narrows it to one channel.
      "read_sessions",
      "create_thread",
      // DECISION 2 (2026-08-04) — an agent PROPOSES a close and a human confirms
      // it. `close_thread` is kept in the enum so the call an older agent makes
      // gets a teaching refusal that names its replacement, rather than an
      // opaque "unknown op".
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
  // Q9 — the caps below MIRROR the routes' own zod schemas
  // (src/features/channels/schema.ts): title 200, body 16000, summary 2000
  // (the tighter 200 applies to a post's summary), client_msg_id 200. They
  // lived only in `.describe()` prose, so an over-length field was rejected
  // by the ROUTE, as an opaque 400 the write ops then mis-narrated. Declared
  // here they are published in the tool's inputSchema (the model sees a
  // maxLength) and enforced before the call is made at all.
  //
  // `.trim()` where — and only where — the route trims before measuring, so
  // the two agree on what "200 characters" counts.
  body: z
    .string()
    // F5 — `.min(1)` mirrors the route (`body: z.string().min(1).max(16000)`,
    // on BOTH the post and the create_thread schemas). Without it an empty body
    // passed the tool and died at the route as a 400 the caller then read as a
    // membership or thread problem; refused here it is a plain -32602 naming
    // the field.
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
  // One param, two routes, two caps: a post's summary is capped at 200 and a
  // close summary at 2000. The schema declares the LOOSER of the two so a
  // legitimate close summary is never refused client-side; a 201-character
  // POST summary is still the route's to reject, and Q9's code mapping now
  // reports that honestly instead of blaming the addressee.
  summary: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe(
      'op="post": a short one-line intent (<=200 chars — the post route enforces 200, not 2000). ALWAYS set it — it becomes the notification the receiving member sees. op="propose_close" (optional): the one-line reason you think the thread is done (<=2000 chars). It is the BODY of the proposal your operator reads before deciding, and it is carried into the close summary if they confirm — so write the outcome, not "done".',
    ),
  // P0-3 / DECISION 1 (2026-08-04) — WHAT THIS FIELD USED TO SAY, AND WHAT IT
  // COST. It read: "message (default, chat) or a structured activity event
  // (task_started / task_progress / task_finished / task_failed)". Five names,
  // one list, no rule about which is which — so a responder that had finished
  // its work posted the ANSWER as `task_finished`, and the answer appeared
  // nowhere: `lib/group-thread.ts` folds a terminal marker into `endEvent` and
  // never renders its body. The kinds are not a vocabulary to pick from, and the
  // describe now says whose each one is.
  //
  // THE ENUM KEEPS ALL FIVE ON PURPOSE. Narrowing it would turn the mistake into
  // an opaque -32602 from zod ("invalid enum value") at exactly the moment the
  // agent needs to be told what to do instead; `channel-ops-write.ts` refuses
  // the three lifecycle kinds with a sentence, and the server refuses them again
  // for anything that skips this tool.
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
    // F5 — `.min(1)` mirrors the route. An idempotency key of "" is not a key:
    // the route refuses it, and a client-side refusal keeps the caller from
    // believing a blank key deduped anything.
    .min(1)
    .max(200)
    .optional()
    .describe(
      'op="post" / op="create_thread": optional idempotency key — re-sending the same op with the same id will not create a duplicate (a repeat create_thread returns the already-created thread instead of opening a second). Use it whenever a retry is possible; any stable string of your own is fine.',
    ),
  title: z
    .string()
    .trim()
    // F5 — `.min(1)` mirrors the route (`title: z.string().trim().min(1)
    // .max(200)`), and it is measured AFTER the trim on both sides, so a
    // whitespace-only title is refused here rather than 400ing at the route
    // with a thread half-implied.
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
  // coerce: MCP clients sometimes send numbers as strings; strict
  // z.number() rejects them with an opaque -32602.
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
