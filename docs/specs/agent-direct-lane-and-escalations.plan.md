# AGENT DIRECT LANE + STRUCTURED ESCALATIONS — Implementation Plan

**Repo:** Dopl · branch `master` · HEAD `6b3b1ead` · desktop `1.22.0` · verified against the tree 2026-08-31.
**Status:** ⚠ **BOTH FEATURES ARE BUILT (2026-08-31), green on the full §14 table.** Read the
SHIPPED surface out of the tree, never out of this file.

- ✅ **Feature 2 — structured escalation cards.** The op, the two reserved metadata keys and their
  folds, the answerer fence (403), the one-answer-at-rest index, the SDK types, both row pipelines,
  the answer write, the desktop OUTBOUND lane for `escalate`, and the escalation-answer wake door.
- ✅ **Feature 1 — the private direct lane, M1–M4 plus its consent.** `channel_agent_directions`
  (migration WRITTEN, not applied), the repository/service/five routes, the SDK types and three
  methods, `dopl_channel(op="direct_agent" | "read_directions")`, the desktop watcher + wire, the
  `frameDirectedTurn` ruling, the reply capture, the second operator toggle and its IPC/bridge
  pair. **M5's SPA face for the `directed` narration lane is NOT built** — both kinds fall through
  `frameLane`'s `note` fallback and render as plain text, which drops nothing; F-366 carries it.
- ⚠ **THE ADVERSARIAL REVIEW AT M4 FOUND THREE REAL DEFECTS, TWO OF THEM OLDER THAN THIS FEATURE,
  AND ALL THREE ARE FIXED:** the zero-width fence forgery (F-370), the private window wiped by the
  wake it triggered (F-372, which the operator's own composer had had since 2026-08-22), and the
  session registry outliving a sign-out with no owner stamp (F-373). F-371, F-374 and F-375 record
  a corrected argument, an accepted unbounded lane, and one inherited defect left to a shared fix.
- ⚠ **§1.7's `read_directions` IS BUILT AS SPECIFIED BUT THE OP COUNT MOVED**: `dopl_channel`
  publishes **18**, not 17 — this document was written before `escalate` landed. Re-derive.

**Precedent build:** `docs/specs/home-knowledge-panels.plan.md` (M0–M7 shape, the audience-ceiling
argument, the adversarial-pin culture) and `docs/specs/mcp-surface-v2.plan.md` (the "corrections to the
brief" discipline, the ruling-per-question shape).
**Depends on / touches:** F-320 / F-321 (a surfaceless session's gate cannot become a pending operator
decision for anything but an own-channel post or thread open — Feature 1 does NOT reopen it), F-315 (an
unbounded agent CONVERSATION — Feature 1 is bounded by construction instead, §1.10), F-329 (B1 is a
strong tripwire, not a fence — neither feature closes it and neither pretends to), F-341 (the live-agent
strip reaches the warned-about posture combination unwarned — untouched).

Samuel's ruling (2026-08-31): (1) an external MCP session — the operator's own other agent — must be able
to DIRECT a specific agent session PRIVATELY, because today direction only works through noisy main-room
posts; fenced to the operator's OWN sessions, audience ceilings intact, loop brake intact. (2) agents must
escalate questions as STRUCTURE rather than prose walls — issue, bounded context, 2–6 options each with a
one-line consequence, and a recommendation — rendered as a CARD with OPTION BUTTONS, the click routed back
to the asking agent as its answer, with a notification ping to the operator on card creation.

---

## 0. Corrections to the brief (measured, not assumed)

Five things the brief assumes are not what the tree does. **Three of them change the design.**

1. 🔒 **"MCP READS THE PANEL" IS THE WRONG SHAPE, AND THE BRIEF ALREADY SUSPECTED IT — HERE IS THE
   MEASUREMENT.** The private panel is not a server projection with a client on it. It is
   `src/features/channels/components/channels-v2/agent-stream.tsx › AgentStream` merging **two** sources
   in `› agent-stream-model.ts › buildAgentStream`: the **narration ring** (machine-local IPC —
   `dopl-desktop-app/main/session-narration.js › flush` is `webContents.send` on channel
   `'dopl:session-narration'`, and NOTHING in `main/session-state-push.js` or `main/api.js` names
   narration) and **server message rows** the transcript already holds. Its only persistence is
   `main/agent-history.js`, an `electron-store` key on local disk with a 7-day `RETENTION_MS`.
   **There is nothing on the server for MCP to read.** Any op that "reads the panel" would first have to
   invent a server-side narration feed — which is a per-SDK-event writer, the one thing
   `session-state-push.js` forbids in capitals, and a wholesale export of the operator's private lane.
   **The design is therefore a WRITE with a bounded reply, never a read.**

2. 🔒 **THE PRIVATE LANE IS ALREADY OPERATOR-ONLY BY CONSTRUCTION, AND THAT CONSTRUCTION IS WHAT WE MUST
   NOT WEAKEN.** `sessions:message` → `main/session-reopen.js › messageByTask` resolves the target
   `(channel, thread, agent)` **against main's own registry** — INVARIANTS §11: *"which is what makes it
   own-agents-only structurally rather than by a check"*. A peer cannot reach it because there is no
   field in which to name somebody else's machine. **Feature 1 must preserve that property, not add a
   check that reproduces it** — hence the mailbox table whose `operator_user_id` is stamped from
   `ctx.userId` and is not a request field, exactly as `channel_launch_directives` does.

3. 🔴 **AN MCP DIRECTION MAY NOT BE FRAMED AS THE OPERATOR SPEAKING. THIS IS THE SHARPEST RULING IN THE
   FEATURE.** `main/session-seed.js › frameOperatorTurn` carries OPERATOR authority and is *"deliberately
   NOT fenced as data, because the operator is the one voice the framing tells a session to weigh"*
   (INVARIANTS §11). A direction filed over MCP is **text another agent wrote**, running under the same
   credential. The precedent is one paragraph away and points the other way: a launch `goal` *"rides
   `spec.firstMessage → session-seed.js › takeFraming` as the wake turn's **fenced** request body — it is
   text another agent wrote, so it is a BODY, never the trusted preamble."* **A direction is a fenced
   body with its own preamble** (§1.4). Reusing `frameOperatorTurn` would let any process holding the
   device token impersonate the operator inside their own agent's private turn — the highest-authority
   voice in the system, granted to the lane with the weakest human in it.

4. **THE ESCALATION CARD MUST NOT BE A NEW `kind`, AND THE PRECEDENT SAYS SO TWICE.** `channel_messages.kind`
   is a **column CHECK** (`supabase/migrations/20260725120000_channels.sql`) over six values, mirrored in
   four places (`src/features/channels/types.ts › ChannelMessageKind`,
   `packages/dopl-client/src/channel-types.ts`, `src/features/channels/schema.ts ›
   PostableMessageKindSchema`, `packages/mcp-server/src/tools/channel-schema.ts`). More decisive:
   `dopl-desktop-app/main/targeting.js › classify` returns `ignore` for **any `m.kind !== 'message'`**, so
   a card on a new or a `task_*` kind renders in the transcript and **can never notify anybody** — which
   deletes half of Feature 2's requirement. And the transcript's own precedent is not kind-keyed either:
   `view-model-rows.ts › channelRows` decides a **thread card** on `view-model.ts › threadIdOf`, i.e. a
   `metadata` key resolving against fetched data. **The card is `kind='message'` + reserved metadata**
   (§2.1).

5. ⚠ **"RENDER IN CHANNEL + THREAD + AGENT STREAM" IS TWO IMPLEMENTATIONS, NOT THREE AND NOT ONE.**
   `channelRows` and `threadRows` share `view-model-rows.ts` and `transcript.tsx`, so channel and thread
   are one. The agent stream is a **separate pipeline** — its own union (`agent-stream-model.ts ›
   StreamLane`), its own builder (`buildAgentStream` + `groupStreamItems`), its own dispatch
   (`agent-stream.tsx › StreamRow`), and **no `AuthoredRow`**. Budget the card twice. The good news is
   that `buildAgentStream` already takes `sent: readonly ChannelMessage[]`, so the data is in hand.

Measurements taken 2026-08-31, re-derive rather than quoting: `dopl_channel` publishes **15** ops
(`CHANNEL_INPUT_SHAPE.op`'s options — INVARIANTS §10 says 14 @ 2026-08-22, before `update` landed);
`supabase/migrations/` holds **190** files, newest `20260901120000_agent_template_home_scoped.sql`;
`src/features/channels/components/channels-v2/` holds **141** entries.

---

## 1. FEATURE 1 — THE AGENT DIRECT LANE

### 1.1 The shape, in one sentence

**An external MCP session files a DIRECTION in a server mailbox; the operator's own desktop claims it,
delivers it into the named agent's existing private-turn machinery as FENCED DATA, and writes that turn's
final text back onto the row as the reply.** Nothing else about the private lane changes, and nothing
else in it ever leaves the machine.

### 1.2 The wire — a new table, not an extension of the launch mailbox

**New file** `supabase/migrations/20260902120000_channel_agent_directions.sql`. Template:
`supabase/migrations/20260822160000_channel_launch_directives.sql` — the only recent migration that does
every part of §12 (new table, guard trigger, FK-covering indexes, a replica-identity index, the
idempotent publication `DO $$`, RLS enable, REVOKE, exactly one SELECT policy, and a closing `DO $$` that
RAISEs rather than trusting the outcome).

```sql
CREATE TABLE IF NOT EXISTS public.channel_agent_directions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id)     ON DELETE CASCADE,
  channel_id       UUID NOT NULL REFERENCES public.channels(id)       ON DELETE CASCADE,
  task_id          UUID          REFERENCES public.channel_tasks(id)  ON DELETE SET NULL,
  -- ⚠ WHOSE MACHINE. Always ctx.userId; there is no request field for it and there must never be.
  operator_user_id UUID NOT NULL REFERENCES auth.users(id)            ON DELETE CASCADE,
  -- WHICH agent. Required here where a launch has none: a direction with no addressee is a
  -- broadcast into somebody's private lane, and "broadcast" is not a shape this product has (§5).
  agent_id         TEXT NOT NULL CHECK (agent_id ~ '^[a-z][a-z0-9]{7}$'),
  body             TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','claimed','delivered','refused','expired')),
  refusal_reason   TEXT CHECK (refusal_reason IS NULL OR refusal_reason IN
                     ('no-session','no-bridge','busy','auth-hold','blocked')),
  reply            TEXT CHECK (reply IS NULL OR char_length(reply) <= 8000),
  claimed_at       TIMESTAMPTZ,
  decided_at       TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- **`body` is capped at 4000 to match `renderer/app-preload.js`'s `.slice(0, 4000)` and main's
  `MESSAGE_CAP`.** A cap here that exceeded the IPC one would silently truncate at the far end and
  narrate success — the class `channel-errors.ts › FIELD_CAPS_NOTE` exists for.
- **Terminal-shape CHECK, `channel_launch_directives_terminal_shape`'s twin:** `refused` ⇒ a reason;
  `delivered` ⇒ `decided_at`; `delivered`/`refused` ⇒ `decided_at`. ⚠ **`delivered` does NOT require a
  `reply`** — a turn whose final text was empty, or a machine on an older build that delivers without
  reporting, are both honest `delivered`s. `reply IS NULL` means "not reported", never "the agent said
  nothing"; the MCP renderer says so.
- **Refusal vocabulary is a CLOSED FIVE, and the WORD crosses the wire while the SENTENCE is written in
  `packages/mcp-server`** — `channel-ops-launch.ts › REFUSAL_SENTENCES`' rule verbatim: prose on the wire
  needs a desktop release to reword, and desktop-authored text rendered into an MCP result is text
  nobody neutralized. The five map to real `messageByTask` outcomes (measured): `no-session`,
  `no-bridge` (the local toggle, §1.6 — and also main's own `no-bridge`), `busy`, `auth-hold`, `blocked`
  (`version-gate.isBlocked()`). ⚠ **`empty` is NOT on the wire**: an empty body cannot reach the mailbox
  because the column CHECK refuses it.
- **Indexes, one per named statement, FK cascades counted:** `_operator_pending_idx (operator_user_id,
  status, created_at DESC)` (the desktop's poll/recovery read + the `auth.users` FK cover),
  `_channel_idx (channel_id)`, `_task_idx (task_id)` (the lint `20260802180000` keeps at zero — without
  it a thread delete scans the table to null out its directions), and
  `_replica_identity_idx UNIQUE (workspace_id, id)`.
- **Trigger** `channel_child_workspace_guard()`, reused, like every channel child.
- **Realtime: INSERT and UPDATE, same argument as the launch mailbox** — several of one operator's
  machines may be signed in, and the losers of the claim CAS must SEE the row leave `pending` rather
  than spend a round trip discovering they lost. `REPLICA IDENTITY USING INDEX` on the unique
  `(workspace_id, id)`, per `20260822130000_channel_messages_delete_doorbell.sql`, or the subscribers'
  `workspace_id=eq.<id>` filter drops every UPDATE frame. **No DELETE path ⇒ no DELETE doorbell.**
  ⚠ It goes in the PUBLICATION and **not** in `main/ui-sync-core.js › SYNC_TABLES` — the web has no
  direction surface, and its one subscriber is `main/agent-directions.js` on its own binding. The two
  counts in INVARIANTS §7 are about different things and both move: publication 18 → 19, `SYNC_TABLES`
  unchanged at 17.
- **Lazy expiry, no cron** — `expires_at` enforced at READ time in the service, exactly as
  `service-launch.ts › toDirective` does. The stored `status` may legitimately disagree with the
  reported one; the claim CAS (`WHERE status='pending'`) is what makes that safe.
- **RLS: one SELECT policy, owner-only** (`is_current_workspace_member(workspace_id,'viewer') AND
  operator_user_id = (SELECT auth.uid())`), writes REVOKEd from `authenticated`/`anon`, closing `DO $$`
  RAISEing on any non-SELECT policy or an `authenticated` UPDATE grant. **The `reply` column is the
  reason this policy matters more here than there:** it carries the private turn's answer, and a
  member-scoped read would put one operator's private lane in front of their counterparty.

⚠ **WHY NOT EXTEND `channel_launch_directives`.** One mailbox is tempting and wrong on three counts: its
`terminal_shape` CHECK asserts `launched ⇒ agent_id`, its refusal vocabulary is a different closed set
answering a different question, and a `reply` column on a launch row is a column that can only ever be
null. A kind-discriminated mailbox would make every constraint conditional on the kind — which is the
shape that lets a future edit relax one lane's guard for the other's benefit.

⚠ **WHY IT IS NOT A `channel_messages` ROW.** Both of `20260822160000`'s reasons hold unchanged and a
third is stronger here. **(1) The loop brake:** an agent-authored message addressed to a member triggers
that member's listener; a direction's whole purpose is to reach an agent. **(2) Transcript purity:** the
counterparty would read every steer one operator aimed at their own agent. **(3) THE LANE IS PRIVATE BY
DEFINITION** — putting it in the shared transcript is not a design trade, it is the feature's negation.
⚠ Consequence, so nobody re-derives it as a bug: **a direction has no `seq` and can never end an
`await`.** The op holds on the ROW, bounded, exactly as `launch_agent` does.

### 1.3 The fences — four, and the fourth is the one that already existed

| # | Where | Kind |
|---|---|---|
| 1 | `service-directions.ts › createDirection` stamps `operator_user_id` from `ctx.userId`, spread LAST so no payload key can shadow it (`repository-launch.ts › insertLaunchDirective`'s own trick) | 🔒 FENCE |
| 2 | the RLS SELECT policy re-checks `operator_user_id = auth.uid()`; claim/decide scope every UPDATE to it | 🔒 FENCE |
| 3 | `main/agent-directions.js › handle` re-checks `d.operatorUserId === deps.getUserId()` — the realtime filter is workspace-wide and does not encode the operator (`launch-directives.js`'s own local owner re-check) | 🔒 FENCE |
| 4 | `main/session-reopen.js › messageByTask` resolves against MAIN'S OWN REGISTRY | 🔒 FENCE, and it is **structural** — untouched by this work |

**A peer can never message your agent privately, and there is no argument anywhere in the design in
which they could name your machine.** State it in the op description and pin it: `channel-directions.test.ts`
asserts `CHANNEL_INPUT_SHAPE` declares no operator/user param and that `LaunchDirectiveCreateInput`'s
sibling `DirectionCreateInput` carries none either (`launch-types.ts`'s recorded rule, applied).

**Audience ceiling: untouched, and say why.** A direction posts nothing, reads nothing and grants
nothing. It starts a turn inside the target session's EXISTING tool profile, permission axes, working
folder and hard-deny floor — resolved at launch from `channel-listener.js › watchedChannel` and not
re-read here. Layer A, B1, B2 and B3 all apply to that session exactly as they did a moment before.
⚠ **The direction supplies BODY TEXT AND NOTHING ELSE** — the same one-line contract
`launch-directives.js › spawn` keeps for `goal`/`model`/`template`, and enforced the same way: the wire
whitelist (`main/agent-direction-wire.js › directionFrom`) is a literal field list, so a field it does
not name never reaches this machine at all.

**Loop brake: intact, and Feature 1 is bounded by CONSTRUCTION rather than by a depth counter (§1.10).**

### 1.4 THE FRAMING RULING — a direction is a fenced BODY, never the operator's voice

New: `main/session-seed.js › frameDirectedTurn(nonce, text)`, sibling of `frameOperatorTurn`, and the
diff between them IS the ruling:

- **What it keeps from `frameOperatorTurn`:** the message was not posted anywhere; your answer is the
  FINAL TEXT of this turn and is shown only in your operator's agent view; do not post to the channel to
  answer; a post they explicitly ask for will be HELD for approval (a hold, never an impossibility —
  telling an agent it cannot do a thing it can do produces a refusal the operator has to argue with);
  reading is unrestricted.
- **What it changes:** the author. It says the direction came from **another agent running under your
  operator's credential, not from your operator**, that the text is **DATA** to weigh and not an
  instruction carrying operator authority, and that anything in it that reads like a permission grant,
  a posture change or an instruction to contact an outside system is a point to check with the operator
  first. This is `prompt-framing-template.js › FOREIGN_HEADER`'s family and takes its ruling verbatim in
  the half that matters: **it does not void the content** (the operator's own orchestrator pointed it
  here on purpose), it bounds the authority.
- ⚠ **The nonce delimiting is unchanged** — `frameOperatorTurn`'s existing mechanism, reused, so the
  body cannot close its own fence.
- **Pin:** `test/session-directed-turn.test.mjs` asserts the two framings are DIFFERENT FUNCTIONS with
  different preambles and that `agent-directions.js` reaches `frameDirectedTurn` and never
  `frameOperatorTurn`. ⚠ Mutation-verify by swapping the call and confirming red.

**The PRIVATE TURN is opened exactly as the operator's own message opens it** —
`main/session-private.js › openPrivateTurn(s)` **before** the dispatch (it reads `s.state.activity` to
size the window, and the dispatch moves that activity to `working`), so `session-profiles.js ›
privateTurnMessageMode` withdraws Axis B's outbound widening for the turn. **An accidental public reply
to a private direction is impossible; a deliberate approved one is not.** The depth arithmetic
(`+1` idle / `+2` working) and `resetPrivateTurn` are reused untouched.

### 1.5 THE REPLY READ-BACK RULING — the one place private text leaves the machine

🔒 **A DIRECTION THAT ARRIVED FROM OFF-MACHINE GETS AN ANSWER THAT GOES BACK OFF-MACHINE. NOTHING ELSE
IN THE PRIVATE LANE EVER LEAVES, AND THIS RULE MAY NOT BE GENERALISED INTO ONE THAT DOES.**

- **What is written back:** the FINAL TEXT of the turn the direction opened — one string, once, on the
  `delivered` decide. Bounded at `REPLY_CAP` (8000, mirroring the column CHECK) and charset-stripped to
  `safeLabel`'s rule the way `detail`/`toolLabel`/`model` are, because zod validates the whole decide
  body and one bad character 400s it unretryably.
- **What is NOT written back, ever:** the narration ring, `thinking` frames, tool calls and their
  arguments, `post` frames, `status` frames, any other turn, and any input the OPERATOR typed. The
  operator's own panel messages and their answers are untouched by this feature in both directions.
- **Why this is defensible rather than a hole:** the row is owner-only SELECT, the reader is the same
  human by construction (fences 1–3), and the alternative — a fire-and-forget direction — makes the
  orchestrator blind, which is what sends it back to the noisy main-room post this feature exists to
  replace.
- ⚠ **The UI must say so.** `agent-stream.tsx`'s directed rows carry the fact that this exchange was
  filed and answered off-machine (§1.9). An operator who believes every row in that pane is local is
  the person this ruling is written for.

### 1.6 THE CONSENT IS A LOCAL, PER-MACHINE, DEFAULT-OFF TOGGLE — a second one

`main/channel-prefs.js › getOrchestratorDirect` / `setOrchestratorDirect`, one `appWindowOnly` IPC pair
in `main/channel-dir-ipc.js` (`orchestrator:get/setDirectEnabled`), mirrored on
`spa-bridge.ts › SpaBridgeSurface.orchestratorDirect` and pinned in `test/preload-parity.test.mjs ›
APP_OPS`. **No route, no MCP op, no `workspace_settings` column — ever.** INVARIANTS §11's argument
applies unchanged and is arguably sharper here: a spawned session has `Bash` and the device token is on
disk, so a server-stored flag could be flipped by the very agents this lane steers. **A consent a
program can grant itself is not one.**

- **Off ⇒ the direction is ignored SILENTLY, with no server write at all** (`launch-directives.js`'s
  rule: a refusal from a machine that has not opted in would itself admit the machine is listening) and
  the row expires visibly to the orchestrator.
- ⚠ **TWO TOGGLES, NOT ONE, AND THIS IS AN OPEN QUESTION (Q1).** Launching buys a PROCESS; directing
  steers an EXISTING one and reaches its private lane. The conservative default is a separate consent
  per capability, which is what this plan builds. Folding both under `getOrchestratorLaunch` is one line
  and Samuel may prefer it — flagged rather than assumed.
- The Settings tab row obeys the minimal-copy ruling: a NAME and a CONTROL, at most a few-word
  secondary line, and no explainer paragraph. `settings-tab.test.tsx › minimal copy` bounds every
  `text-caption` node on the tab at 8 words and will go red on a sentence.

### 1.7 The MCP surface — TWO new ops, `dopl_channel` 15 → 17

Seven mandatory edits per op (`op="update"` is the template — the most recently added and it touches
every seam): the enum in `channel-schema.ts`, any new params there, the handler in a `channel-*.ts`
file, the `case` in `channel.ts`, a `- "op"` bullet in `channel-description.ts` (the name must appear as
a **quoted** `"op"` — `parity.test.ts` greps literally), the write/read classification, and a suite.

**`op="direct_agent"`** — new file `packages/mcp-server/src/tools/channel-ops-direct.ts ›
opDirectAgent`. Params: `channel` (required), `agent` (required — the 8-char instance id), `body`
(required), `thread` (optional), `wait_ms` (optional, default 15s, cap 30s, mirroring
`channel-ops-launch.ts`'s `WAIT_DEFAULT_MS`/`WAIT_CAP_MS`). Holds by polling the ROW at
`POLL_INTERVAL_MS` 1.5s. **Four terminal shapes, each ending in a different next action** —
`delivered` (renders the reply, or says "the machine reported no answer text" when `reply` is null),
`refused` (one of five sentences), `pending`/`claimed`, `expired`. ⚠ **A timeout is not a failure and
the result forbids re-issuing in the strongest terms available** — a second direction is a second turn
on the same agent, and nothing can tell them apart afterwards. In `gating.ts › WRITE_OPS.dopl_channel`.

- ⚠ **THE NAME.** `direct_agent`, not `message_agent`. "Message" is this product's word for the lane
  that reaches PEOPLE, and §5 spends four bullets denying that agents are addressable that way
  (`ADDRESSING IS REQUIRED`, the retired implicit trigger, the retired DM auto-address, "broadcast is
  not a shape this product has"). An op called `message_agent` teaches the opposite in the one place an
  agent reads most carefully. `direct_agent` also parallels `launch_agent`, its sibling in every other
  respect. **Q2 — Samuel proposed `message_agent`; this is a one-line reversal if he prefers it.**

**`op="read_directions"`** — read, own-scoped, optional `channel` / `agent` filters, in
`parity.test.ts › READ_OPS.dopl_channel`. Returns the caller's recent directions with status, age and
reply. It exists because `launch_agent`'s answer to "what happened to my pending row" is *"find it in
`read_sessions` later"*, and a direction has no such second surface — the reply IS the value.
⚠ **A SIBLING OP, NOT A MODE ON `direct_agent`.** Collapsing them puts a write and a read behind one
signature with two authorization stories, which is the argument `channel-ops-await-workspace.ts` was
split out on.

**Everything else follows the house rules with no exception:** `strictInput`'s `z.strictObject` (a
mistyped arg is refused BY NAME), `missingParams` for the required set, one neutralizer
(`narration.ts › inlineOr`) over every peer-influenced string, the untrusted header FIRST above any
listing, credits charged once at the registrar, and caps hand-mirrored between
`src/features/channels/schema-directions.ts`, `channel-schema.ts` and `FIELD_CAPS_NOTE`.

**SDK:** `packages/dopl-client/src/channel.ts` gains `createDirection` / `getDirection` /
`listDirections` / `claimDirection` / `decideDirection` with `toolName`s `channel_direct_agent`,
`channel_direct_poll`, `channel_read_directions` (the desktop's two are called with the operator's
cookie session from main, not from here — they exist on the client for the route contract and the
tests). Types in a new `packages/dopl-client/src/direction-types.ts`, mirroring
`launch-types.ts`. ⚠ `packages/*/dist` is what the app loads — `npm run build:packages` after.

**Routes**, mirroring the launch family exactly: `src/app/api/channels/directions/route.ts` (GET pending,
POST create), `.../directions/[directionId]/route.ts` (GET), `.../directions/claim/route.ts` (POST CAS),
`.../directions/decide/route.ts` (POST CAS, `.in("status", ["pending","claimed"])` so a retried decide
is a 409 and never a flip). Service `src/features/channels/server/service-directions.ts`, repository
`repository-directions.ts`, errors and `http-mapping.ts` entries alongside the launch ones.

⚠ **A DIRECTION IS NOT GATED ON PRESENCE THE WAY A LAUNCH IS — it is gated on a LIVE SESSION, and only
the machine knows.** `service-launch.ts` short-circuits offline via `agent_presence`; keep that
pre-check here too (it costs one read and saves a filed row nobody will claim), but the result copy must
say what the check cannot tell: presence is per-(user, workspace), so it cannot say whether THAT agent
is alive. `no-session` is the machine's answer and the only authoritative one.

### 1.8 The desktop claim path

`main/agent-directions.js` (watcher, ~launch-directives.js's shape) + `main/agent-direction-wire.js`
(the literal whitelist, `ROUTES`, `STATUS_*`, `REFUSAL_REASONS`, `directionFrom`, `claimBody`,
`decideBody`). `main/realtime.js` grows a third `postgres_changes` binding
(`{event:'INSERT', table:'channel_agent_directions', filter:'workspace_id=eq.<wsId>'}`) armed through a
`setDirections`-shaped call that **rejoins** the channel, because bindings are fixed at join time. Poll
backstop at 60s, `unref`'d, running only while `realtime.isWorkspaceHealthy(wsId)` is false; a 404 sets
`pollUnavailable` once (older-server degradation, not a bug).

`handle(raw, wsId)` gates in order: `armed && enabled()` → `wire.directionFrom` → `status === 'pending'`
→ local owner re-check → bounded `decided`/`inflight` dedupe (`MAX_REMEMBERED = 256`). Then the HTTP
claim CAS; **409 and 404 are a normal no-op and the desktop stands down, never retries.**

`deliver(d)`:
1. `sessionRegistry.sessionOn(slotKey(d.channelId, d.taskId, d.agentId))` — absent ⇒
   `{refused:'no-session'}`. ⚠ **`agentId` is REQUIRED and there is no oldest-agent fallback.** Every
   other op in the family falls back to the oldest live agent on the thread when none is named; for a
   lane that reaches a PRIVATE turn that would steer a different agent than the orchestrator addressed,
   with nothing reporting the swap — the argument `sessions:delete` already makes for a destructive
   verb, applied to an authority-bearing one.
2. `sessionPrivate.openPrivateTurn(s)` **then** dispatch `steer` through `messageByTask`, with
   `frameDirectedTurn` as the seed and `priority: 'next'` (unchanged — the orchestrator asked to say
   something, not to stop the agent).
3. On the turn's `result`, capture the final assistant text, cap + charset-strip it, and
   `decide(d, {status:'delivered', reply})`. On a refusal, `decide(d, {status:'refused', refusalReason})`.
   ⚠ **On a thrown handler, write NOTHING** — the row lazy-expires, which is the only honest terminal
   state for an unobserved outcome. Same for crash-after-claim; there is no start-up sweep, by the same
   ruling the launch lane made.
4. ⚠ **The delivered-reply capture is bounded and single-shot.** A session that never produces a
   `result` (parked, ended, torn down) leaves the row to expire; `resetPrivateTurn`'s existing
   zeroing on `abortQuery`/`denyPending`/`resumeParked` is what stops the private depth leaking, and the
   capture must be dropped on the same three edges or a later, unrelated turn's text is filed as this
   direction's answer.

**Retention:** the capture record is keyed by session key and must join
`main/agent-retention.js › bind`'s literal cleaner list, or it is the sixth per-agent structure with no
bound. `agent-retention.js` says so at `bind`; `test/agent-retention.test.mjs` counts the list.

### 1.9 The desktop-UI half — the operator must be able to tell their own voice from their agent's

**A DIRECTED TURN GETS ITS OWN NARRATION LANE.** `main/session-narration.js › entryFor` gains kind
`directed` (the inbound direction body, `rawText`, exactly as `operator` carries what the operator
typed) and `retagPrivate` gains `directed-reply` for the assistant text of a directed turn — the same
one-line move it already makes for `assistant` → `private`, and **only** for `assistant`: a `post`
inside a directed turn keeps `lane: 'channel'`, because it is the one thing that did not stay private.

`agent-stream-model.ts › StreamLane` gains `"directed"`; `LANE_BY_KIND` gains the two spellings; a new
`agent-stream.tsx › DirectedTurn` renders it. ⚠ **`frameLane`'s precedence rule is unchanged and is why
this is safe on an older desktop:** `LANE_BY_KIND` is an alias table with a `note` fallback, so a build
that does not know the kind renders the text plainly rather than dropping it.

Copy, minimal: the row says the direction came from another of the operator's agents and that its answer
was reported back. Two facts, one short line, no explainer paragraph — the surface's most surprising
property stated where it is read, which is the ruling `NARRATION_EMPTY` was rewritten under.

⚠ **`NARRATION_EMPTY` — *"Chat with your agent privately. Send a message to wake it up."* — is now
incomplete but must NOT grow a second sentence** (ONE STRING, ONE NODE, ONE STYLE, Samuel 2026-08-27).
Leave it. The directed rows say what they are when they exist, which is the only time the distinction
matters.

### 1.10 What is deliberately NOT built (each a ruling, not a gap)

1. 🔒 **`direct_agent` GETS NO OWN-CHANNEL LANE — a desktop-run agent cannot direct another agent.** It
   is on none of `OWN_CHANNEL_READ_OPS`, `OWN_CHANNEL_OUTBOUND_OPS` or
   `session-own-launch.js › OWN_MACHINE_LAUNCH_OPS`, so it falls to the Axis-A gate and a windowless
   session answers a gate with `deny`. **This is what makes Feature 1 loop-free by construction rather
   than by a depth counter:** only an EXTERNAL session can file a direction, and an external session is
   a human's terminal. F-315's unbounded-conversation shape cannot be reached from this lane at all.
   Building the lane later needs a conjunction argument like `session-own-launch.js`'s and a depth
   bound; **filed as a finding, deliberately not built.**
2. **No read of the narration ring over MCP, in any form** (§0.1). If an orchestrator needs to know what
   an agent is doing, `read_sessions` is the surface and its telemetry is what it may know.
3. **No `agentId` fallback** (§1.8 step 1).
4. **No cron, no sweep, no start-up recovery of unobserved outcomes** — lazy expiry only.

---

## 2. FEATURE 2 — STRUCTURED ESCALATION CARDS

### 2.1 THE STORAGE LANE — `kind='message'` + reserved, server-stamped metadata

**`metadata.escalation`, reserved on `fanoutGroup`'s exact terms.** Stripped from caller input
unconditionally in `service-writes-metadata.ts › resolvePostMetadata` and re-stamped **only** from a
validated `escalation` field on `ChannelMessageCreateSchema` (a new fold, beside fold 9's mentions).

Three independent reasons, any one sufficient:

1. **A new `kind` cannot notify.** `main/targeting.js › classify` returns `ignore` for any
   `m.kind !== 'message'` (§0.4). A card that cannot ping the operator is half the feature.
2. **A new `kind` is a column CHECK plus four hand-mirrored unions plus every renderer's
   `isLifecycleKind`-shaped switch** — and the `kind` lanes are OWNED: `system` is server-only, the
   three lifecycle kinds are refused from an agent token by
   `service-writes-lifecycle.ts › assertLifecycleKindIsServerOwned`, and `task_progress` is the
   milestone lane. There is no unclaimed kind and inventing one buys nothing.
3. **The transcript's own card precedent is metadata-keyed, not kind-keyed** —
   `view-model-rows.ts › channelRows` decides a thread card on `view-model.ts › threadIdOf`
   (`metadata.taskId`) resolving against the fetched thread list.

**The stamped shape** (validated by `EscalationSchema` in a new
`src/features/channels/schema-escalation.ts`, and mirrored into `packages/dopl-client`):

```ts
{ issue: string,                    // ≤ 200, safe-label charset (one line, no newline)
  context: string,                  // ≤ 2000, prose — bounded, not charset-limited
  options: Array<{ label: string,   // ≤ 80, safe-label charset
                   consequence: string }>,   // ≤ 200, one line
  recommendation: { index: number, why: string } | null }   // why ≤ 200
```
`options` is **2–6** — Samuel's bound, enforced by zod and restated in the op description. A one-option
escalation is a statement, not a question; seven is the prose wall in a costume.
`recommendation.index` must be in range or the whole payload is a 400 — an out-of-range recommendation
renders a card recommending nothing, silently.

⚠ **`body` STILL CARRIES THE HUMAN-READABLE RENDER**, per `schema.ts`'s own contract (*"`body` carries
the human-readable render (thread needs no per-kind special-casing); structured payload rides in
`metadata`"*). The op composes it: the issue line, the context, the numbered options with their
consequences, and the recommendation. **This is what makes the card degrade to readable prose
everywhere that does not know it** — an older desktop, the MCP `op="read"` render, a plain browser, the
pop-out. **A card whose absence leaves a blank row is not shippable; this one leaves the same words a
prose escalation would have had.**

⚠ **The serialized-metadata cap already applies** (`MAX_METADATA_SERIALIZED_BYTES`, F-060's size-cap
half). The per-field caps above sit comfortably under it; state that they do rather than relying on it.

### 2.2 `op="escalate"` — `dopl_channel`'s 18th op

`packages/mcp-server/src/tools/channel-ops-escalate.ts › opEscalate`. Params: `channel` (required),
`issue`, `context`, `options`, `recommendation` (optional), `thread` (optional), `client_msg_id`
(optional). In `WRITE_OPS.dopl_channel`.

⚠ **IT DELEGATES TO `opPost`, IT DOES NOT GROW A SECOND DELIVERY PATH** — `op="milestone"`'s precedent
exactly, and the `kind` is fixed at the routing seam so the agent never picks between enum values one
apart. What `escalate` adds over `post` is the validated payload and the result guidance.

**Result prose carries the two things a description read once at connection cannot** (§10's
outvoting rule, `channel-post-guidance.ts`'s lane): (a) **whether anybody was tagged**, reported off the
server's own `metadata.mentionedUserIds` read back from the stored row — the ONLY thing in the product
that catches a misspelled handle, and here it is load-bearing because an escalation nobody is tagged in
is an escalation nobody sees; (b) **that an answer arrives as a channel message on this thread, not as
a private direction** — so an agent does not sit on `read_directions` waiting for something that will
never come.

🔴 **`escalate` MUST JOIN `main/session-own-outbound.js › OWN_CHANNEL_OUTBOUND_OPS`, AND LEAVING IT OFF
WOULD SHIP THE FEATURE BROKEN FOR ITS PRIMARY PRODUCER.** The agent that most needs to escalate is a
BLOCKED one, and a blocked agent is almost always a windowless session on the operator's own machine. An
unclassified `dopl_channel` op falls to the Axis-A gate, and **a windowless session answers a gate with
`deny`** — so the op the tool's own protocol tells a stuck agent to reach for would be auto-refused in
*every* posture, with nothing an operator could set. That is F-320's defect class exactly, and
`create_thread`'s 2026-08-24 admission is the precedent that fixes it.

It clears the same bar `create_thread` cleared, on the same argument: **outbound CONTENT into this
session's own channel, addressed to a member of that same channel** — which is what the outbound half
consents to. It clears the bar that keeps `close_thread` out for the same reason a thread open does: an
escalation settles no shared state, it asks. Same channel-by-ID scope (**a slug is another channel and
gates**), same private-turn withdrawal inherited with no call-site change (`privateTurnMessageMode`
transforms the AXIS), and its own diag ALLOW code `auto-outbound-escalate`.
⚠ **`escalationAnswer` is NOT admitted and must never be** — an agent answering an escalation is an
agent deciding a question a human was asked, which is the whole thing the card exists to prevent. It
stays a `post` like any other and hits `isOwnChannelPost`'s ordinary gate; the SPA is its only producer.

⚠ **THE ZERO-TAG BRANCH GETS THE ESCALATION-SPECIFIC SENTENCE.** `channel-post-guidance.ts ›
tagOutcomeNote` already names five causes; an escalation with zero tags additionally needs "your operator
is tagged by naming them — an agent's tag at its OWN operator is kept and is the escalation path that
works" (§5's 2026-08-22 ruling), because the alternative is a card sitting in a room with nobody pinged.

### 2.3 THE ANSWER — a channel message, and the wake is an unforgeable metadata key

**`metadata.escalationAnswer`, reserved and server-stamped**, carrying
`{ escalationMessageId, optionIndex, agentId }`. Stamped only onto a `kind='message'` post by a member
the escalation actually addresses (§2.4), from a validated `escalationAnswer` field; a caller who is not
entitled gets **403 `CHANNEL_ESCALATION_FORBIDDEN`**, not a silent strip.

⚠ **403 HERE, WHERE `taskId` IS SILENTLY STRIPPED, AND THE DIFFERENCE IS DELIBERATE.** §5 strips a
non-participant's thread tag because installed desktops post legacy ids and a 403 would break them.
`escalationAnswer` has no installed writers, and a button that reports success over an answer that
reached nobody is the failure mode this whole feature exists to remove.

**The answer is PUBLIC, and that is a ruling rather than a convenience.** An escalation is a question
about shared work asked in a shared room; routing the answer down Feature 1's private lane would leave a
visible question with an invisible answer and a card that reads unanswered forever. It also makes
Feature 2 independent of Feature 1 — each ships alone.

**The wake.** `dopl-desktop-app/main/session-wake-tiers.js` gains a **second tier-1 door**: a
HUMAN-authored `kind:'message'` row carrying a reserved `escalationAnswer.agentId` that is live on this
thread counts as ADDRESSING that agent, alongside `@<id>` / `@agent-<id>` / the slug.

- ⚠ **IT IS STRICTLY STRONGER THAN THE BODY TOKEN, NOT A WIDENING OF THE LOOP FENCE.** The fence is
  unchanged and still asked once per message: only a human-authored `kind:'message'` row with an author
  may wake anything, and a session is never woken by its own post. What changes is only what counts as
  naming an agent — and this key is **server-stamped and caller-unsettable**, where the body token is
  anything a member can type.
- 🔒 **IT ALSO KEEPS THE RAW-AGENT-ID RULE.** The alternative — having the button write `@agent-<id>`
  into the body — would put an eight-character machine token into visible chrome the product composed,
  which INVARIANTS §11 forbids outright (the ONE exception is an agent's own output). A peer's machine
  cannot know the asking agent's display name, so the body token is the ONLY form available to them, and
  it is the forbidden one. **The metadata key is what makes a cross-operator answer possible at all
  without breaking that rule.**
- **DEGRADES, DOES NOT REFUSE.** An older desktop ignores the key; the answer is still an ordinary
  visible message on the thread, so `session-dispatch.js › feedLiveSession` still feeds it to every LIVE
  agent there. Only a DORMANT agent fails to wake, and it wakes on the operator's next word. A dead lane
  is strictly worse than an exact-where-it-can-be one.

**Idempotence:** one answer per escalation, first wins. The second click gets the card already answered
(optimistic patch + reconcile), and a genuine race is settled server-side by refusing a second
`escalationAnswer` naming the same `escalationMessageId` — 409, rendered as "already answered by X".

### 2.4 WHO MAY ANSWER — the conservative default, with the fork stated

**DEFAULT, and what this plan builds: the escalation's ANSWERER SET is the server-stamped
`metadata.mentionedUserIds` of the escalation message; if that set is empty, it is the AUTHOR
(i.e. the asking agent's operator).** Buttons render for a viewer in that set and for nobody else;
everyone else sees the same card, read-only.

Why this and not a new addressing concept:

- It reuses the mechanism the product already has for "this needs a specific person" — one that is
  server-resolved, caller-unsettable, ambiguity-fails-closed, and already wired to the Tags inbox and the
  desktop notification (§2.6). **No new field, no new fence, no second thing to keep in step.**
- It is NOT `to_user_id`. Addressing a member TRIGGERS that member's listener and starts their agent
  (§5) — precisely wrong for a question meant for a human. An @-tag is an INBOX fact and starts nobody.
- The empty-set fallback is §5's own ruling made useful: an agent's tag at its own operator is kept
  *"because it IS its escalation path to the one human who can unblock it"*. An untagged escalation is
  addressed to the person whose machine it runs on, which is the true default.
- It answers the brief's question directly. **An escalation from another member's agent renders
  read-only unless it tagged you** — so a peer's card is answerable by you exactly when its author asked
  you, and by nobody else otherwise.

⚠ **Q3 — THE FORK, and the conservative side is the one built.** The alternative is channel-wide
answerability (anyone in the room may pick an option). It is defensible — a room of colleagues unblocking
each other's agents is the product's own story — but it means a bystander can steer somebody else's
agent with one click and no attribution beyond a transcript row. **Building the narrow one first is
reversible; building the wide one first is not.**

### 2.5 RENDERING — two pipelines, one component, and the action row is absent-not-disabled

**Pipeline A — channel + thread** (`view-model-rows.ts`, one implementation for both):
- `TranscriptRow` gains `EscalationRow` (row-kind `"escalation"` — a different namespace from
  `ChannelMessage.kind`, as `"thread-card"` already is).
- A reader `view-model.ts › escalationOf(message)` beside `threadIdOf` / `fanoutGroupOf`, and
  `escalationAnswerOf`. ⚠ **`?? EMPTY_ESCALATION`-shaped guards at every read, spelled INLINE**
  (§8's standing rule): the wire type is non-optional and right, the IndexedDB-persisted cache is a
  different moment, and an object field read straight through THROWS and blanks the pane.
- Branch in `channelRows` / `threadRows` before the plain-message branch; **it must set
  `previous = null`** exactly as the thread-card branch does, or `isContinuation` silently absorbs the
  next row into the card's run (F-251's rule; the pill cannot fix a row that has none).
- Branch in `transcript.tsx › Transcript`'s `row.kind` chain.
- **Component: its own file** — `channels-v2/escalation-card-row.tsx › EscalationCardMessage`, modelled
  on `thread-card-row.tsx › ThreadCardMessage` **verbatim in structure**: `AuthoredRow` shell (so side,
  attribution pill, agent-name resolution and the flash tint all come for free and cannot fork), with a
  card `<div>` as its child instead of `MessageMarkdown`. Same dark-shell recipe
  (`bg-surface-cta` + `text-on-cta` outer, white panel inset by `m-0.5 mt-0`, radius 14 outer / 12
  inner), same `bits.tsx › CARD_BUTTON` for actions, action row last and right-aligned. **Tokens only,
  no hex, no raw px, no local shadow recipe.** ⚠ `bits.tsx › MESSAGE_CARD` was deleted 2026-08-20 — do
  not resurrect it.
- **Four fields, scannable:** issue as the card title; context as a clamped body with an expand; options
  as rows of `label` + a muted one-line `consequence`, the recommended one marked; the recommendation's
  `why` under them. **Answered state replaces the buttons with the chosen label and who chose it** — the
  `SentToChannelBox` three-face precedent (`canPost` / label / expired), whose ordering rule is
  strongest-claim-last.
- 🔒 **THE BUTTONS ARE ABSENT, NOT DISABLED, when the viewer may not answer or the host has no write
  callback.** `thread-window.tsx` mounts `message-pane.tsx` with no agents map and no `onOpenAgent`; the
  guest lane and any plain browser are the same shape. An inert button is indistinguishable from a
  broken one (`canLaunchAgent`'s rule). `busy` is a different fact and IS a `disabled`.

**Pipeline B — the agent stream** (`agent-stream-model.ts` + `agent-stream.tsx`):
- `buildAgentStream` already takes `sent: readonly ChannelMessage[]`; synthesize a `StreamItem` on the
  `sent` lane carrying the escalation and branch in `StreamRow` before the `sent` arm.
- **Full stream width, no `AuthoredRow`, no bubble** — `SentToChannelBox`'s own docblock rule ("a
  delivery RECORD, not a conversational turn"), and it is the closest visual sibling.
- In the agent stream the card is the AGENT'S OWN escalation, so its buttons are the operator's own
  answer path: the same mutation, the same fence, one surface fewer to explain.

**The write** (`hooks/use-escalation-writes.ts`, config exported apart from the hook so
`MutationObserver` can drive it DOM-free): `POST /api/channels/[channelId]/messages` with
`escalationAnswer`; `optimistic` patches the answered state onto the escalation row in
`channelKeys.messages(channelId).all` via a new pure fn in `lib/optimistic-cache.ts`; `reconcile`
MERGES (never assigns the narrower response over the cached row); `invalidate` names the transcript
unconditionally (the server-written answer message carries a `seq` and an id no reconcile can invent);
`coldKeys` for the case where the reconcile is the only path to the screen; `settleWith: gate`.

### 2.6 THE NOTIFICATION — ride the @-tag, invent nothing

The path exists end to end and needs **no new mechanism**: the escalation is `kind='message'`, the
server's own `resolveBodyMentions` stamps `mentionedUserIds` from the composed body, and
`main/listener-messages.js › dispatchMessage` → `targeting.js › classify` returns `fyi` →
`trigger.js › sendFyi` fires a silent OS notification whose click opens the channel. The Tags inbox
(`mentions-list.tsx`, `channel_mention_reads`) and the `info-tab.tsx` unread badge come with it.

⚠ **This is the whole reason §0.4 forbids a new kind**, and it is the reason the tag must be in the
BODY: `classify` reads only `metadata.mentionedUserIds`, which the server stamps only from its own parse
of the body against the roster.

**Open, and small: a BUTTONED banner.** `trigger.js › notifyAsk` + `notify-action.js ›
buildActionNotification` already build an actionable OS notification with one affirm button. An
escalation has 2–6 options and an OS banner has room for one, so a "Open" affordance is the honest
maximum. **Not built this wave; `sendFyi`'s silent banner is the ride-along.** (Q4.)

### 2.7 Stale-cache discipline (§8), stated once for both features

Every new field on a cached payload — `Channel`/`ChannelMessage` metadata readers, the escalation
payload, the answered state — gets **`?? EMPTY_X` spelled INLINE at each read**, not behind an accessor,
and a test whose fixture has the key **DELETED** (not `null`, not `{}`). ⚠ A route-level fixture cannot
reach the cache fallback — it pins the WIRE one; seed the component or the QueryClient with the
key-deleted object directly (`pages/home/knowledge-panels.test.tsx`'s §8 block holds both halves).
⚠ `?.` on the container is not a fallback on the key.

---

## 3. Pins (each mutation-verified; state "N reverts, N failures, 0 vacuous")

| Suite | What it pins |
|---|---|
| `packages/mcp-server/src/tools/parity.test.ts` | the three new ops classified write-or-read, documented as quoted `"op"`, every declared param referenced |
| `packages/mcp-server/src/tools/channel-directions.test.ts` | no operator/user param exists on any surface; the four terminal shapes; a timeout renders the do-not-re-issue line; refusal sentences cover all five words and an unknown word renders as unknown |
| `packages/mcp-server/src/tools/channel-escalate.test.ts` | 2–6 options enforced; an out-of-range recommendation is refused; the composed `body` contains every field (the degrade guarantee); the zero-tag branch names the operator-tag remedy |
| `packages/mcp-server/src/tools/channel-law.test.ts` | unchanged budget — re-measure, do not quote |
| `src/features/channels/server/service-writes-metadata.test.ts` | `escalation` / `escalationAnswer` stripped from caller input and re-stamped only from validated fields; a non-answerer's `escalationAnswer` 403s |
| `src/features/channels/server/service-directions.test.ts` | `operator_user_id` is `ctx.userId` and a payload key cannot shadow it; the claim CAS is single-winner; a retried decide 409s |
| `src/features/channels/components/channels-v2/escalation-card.test.tsx` | four fields render; buttons ABSENT for a non-answerer and for a missing callback; answered state; the stale-cache fixture with the key deleted |
| `.../channels-v2/escalation-agent-stream.test.tsx` | the card renders in the agent stream too, full width, no `AuthoredRow` |
| `dopl-desktop-app/test/session-directed-turn.test.mjs` | `frameDirectedTurn` ≠ `frameOperatorTurn`; the directions lane reaches only the former; the private turn is opened BEFORE the dispatch |
| `dopl-desktop-app/test/agent-directions.test.mjs` | toggle OFF ⇒ silent, zero server writes; owner re-check; 409/404 stand-down; no `agentId` fallback; reply capture dropped on abort/deny/resume |
| `dopl-desktop-app/test/agent-direction-wire.test.mjs` | the literal whitelist; an unnamed field never reaches this machine |
| `dopl-desktop-app/test/session-wake-tiers.test.mjs` | the `escalationAnswer` door wakes; the loop fence is UNCHANGED (agent-authored still cannot wake); an older-shape row still feeds a live agent |
| `dopl-desktop-app/test/ui-sync-tables.test.mjs` | publication 18 → 19; `SYNC_TABLES` unchanged at 17 |
| `dopl-desktop-app/test/preload-parity.test.mjs` | `orchestratorDirect` in `APP_OPS` |
| `dopl-desktop-app/test/agent-retention.test.mjs` | the new per-agent store is on `bind`'s cleaner list |

⚠ **A regex over source text is not a behavioural assertion**, and **a pin on a symbol is not a pin** —
pin the VALUE on both sides of every join with no shared module (the refusal vocabulary and the caps
each cross two trees).

---

## 4. Docs ritual (definition of done)

**INVARIANTS:** §5 (the escalation card's storage lane, the reserved-key pair, the answerer rule, the
answer-is-public ruling); §7 (publication 18 → 19, and why `SYNC_TABLES` does not move); §8 (the new
cached fields); §10 (`dopl_channel` 15 → 18 with the posture, the two directions ops and their fences,
the `direct_agent` naming argument); §11 (the framing ruling, the reply read-back ruling, the second
toggle, the new narration lane, the wake-tier door, and the "no own-channel lane" ruling); §12 (the
migration, replay owed if Docker is absent — recorded, not glossed; join on NAME not version, F-304);
§14 (the new suites). **ENGINEERING:** one dated stratum — *a direction is data, not the operator's
voice* and *a private question deserves a private answer; a public question does not*.
**FINDINGS:** file the own-channel direct lane as a new `F-NNN` — **re-derive the next free id from the
log, never from a number written here** — plus the three drifts the landscape pass turned up (§7 below).
Then
`node scripts/check-doc-refs.mjs`, and sync the "Dopl Development" KB via `dopl_kb`.

**Definition of green — re-derive with `grep -n 'run:' .github/workflows/ci.yml`, never from this table:**
five suites (`npm test`, `-w @dopl/client`, `-w @dopl/mcp-server`, `-w @dopl/desktop-ui`,
`cd dopl-desktop-app && npm test`), two lints (root `npm run lint -- --max-warnings 0`; desktop bare
`npm run lint`), two typechecks (`npm run typecheck`, `npm run typecheck -w @dopl/desktop-ui`), and four
non-suite gates (`node scripts/check-doc-refs.mjs`, the `size-check` 500-line cap over `packages/`,
`npx tsx scripts/check-knowledge-type-drift.ts`, `npx tsx scripts/check-role-drift.ts`).
⚠ `npm run build:packages` after any `packages/*/src` edit — `dist` is what the app loads.

---

## 5. Milestones (each green on the full §14 table; Samuel reviews live)

- **M0 — Escalation storage + card, read half.** `schema-escalation.ts`, the `resolvePostMetadata` fold,
  the `escalate` op delegating to `opPost`, the `TranscriptRow` member and `EscalationCardMessage`.
  *Checkpoint:* an escalation posted over MCP renders as a card in channel and thread, degrades to
  readable prose on a build without the row, and tags the operator (banner + Tags inbox + badge).
- **M1 — The answer.** `escalationAnswer`, the answerer fence + 403, the write hook and optimistic
  patch, the answered state, the wake-tier door. *Checkpoint:* click an option → the asking agent
  receives it as a turn, on the same machine AND across two operators; an older desktop still feeds a
  live agent.
- **M2 — The agent-stream card.** Pipeline B. *Checkpoint:* the same escalation, three surfaces, one
  set of facts.
- **M3 — The direction mailbox.** Migration (applied + probed: owner-only SELECT, no non-SELECT policy,
  replica identity, publication), service/repository/routes, SDK types, `direct_agent` +
  `read_directions`. *Checkpoint:* a cross-user direction is invisible; a claim CAS has one winner;
  `read_directions` shows only the caller's own.
- **M4 — The desktop claim + framing.** `agent-directions.js`, `agent-direction-wire.js`, the realtime
  binding, `frameDirectedTurn`, the private-turn open, the reply capture. ⚠ **Budget a full adversarial
  review here** — this is the milestone that reaches a private turn from off-machine. *Checkpoint:*
  toggle OFF writes nothing at all; a direction to another operator's agent is unreachable; the reply is
  the turn's final text and nothing else.
- **M5 — The toggle + the directed narration lane.** Settings row (minimal copy), `StreamLane`
  addition, `DirectedTurn`. *Checkpoint:* the operator can tell their own message from their agent's at
  a glance.
- **M6 — Docs, findings, KB sync.**

**Sequencing:** M1←M0; M2←M0; M4←M3; M5←M4. **M0–M2 and M3–M5 are independent** — Feature 2 does not
use Feature 1's lane (§2.3), by ruling. **Ship order (§13):** both features are server-before-desktop —
a new desktop against an old server is the direction that breaks.

---

## 6. Open questions for Samuel

1. **One toggle or two?** (§1.6) Built: a separate default-OFF `orchestratorDirect`. Alternative: fold
   into `orchestratorLaunch`. Recommendation: two — launching buys a process, directing reaches a
   private lane.
2. **`direct_agent` or `message_agent`?** (§1.7) Built: `direct_agent`, because "message" is this
   product's word for the lane that reaches people. One-line reversal.
3. **Who may answer an escalation?** (§2.4) Built: the tagged member(s), else the author's operator;
   everyone else read-only. Alternative: channel-wide answerability. Recommendation: the narrow one —
   it is the reversible direction.
4. **A buttoned OS notification for escalations?** (§2.6) Built: the silent `sendFyi` banner. An
   `notifyAsk`-shaped banner fits ONE action, and an escalation has 2–6.
5. **Should the reply read-back be opt-in per direction?** (§1.5) Built: always, because a direction
   with no answer sends the orchestrator back to the main-room post. A `reply: false` param is
   available if Samuel wants the private lane to stay absolutely closed by default.

## 7. Drifts found while scoping (file as `F-NNN`, do not fix in place)

- `channels-v2/agent-panel.tsx`'s file header says the panel has no composer and offers "Open window"
  instead; the file renders `<AgentComposer>` and `agent-panel-composer.test.tsx` pins its presence.
  Code wins; the header is stale.
- `src/app/api/channels/[channelId]/sessions/route.ts`'s docblock cites a per-channel
  `/channels/[channelId]/launch-directives` route. No such route exists — the launch-directive routes
  are workspace-scoped under `src/app/api/channels/launch-directives/`.
- INVARIANTS §10 states `dopl_channel` publishes 14 ops (measured 2026-08-22); the enum holds **15**
  since `update` landed 2026-08-28. The same section documents `update` two bullets away, so the file
  disagrees with itself.

## Critical files

- `dopl-desktop-app/main/session-reopen.js` › `messageByTask` · `main/session-private.js` ·
  `main/session-seed.js` › `frameOperatorTurn` (the three the direct lane is built on)
- `dopl-desktop-app/main/launch-directives.js` + `main/launch-directive-wire.js` (the wire pattern to copy)
- `supabase/migrations/20260822160000_channel_launch_directives.sql` (the migration to copy)
- `src/features/channels/server/service-writes-metadata.ts` › `resolvePostMetadata` (both reserved keys)
- `src/features/channels/components/channels-v2/view-model-rows.ts` + `thread-card-row.tsx` (the card precedent)
- `src/features/channels/components/channels-v2/agent-stream-model.ts` + `agent-stream.tsx` (pipeline B)
- `dopl-desktop-app/main/targeting.js` › `classify` + `main/session-wake-tiers.js` (why the kind is `message`)
- `packages/mcp-server/src/tools/channel-ops-launch.ts` (the op to copy) + `src/gating.ts` › `WRITE_OPS`
