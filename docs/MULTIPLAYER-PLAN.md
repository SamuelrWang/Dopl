# Multiplayer AI — implementation plan (2026-07-31)

> **⛔ STATUS 2026-08-05: THE MODEL IN THIS FILE IS DELETED, NOT "SUPERSEDED IN PART".**
>
> The channels rollback (`docs/CHANNELS-ROLLBACK-PLAN.md` §1, F-141) removed the entire surface this plan built: named agents, `@handle` addressing, `to_agent` / `to_agents` / `as_agent`, summoning, engagement, breakout-room participant sets, the two-agent thread-open handshake, and THE LAW. The seven MCP ops are dropped from the enum; the four removed params are declared `z.never()`; eight desktop modules are deleted. **The whole addressing surface is `toUserId` plus `intent`.**
>
> **THE MIGRATIONS WERE NOT REVERTED.** `channel_agents` and `channel_task_participants` keep every row and every `engaged_at` / `engaged_by` value; nothing writes any of them. The three agent metadata keys stay in the reserved STRIP list with no writer left, which is load-bearing rather than tidy — `author_agent_id` on a STORED row is what the web transcript reads to render historical attribution, so a caller able to set it on a NEW post could attribute their own words to somebody's retired agent.
>
> **Read ENGINEERING §8 / §18 "PHASE 2 OF THE ROLLBACK" and F-141 for what is true.** Everything below — including the "SUPERSEDED IN PART" note, which was about a same-day rework and not about this — is history. (Banner added 2026-08-05, F-146: the file previously never said the model was deleted, so a reader who got past the first paragraph found a live-sounding contract.)

> **STATUS: SHIPPED AND COMMITTED, THEN SUPERSEDED IN PART — 2026-07-31.** Waves 1–4 landed on
> `75faf31`, were committed as `4e1252d` (F-110), and the desktop was bumped to **1.7.17**
> (`7940d97`). Three adversarial reviews found four blockers; three fix passes closed them.
> **A LATER SAME-DAY REWORK (F-111) CHANGED THE MODEL THIS FILE DESCRIBES** — see
> "THE MODEL THIS CONTRACT GOT WRONG" immediately below, and read it BEFORE anything else here.
> Green after that rework (uncommitted on top of `7940d97`): root vitest **1880** (111 files),
> `packages/mcp-server` **413** (31), `packages/dopl-client` **48** (3), desktop **1722**.
> `tsc --noEmit` clean, `npx eslint src packages` 0 errors (1 baseline warning, `proxy.ts`),
> `dopl-desktop-app` `npx eslint .` clean, `dist/` rebuilt for both packages.
> **All four migrations are APPLIED LIVE to prod** — local `20260731120000` / `20260731130000`
> (remote-stamped `20260731224658 channel_agents` / `20260731224726 channel_task_participants`),
> plus F-111's `20260731140000_channel_agent_engagement` and
> `20260731150000_drop_channel_agents_engaged_idx` (the second drops an index the first created —
> it was added on a query nobody wrote; see the file's own header).
> The durable record is ENGINEERING.md §8 (the MULTIPLAYER subsection) and §18; the blockers and
> everything still open are **F-110 and F-111** in REFACTOR-FINDINGS.md. **This file is now history
> plus the drift corrections below — read the §8/§18/F-110/F-111 set for what is true, not this
> contract.**

## THE MODEL THIS CONTRACT GOT WRONG (F-111, 2026-07-31)

The vision paragraph below says agents and humans interact through ONE law: **nothing acts unless
addressed**. That shipped, was used, and did not survive contact with the operator's own flow. Two
things were wrong with it, and both are now changed in code:

- **ADDRESSING IS NOT A PER-MESSAGE VERB, IT IS A LATCH.** Tagging an agent **ENGAGES** it. While
  engaged (`channel_agents.engaged_at`, ~60 min, refreshed by acting) that agent ALSO acts on the
  engager's — and its own owner's — UNTAGGED, non-`chat` messages in that channel. A human tags to
  START an exchange, not on every turn. The shipped law is therefore "**tagging engages, and an
  engaged agent acts on that person's untagged messages**", not "nothing acts unless addressed".
  The implicit two-member trigger is still off and is NOT resurrected by this; engagement feeds an
  agent that already exists rather than handing a verdict back to `classify`.
- **THE LAW WAS ALSO FALSE INSIDE A THREAD.** THE LAW's own sentence — "inside a thread everyone in
  it hears everything: no tagging between participants" — was not implemented on the desktop, so
  two agents that opened a breakout room went deaf to each other in it. There is now a third
  routing lane (addressed → thread → engaged) whose fence is the server-side participant set.
- **A HUMAN CAN NOW TALK WITHOUT WAKING ANYTHING.** `intent: "chat"` is the composer's default and
  declares a post as reaching nobody's agent: the DM peer auto-address is skipped and an engaged
  agent refuses it. "Nothing acts unless addressed" had no way to say this, so every line two
  people typed at each other in a DM was a request.
- **`@handle` WAS DECORATIVE.** The contract's "@-mention autocomplete" shipped as text only —
  nothing resolved the tokens at send time — so the operator's core flow ("@quartz do X") did
  nothing at all. Mentions are now resolved out of the composed body against the roster and sent
  as real addresses (`toAgents`).
- **MULTI-ADDRESS IS BUILT.** §8 recorded it as "not decided, so not built". `toAgents[]` →
  `metadata.to_agent_ids[]`, capped at 8 on the deduped merge with `toAgent`, with `to_agent_id`
  kept as a compat mirror for installed desktop 1.7.17. `metadata.to_user_id` is still a single
  scalar — the owner bridge stamps the FIRST addressed agent's owner into it.
- **STILL NOT BUILT: `to_user_notify`.** The drift correction under "Schema (wave 1)" below is
  unchanged and still current, including the warning that it is not in the reserved-key strip list.

The product decision record is the conversation of 2026-07-31; this file is the build contract.
Vision: a channel/DM is a MEETING ROOM where humans talk. Either human summons their own
agents (`/new-agent`) — each agent is a first-class named entity (mineral/star handle) running
on its owner's machine. Agents and humans interact through ONE law: **nothing acts unless
addressed** (@handle for agents = act; @human = notify, never spawn). **← SUPERSEDED by F-111;
read the section above.** Work moves into
BREAKOUT ROOMS — which are THREADS with a participant set, not sub-channels — where member
agents listen and work; the main room stays human chat plus @-summons. Two session modes,
one engine: ASSIST (today's pair-bound, windowed, per-request consent — unchanged) and TEAM
(room-bound, summoned by own operator, window-on-demand).

## Locked decisions (operator, 2026-07-31)
- Breakout room = thread + participants (NOT sub-channels; one channel-wide listener/cursor).
- @-addressing is the universal act verb; implicit 2-member trigger DISABLED while the
  channel has active team agents. **AMENDED by F-111: still the act verb, but it now LATCHES
  (engagement) rather than applying to one message, and inside a thread the participant set
  replaces it entirely. The implicit 2-member trigger stays disabled — that half is unchanged.**
- Agents may @-summon humans (notification path, escalation).
- N agents per channel, multiple per user; auto-named from a curated mineral/star pool,
  handle charset `^[a-z][a-z0-9-]{1,30}$`, unique per channel, owner-renameable.
- Peer agent visibility = coarse activity (status/progress), never session internals.
- Channel-transparent reads stay (breakouts separate attention, not visibility).

## Judgment calls made in the operator's absence (flagged, reversible)
- **Q10/P2 (legacy `task-<channel>-<seq>` ids skip the thread-write gate): middle path. — RESOLVED
  AS PLANNED, verified in code.** A caller-supplied legacy id is validated against its opening
  message's `{author, to_user_id}` pair (the machinery `isLegacyThreadParticipant` already uses for
  calm flags); a non-participant's legacy tag is SILENTLY STRIPPED (message posts untagged) rather
  than 403'd — a hard 403 would break installed desktop 1.7.16, which posts legacy ids for
  lifecycle events. This closes the forgery/misroute hole while keeping wire compat, and unblocks
  the history-fence widening.
  **Shipped shape, beyond the sketch:** `isLegacyThreadParticipant` is now the ONE resolver — the
  thread-write gate and the calm-flag stamp both key on the same decision (`calmFlags.length > 0 &&
  typeof metadata.taskId === "string"`) instead of running the check twice, so there is exactly one
  lookup per post and a fabricated outcome has nothing to attach to. It also gained fail-closed
  shape guards on the parsed seq (`< 1`, `Number.isSafeInteger`). The strip is `delete
  metadata.taskId` and it never throws. ENGINEERING §8's old text ("a legacy id skips that gate
  entirely") and its sequencing note ("close the legacy-id gate FIRST, then widen") are both
  corrected there; `session-history.pairRows` widened afterwards, and only for `bind === 'room'`.
- **Migrations are ADDITIVE-ONLY and applied live** (house precedent: channels v1.2/v1.5,
  2026-07-20 audit batch). New tables only; no existing table altered.

## Schema (wave 1)
- `channel_agents`: id uuid pk, channel_id fk, owner_user_id, name (charset CHECK, unique
  per channel case-folded), status `summoned|active|parked|dismissed`, created_at,
  renamed_at. Channels write model (service-role only), member SELECT, realtime.
- `channel_task_participants`: (task_id, participant kind `user|agent`, user_id nullable,
  agent_id nullable, added_by, created_at), unique per (task, identity). Same write model.
- Message metadata (jsonb, no DDL): reserved keys `author_agent_id`, `to_agent_id`,
  `to_user_notify` — server-stamped like every reserved key (strip caller copies, re-add
  from validated fields).
  **DRIFT CORRECTION (verified 2026-07-31): `to_user_notify` WAS RESERVED AND NOT BUILT.**
  `author_agent_id` and `to_agent_id` shipped exactly as described — stripped from caller metadata
  unconditionally in `resolvePostMetadata`, re-added from the validated `authorAgentId` / resolved
  `toAgent`. **`to_user_notify` has ZERO implementation and is NOT in the strip list**, so a caller
  can set it today and it persists verbatim. Harmless only while nothing reads it — **whoever
  builds the consumer must add the strip in the SAME change, or the key is spoofable on day one.**
  It is the missing piece behind the desktop's `!isDirect` narrowing on agent→human escalation
  (ENGINEERING §18): in a DM the server stamps the same `to_user_id` for an explicit `to` and for
  the auto-address, so the wire cannot tell a deliberate escalation from an ordinary peer reply.
  **That key is the real fix; the `!isDirect` conjunct is a workaround holding its place.**

## Waves — ALL FOUR SHIPPED (2026-07-31); divergences noted per wave
1. **M** migrations + repo/dto (channel_agents, participants) · **Q** legacy-gate close ·
   **D1** desktop session pool (key `channel:agent`, drop per-channel serialization, cap +
   park per agent).
2. **S** server services/routes: agents CRUD + name pool + rename; thread participants
   (create_thread `participants`, join/leave); addressing resolution (@handle→agent_id,
   to_agent stamping; human-notify addressing); participant-aware thread-write gate
   (supersedes pair gate when participants exist) · **W** web UI: composer `/new-agent` +
   @-mention autocomplete, agent chips bar (presence + status), rooms sidebar (thread panel
   promoted), agent-authored message attribution (name chip).
3. **MCP** dopl_channel: `agents` (list) / `rename_agent` / `join_thread` / `leave_thread`,
   `create_thread participants=`, `post to_agent=`, THE LAW in CHANNEL_DESCRIPTION + room
   locus line in results · **D2** desktop: spawn on own `/new-agent` row (realtime), team
   session binding = participant set, summon routing (@agent → that agent's live session;
   main-room summon answered in main), implicit-trigger-off while team agents active,
   @human escalation notification.
4. **Review wave**: per-lane adversarial code review (correctness, dead code, §2, slop),
   dead-code sweep, full suites (root + mcp-server + desktop), docs (§8/§18 + findings),
   commit.

### What the waves actually delivered vs. what this contract said

- **Wave 1 — as planned.** Both tables, both applied live. `channel_task_participants` gained a
  second guard function (`channel_task_child_workspace_guard`) the contract did not anticipate: the
  v1 guard resolves its parent through `NEW.channel_id`, and this table's parent is a THREAD.
- **Wave 2 — as planned, plus the CURATION RULE the contract did not specify.** The contract said
  "thread participants (create_thread `participants`, join/leave)" and said nothing about WHO may
  change a set. Gating join on bare channel membership was **review blocker 1**: any member of a
  private channel `{A,B,C}` could write themselves into A↔B's thread and, from there, post a
  `task_failed` carrying the calm-terminal flags — forging an outcome on both cards, through the
  front door the reserved-key strip and the legacy-id gate exist to block. The shipped rule is in
  ENGINEERING §8. Note two product calls inside it that are NOT in this contract: **agent owners
  are not curators**, and **add/eject are asymmetric** (an existing user participant may add;
  ejecting a third party is creator/target only).
- **Wave 3 — MCP ops came out SIX, not four.** The contract listed `agents` / `rename_agent` /
  `join_thread` / `leave_thread`; shipped adds `summon_agent` and `set_agent_status`. `create_thread
  participants=` takes prefixed strings (`"agent:x"` / `"user:y"`) resolved **against the CHANNEL
  roster**, and `as_agent` is **REFUSED** on `create_thread` (an agent-attributed opening message
  classifies as notify-only escalation and would never wake the responder). The "room locus line in
  results" shipped as a per-call `· as <handle>` suffix on the `_dopl_status` `caller:` line.
- **Wave 3 (W, web) — shipped**, though the contract filed it under wave 2: `agent-chips-bar.tsx`,
  `mention-popup.tsx` + `lib/mention.ts`, `lib/composer-commands.ts` (`/new-agent`),
  `rooms-sidebar.tsx` + `lib/rooms.ts`, `threads-button.tsx`, `use-channel-agents.ts`,
  `lib/agent-display.ts`.
- **Wave 4 — the review found four blockers, all fixed, all with residuals.** They are **F-110** in
  REFACTOR-FINDINGS.md. Two are worth restating here because they contradict this contract's
  optimism: THE LAW as first written **promised something false** ("addressing a human never spawns
  their agent" — true only with `as_agent`, which is optional and off by default) and contradicted
  itself two paragraphs later; and `create_thread` with a workspace-but-not-channel participant
  **orphaned a live thread** while reporting "No thread was opened".

## Deliberately NOT in this build (v1.1+)
- Dedicated ticker lane (v1 status = presence + task_progress already rendered), panel
  embed (session window stays a window; chip-click opens it), cost meter, Slack viewport
  bridge, desktop RELEASE (code lands; 1.7.17 notarize needs operator creds), autonomous
  agent↔agent standing grants UI (grants stay per existing consent surfaces this round).

**BUILT SINCE, by F-111 (2026-07-31):** multi-address (`toAgents`, cap 8 on the merged set),
real `@handle` resolution in the composer, chat-vs-request intent, engagement, the desktop
THREAD LANE, and the server-derived two-agent thread handshake. **Still not in:** the ticker
lane, the panel embed, the cost meter, the Slack bridge, the standing-grants UI, and
`to_user_notify`. `dopl-desktop-app/package.json` IS now bumped to **1.7.17** (`7940d97`) —
the version is cut; the **notarized release still is not**.

## Testing when operator returns
Live two-machine smoke: summon two agents each side, breakout, cross-summons, escalation.

**Still the gating item** — the version is bumped (1.7.17) but no notarize run has happened, so
the two-machine smoke cannot run until the operator's release creds are available. Watch these
during it. From **F-110**: a summoned team shell silently evicted by the window budget while its
server row still reads `active`; a dismissed agent whose local session is never torn down; and the
channel-keyed permission arm, where the first of N agents in a room consumes an arm meant for
another. From **F-111**, the new ones and the reason the smoke matters more than it did: two agents
in one thread with **both** message axes on auto have no SHORT bound — they ping-pong until a turn,
cost or idle cap stops them — so run the first cross-machine thread on the default manual/ask
posture and count the Accepts before touching the posture at all.
