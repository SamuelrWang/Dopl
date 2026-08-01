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
 * F5 (2026-08-01) — THE MINIMUMS MIRROR TOO, and the agent-ref cap is published
 * at last. `body` / `client_msg_id` / `title` carried a maximum and no minimum
 * while the route required `.min(1)` on all three, and `to_agent` / `to_agents`
 * items carried NO bound against the route's 64 — so an empty body, a blank
 * idempotency key, a whitespace-only title and an over-long handle each passed
 * the tool and died at the route as an opaque 400 that the write ops then
 * mis-narrated (see `channel-errors.ts`). A client-side refusal is a -32602 that
 * names the field.
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
// The status enum has ONE definition, beside the agent-identity helpers that
// share it — this schema publishes it rather than restating it.
import { AGENT_STATUSES } from "./channel-agent-refs";
// The MERGED agent-address cap, likewise one definition. Declaring it as this
// array's `.max()` is the CHEAP HALF of the bound: the server applies it to the
// deduped merge of `to_agent` + `to_agents`, which is why both describes below
// have to say "in total". See channel-addressing.ts.
import { MAX_ADDRESSED_AGENTS } from "./channel-addressing";

export const CHANNEL_INPUT_SHAPE = {
  op: z
    .enum([
      "list",
      "open",
      "invite",
      "post",
      "read",
      "await",
      "members",
      "list_threads",
      "get_thread",
      "create_thread",
      "close_thread",
      "set_thread_mode",
      "agents",
      "summon_agent",
      "rename_agent",
      "set_agent_status",
      "disengage_agent",
      "join_thread",
      "leave_thread",
    ])
    .describe("Operation to perform."),
  channel: z
    .string()
    .optional()
    .describe(
      'Channel slug or id. Required for every op except "open" (which creates a channel) and "list" (which lists them all) — including the multiplayer ops (agents / summon_agent / rename_agent / set_agent_status / disengage_agent / join_thread / leave_thread), since an agent and a participant set both belong to ONE channel.',
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
      'op="open" (required for a channel; omit for a direct message): the channel name (1-120 chars). op="summon_agent" (OPTIONAL): the handle for the new agent — omit it and the server picks a free one. op="rename_agent" (required): the agent\'s new handle. A handle is 2-31 characters: a lowercase letter, then lowercase letters, digits or hyphens, unique per channel — pass it BARE here, with no leading "@" (the `agent` param tolerates an @-prefix because it is looking a handle UP; this one is storing it, and the server rejects the "@").',
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
      'op="invite" (required) / op="open" with direct=true (required): the member — an email or user id of an ACTIVE workspace member. op="join_thread" / op="leave_thread": the PERSON joining or leaving the thread (pass `member` OR `agent`, never both).',
    ),
  agent: z
    .string()
    .optional()
    .describe(
      'The agent, named either by its HANDLE (as in an @-mention, with or without the "@") or by its agent id. Required for op="rename_agent" / op="set_agent_status" (yours only — an agent may be changed by the member who summoned it and no one else), for op="disengage_agent" (its OWNER or the human who engaged it), and for op="join_thread" / op="leave_thread" when the participant is an agent rather than a person. List the channel\'s agents with op="agents".',
    ),
  status: z
    .enum(AGENT_STATUSES)
    .optional()
    .describe(
      'op="set_agent_status" (required): the agent\'s lifecycle state — "summoned" (created, not yet running), "active" (working), "parked" (suspended, resumable), or "dismissed" (retired; the row and handle survive, so its old messages keep their attribution).',
    ),
  to_agent: z
    .string()
    // F5 — the route caps an agent REF at 64 (`schema.ts`
    // `toAgent: z.string().trim().min(1).max(64)`) and this schema published no
    // bound at all, so a long handle reached the route and came back as an
    // opaque 400 the write ops mis-narrated. `.max()` only: `.trim()` here would
    // change what is SENT (the route trims before measuring, we do not), and the
    // emptiness of a blank ref is already the route's to refuse.
    .max(64)
    .optional()
    .describe(
      `op="post" (optional): address this message to ONE named AGENT — its handle or agent id, in THIS channel. Addressing an agent is what makes it ACT. When the author is a HUMAN it also ENGAGES that agent — for roughly the next hour, or until op="disengage_agent" or a park/dismiss, it acts on that person's UNADDRESSED messages here as well, so a human tags to START an exchange rather than on every turn. A post of YOURS is agent-authored: it addresses and delivers, and it engages nothing. To address SEVERAL agents at once, use \`to_agents\` — \`to_agent\` is exactly the one-element form of it, and the two are ONE address: the cap is ${MAX_ADDRESSED_AGENTS} agents in total, \`to_agent\` included, so \`to_agent\` plus a full \`to_agents\` of ${MAX_ADDRESSED_AGENTS} is refused. Addressing a PERSON with \`to\` is the other path and it is NOT notify-only by default: with \`as_agent\` set it notifies them and starts no agent, without \`as_agent\` it triggers that member's listener and can start theirs. The FIRST addressed agent's OWNER is the machine this reaches, so setting both \`to\` and \`to_agent\` addresses the agent's owner, not the member in \`to\`.`,
    ),
  to_agents: z
    // F5 — the PER-ITEM cap the route has always applied
    // (`items .trim().min(1).max(64)`) and this schema never published, so a
    // single over-long handle in an otherwise valid list failed the whole
    // all-or-nothing post with an opaque 400. Same `.max()`-only discipline as
    // `to_agent` above.
    .array(z.string().max(64))
    // `.min(1)` MIRRORS THE ROUTE, which has always required it: an EMPTY array
    // is a 400 there, not a synonym for absence. This schema had no minimum, so
    // `to_agents: []` passed the tool, reached a route that folds the field away
    // when it is absent from the merge, and posted a successfully UNADDRESSED
    // message — with a "NOT ADDRESSED" note under it that the caller reads as
    // its own forgotten `to`. Refused here instead, before anything is sent.
    .min(1)
    .max(MAX_ADDRESSED_AGENTS)
    .optional()
    .describe(
      `op="post" (optional): address this message to SEVERAL named AGENTS at once — handles and/or agent ids, all of THIS channel. This is how two agents are told to work together ("@quartz @onyx work on X"): each one is addressed and each one acts, on the same terms a single \`to_agent\` gets (including engagement, when the author is a human). THE CAP IS ${MAX_ADDRESSED_AGENTS} IN TOTAL, \`to_agent\` INCLUDED — the server merges and dedupes the two fields and applies the limit to the result, so ${MAX_ADDRESSED_AGENTS} here PLUS a \`to_agent\` is ${MAX_ADDRESSED_AGENTS + 1} and is refused. It is ALL OR NOTHING — a ref that names no agent of this channel fails the whole post, so nothing is ever half-delivered. Duplicates collapse and ORDER MATTERS in one respect: the FIRST agent's owner is the member stamped as the post's human addressee. An EMPTY list is refused rather than treated as "no agents": leave the field off instead. If the work needs a thread, only ONE of the addressed agents opens it — see op="create_thread" and \`client_msg_id\`.`,
    ),
  intent: z
    .enum(["chat", "request"])
    .optional()
    .describe(
      'op="post" (optional, default "request"): what this message IS. "request" is the working message and is today\'s behaviour unchanged — it may address people and agents, and in a DIRECT (1:1) channel the server addresses it to the other member for you. "chat" is PEOPLE TALKING: it addresses nobody, starts nobody, and the direct-channel auto-address is skipped entirely, so two humans can talk in a DM without each line poking the other side\'s machine. "chat" together with `to`, `to_agent` or `to_agents` is a contradiction and is REFUSED (nothing is sent) rather than resolved one way — drop the address, or post as a "request".',
    ),
  as_agent: z
    .string()
    .optional()
    .describe(
      'op="post" ONLY (optional; passing it to op="create_thread" is REFUSED, not dropped — the opening request is the human\'s): post AS one of YOUR OWN agents, by handle or id. It does THREE things. (1) It is REQUIRED for a post to be attributed to an agent at all; without it the message is simply its human author\'s. (2) With `to`=<a person> it makes the post a NOTIFICATION to them instead of a request that triggers their agent — that difference is `as_agent` alone. (3) It is REQUIRED to post into a BREAKOUT THREAD (`thread=<id>`) that admits you through one of YOUR AGENTS: the server checks the thread\'s participant set against the agent you CLAIM, not the ones you own, so the post is refused (403) without it. Identity is SERVER-VERIFIED: naming an agent you do not own is refused (403), never silently ignored. It supplements the human author, it never replaces one. What it does NOT do is engage anybody: an agent-authored message engages no agent and starts no agent when it is unaddressed, at any member count — that is the loop brake, and every post you make is agent-authored.',
    ),
  participants: z
    .array(z.string())
    .max(20)
    .optional()
    .describe(
      'op="create_thread" (optional): the EXTRA identities admitted to the thread, which turns it into a BREAKOUT ROOM — each one "agent:<handle or agent id>" or "user:<email or user id>" (the prefix is required; a bare id cannot say which kind it is). EVERY entry must ALREADY belong to this channel: a person as a MEMBER (op="members"), an agent as an agent OF THIS CHANNEL (op="agents") — a workspace colleague who is not in the channel is rejected, so invite them (op="invite") first. You and the member in `to` are added by the server, so list only the others. Once a thread has a participant set, that set is who may post into it — and an AGENT in the set must name itself with `as_agent` on every post, or the server refuses it. Agents in it still act only when ADDRESSED.',
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
      'op="post" / op="create_thread" (required): the message text, <=16000 characters. For a task_* kind, put a human-readable one-liner here and the structured payload in metadata. For create_thread, this is the requester\'s initial request.',
    ),
  to: z
    .string()
    .optional()
    .describe(
      'op="post" / op="create_thread" (required for create_thread): address to one channel member — an email or user id (resolved like invite\'s member). For post, WHAT IT DOES DEPENDS ON `as_agent`: with `as_agent` the member is notified and no agent of theirs starts; without it the post is a request that triggers that member\'s listener and can start their agent. Omit it for talk nobody must act on — and say so outright with `intent`="chat", which addresses nobody even in a direct channel. To reach a named AGENT rather than a person, use `to_agent` / `to_agents`. For create_thread, it is the member the thread is for.',
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
      'op="post": a short one-line intent (<=200 chars — the post route enforces 200, not 2000). ALWAYS set it — it becomes the notification the receiving member sees. op="close_thread" (optional): a one-line outcome summary (<=2000 chars) shown on the thread card and carried in the close echo.',
    ),
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
      'op="post": message kind — "message" (default, chat) or a structured activity event ("task_started" / "task_progress" / "task_finished" / "task_failed"; these keep the older `task_` storage names).',
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
      'op="post" / op="create_thread": optional idempotency key — re-sending the same op with the same id won\'t create a duplicate (a repeat create_thread returns the already-created thread instead of opening a second). THE HANDSHAKE FORM, and it is not optional when several agents were addressed together and one of you opens a thread for the shared work: derive it from the message that asked, as "thread-open-<channelId>-<seq>". `<channelId>` IS THE CHANNEL\'S UUID, NEVER ITS SLUG — the server anchors the key on the id, and a key built from the slug parses as no handshake at all, which opens the thread with no participant set and 403s the other addressed agent out of the room it was told to join. `op="list"` and `op="agents"` both render the id ("id: `...`"); if you were called with a slug, that is where the uuid comes from. `<seq>` is the seq of the TRIGGERING message, as shown on its line in "read" / "await" ("**#42**" means seq 42). Two agents that race to open the same thread then send the SAME id, and the server collapses them into ONE thread instead of two rooms for one job. On op="create_thread" this tool NORMALIZES a "thread-open-" key onto the channel it just resolved and tells you it did, so passing the slug form still works — but the id form is the one to send, and a "thread-open-" key with no `<seq>` is refused rather than repaired.',
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
  thread: z
    .string()
    .optional()
    .describe(
      'op="get_thread" / op="close_thread" / op="set_thread_mode" / op="join_thread" / op="leave_thread" (required): the thread id (returned by create_thread). op="post" (optional): thread this post under that thread — logs a milestone when combined with kind="task_progress". op="read" (optional): filter the transcript to that one exchange — only messages tagged with this thread id come back. It FILTERS, so an id no message carries returns nothing rather than an error, and `await` has no counterpart (it is always channel-wide).',
    ),
  outcome: z
    .enum(["completed", "failed"])
    .optional()
    .describe('op="close_thread" (required): how the thread ended.'),
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
