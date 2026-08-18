# Channels v2 — mapping the mock onto the real channels model

Status: PORTED (2026-08-18). ⚠ **The mock is gone.** Everything this file
describes now lives at `src/features/channels/components/channels-v2/` and reads
real data; `index.tsx` here is a thin seam over `› channels-v2-core.tsx`, exactly
like `#/pages/channels`. The design-review fixtures
(`mock-data.ts`, `mock-threads.ts`, `mock-agents.ts`, `mock-mentions.ts`) and the
mock's own columns were deleted with the port.

This file stays because it is the INTENT document the port is judged against —
its rulings migrate into docs/INVARIANTS.md and docs/ENGINEERING.md when the
`channels-v2` route is retired (wiring plan Phase 13), not before. Read the
sections below as the DESIGN, and the table immediately following as what is
actually wired. **Current behaviour lives in docs/INVARIANTS.md §5 §7 §9, never
here** (repo CLAUDE.md precedence).

## Wired vs hardcoded after Phase 8 (2026-08-18)

| Surface | State |
| --- | --- |
| Sidebar channel + DM tree, selection, per-channel nesting | **WIRED** — `use-channels`, `use-channel-threads` |
| Sidebar thread admission: active in 24h **OR requested** | **WIRED** — `view-model-requested.ts › sidebarThreads`; both arms now exist |
| Sidebar thread glyph: `Clock` vs `Bot` | **WIRED** — `› requestedThreadIds`, off the viewer's own consent inbox |
| Sidebar section collapse, header search filter | **WIRED** (interaction-completeness ruling) |
| Sidebar Inbox badge | **WIRED** — pending count off `use-consent-inbox` |
| Sidebar Inbox row OPENS the inbox | **WIRED (Phase 8)** — `channels-v2/inbox-pane.tsx › ChannelsV2InboxPane` takes over the center column; the row wears `.raised-tab` like every other selected row |
| **Launch panel** (replaces the consent card) | **WIRED (Phase 8)** — `components/launch-panel.tsx › LaunchPanel`. **Launch agent** expands into the launch settings, then decides; the write is the unchanged `PATCH /consent/[id]` |
| Launch settings: tool use · message permissions · working folder | **WIRED (Phase 8)** — the REUSED `permission-preset-row.tsx › RequestPermissionRow` (two axes) + `request-folder-row.tsx › RequestFolderRow`. Desktop-only; a plain browser shows no disclosure at all |
| Auto-launch / trust ("saved settings for this person") | **NOT BUILT — ON HOLD** by Samuel's ruling. The seam (`POST /trust`) is left empty on purpose |
| Center transcript (channel + thread views), breadcrumb, sides, agent chip | **WIRED** — `use-channel-messages` |
| Posted request card: title, preview, **one pill per real addressee**, Open thread | **WIRED** — N fan-out threads grouped by the server-stamped `metadata.fanoutGroup` |
| Card `Requested` chip | **WIRED, ONE-DIRECTIONAL** — true for a thread the VIEWER owes an answer on; a request you SENT shows none (F-206) |
| Info tab: creator / created / status / thread count / members + presence | **WIRED** — `use-channel-members`, 90s window client-side |
| Threads tab: activity-ordered list, clipped note, Open | **WIRED** — no status filter (activity ordering replaced it), and since Phase 4 there is no status to filter ON |
| Thread close / propose / reopen | **DELETED, NOT PORTED** — wiring plan Phase 4 (2026-08-18). A thread has no finished state on any surface; the operator ends an AGENT |
| Realtime | **WIRED** — `useChannelsRealtime` + `usePresenceRealtime` through the refetch coordinator |
| Composer typing, @-autocomplete, agent-request pills | **WIRED** — pills are the real roster |
| **Composer SEND** | **WIRED** — panel open → the request fan-out (`POST /tasks` with `toUserIds`); panel closed → a plain chat message (`intent:"chat"`) |
| Activity heatmap · Linked threads · Favorites · Assistant/Drafts/Saved-items | **HARDCODED** (Samuel 2026-08-18) — `fixtures.ts` |
| Agents tab + agent view | **HARDCODED** until Phase 5 — `fixtures-agents.ts` |
| Tags / mentions inbox | **WIRED** (Phase 6) — `use-channel-mentions` over server-stamped `metadata.mentionedUserIds`; read-state is `channel_mention_reads`; badge is client arithmetic; `fixtures-mentions.ts` is DELETED |
| Transcript self-mention tint | **WIRED** — driven by the same server stamp the inbox lists, not by a re-parse (one source, `lib/mentions.ts` places the highlight) |

**Dropped rather than faked** (no backing data, and NOT on the hardcoded-keep
list): emoji reactions and the link attachment card. A fabricated reaction is a
claim about a real person's action, which is worse than absent furniture; the
heatmap claims nothing about anybody.

⚠ **THE `requested` STATUS CAME BACK IN PHASE 3, AND THE APPROVAL LINE DID NOT.**
Both were dropped in Phase 2 for the same stated reason — "no server projection"
— and only one of them turned out to be true.

- **`requested` is derived, not stored, and there is still no such task status.**
  It is a thread whose consent request against the VIEWER is still `pending`,
  joined off `use-consent-inbox` on the triggering `seq`. One derivation feeds
  the sidebar's admission rule, the sidebar's glyph and the card's chip, so the
  three cannot disagree.
- **The "N of M agents approved" line stays DROPPED, permanently until a ruling.**
  A consent read is scoped to `(operator, workspace)` and the operator is always
  the caller (INVARIANTS §6), so **the requester cannot see their addressees'
  decisions at all** — and "no pending row" would report NEVER-ASKED as approved.
  `bits.tsx › AddresseePill` keeps an optional `approved` that nothing passes.
  Filed as **F-206**; it needs a new requester-scoped projection and the security
  decision that goes with it, not a filter change.

## The center-pane state machine (the core interaction)

The middle column has TWO views, switched client-side:

1. **Channel view** — the transcript of one channel (or DM). Breadcrumb shows
   just the channel name (`# Website`).
2. **Thread view** — opened from a thread card in the right panel's "Threads"
   tab, a nested sidebar row, or the transcript's own posted thread card
   ("Open thread"). The middle area REPLACES the channel
   transcript with the thread's own transcript. Breadcrumb becomes
   `# Website / <thread title>`; clicking the channel crumb goes back.

Maps to: `channel` rows → channel view; `channel_tasks` (domain name: thread —
storage keeps `task`, see INVARIANTS §5) → thread view. A thread's transcript
is the `channel_messages` carrying that thread's `taskId`.

## Right panel

- **Tabs**: Info · Threads · Agents · Links (Threads replaced Pins, 2026-08-17;
  Agents replaced Files, 2026-08-18).
- **Threads tab**: rectangle cards, filtered **Active / Inactive**. Active =
  thread status open, REQUESTED included; inactive = closed (either outcome) —
  the calm-flag detail (INVARIANTS §5, `CALM_FLAG_KEYS`) colors the card
  subline, it does not add filter states. Each card: title, participants,
  last-activity, a caution-toned **Requested** chip when it is one, and an
  **Open** button → switches center pane to that thread's view.
  - *Mock deviation*: only `THREADS` rows with an entry in
    `THREAD_TRANSCRIPTS` ("UI-kit design", "Design QA sweep") actually switch
    the pane — two worked transcripts (a settled thread and a just-requested
    one) are what the interaction needs, and six would be fixture bloat. The
    other active cards keep an enabled, inert Open, like
    every other control on this page; inactive cards' Open is `disabled`,
    because a closed thread has nothing to walk into.
  - *Mock deviation*: the card subline is a flat `Updated 3h ago` /
    `Closed 2w ago`. Calm-flag coloring is port-time work — there is no flag
    in the fixture to color it with.
  - *Mock deviation*: the tab lists the WHOLE thread fixture, not just the
    threads whose `parentId` is the open channel. At port time it is scoped to
    the open channel's `channel_id`; here the sidebar needs threads spread
    across a channel, a DM and a favorite to show its nesting, and filtering
    would strip the tab down to two cards.
- **Members**: `channel_members` roster + presence from `agent_presence`
  (90s freshness window, client-side arithmetic — INVARIANTS §7).
- **The Tags row is the MENTIONS INBOX** (2026-08-18; label kept "Tags" from
  the reference design). A disclosure, not a popover — the panel is 340px.
  Lists every message that @-tags the viewer (`mock-mentions.ts`, each row
  pointing at a real transcript message); the row's badge is the LIVE UNREAD
  count. Click = mark read + land the center pane on the right transcript
  (thread or channel) + scroll to the message with a brief flash — the scroll
  signal is NONCED so re-clicking the same mention re-scrolls. Read items stay
  listed, unmarked; "Mark all read" zeroes the badge. Maps to
  `channel_messages` whose mention/addressed set carries my user id.
  **Read-state has no backing column today** — port time needs one (or a local
  store); until then it is page state and resets on reload, which is correct
  for a mock and wrong for the product.
  - ⚠ **ANSWERED IN PHASE 6 (2026-08-18), and the answer is not a column.** The
    mention set is `metadata.mentionedUserIds`, resolved server-side at insert
    and stripped from caller input; read-state is a ROW PER READ in
    `channel_mention_reads`, because this very paragraph's "marks individual
    mentions read" is a thing a cursor cannot express. Current behaviour and the
    match rule live in **docs/INVARIANTS.md §5**, never here.

## Agents tab & the agent view

- **The Agents tab lists MY agents only** — an operator surface, not a roster
  (the members list already shows everyone's presence). One card per running or
  idle agent of mine in this channel: liveness, thread it works (several agents
  may share one thread), started / last-activity, context meter, token spend,
  **Open**. Maps to LOCAL RUNTIME STATE — the desktop's own running work — plus
  `agent_presence` for liveness. Context and token numbers are runtime metrics
  the server never stores today; the port-time source is the local session
  runtime, not a table.
- **Open → the agent view** (`agent-panel.tsx`), a fourth surface sliding over
  the info panel: the agent→operator lane. Three entry types in one feed —
  work narration (nobody received it), messages it actually posted (same
  strings the thread transcript carries, captioned with where they went), and
  the direct 1:1 lane between me and it. The direct lane NEVER posts to the
  thread — operator↔agent, out-of-band, which is why it lives here and not in
  the channel composer (the input says so under itself).
- **FUTURE ruling (recorded 2026-08-18, NOT implemented)**: thread transcripts
  will eventually carry only party-to-party traffic; the agent's commentary to
  its own operator moves out of transcripts and into this view. Applies to the
  eventual port and to the original channels UI.
- **Files tab: removed from the mock.** Where files land is an OPEN QUESTION,
  not a decision — nothing here says files stop existing.

## Message alignment & authorship

- **Peers** (other members, and their agents): left-aligned, avatar gutter.
- **Me** (`author_user_id === currentUserId`): right-aligned.
- **Agents**: same alignment rule as their operator (my agent → right, a
  peer's agent → left), visually tagged as agent (chip/icon), never restyled
  into a third column. `authorKind` is a display claim scoped to one user
  (INVARIANTS §5) — the UI tags, it does not authenticate.
- UI copy rule: inside one member's window there is exactly ONE session —
  never write "agent session" / "channel session" in copy (INVARIANTS §5).

### New agent thread

The composer's `Bot` toggle opens an inset panel — the surface that composes an
explicit **agent-addressed request**, not a decorated message. Each pill
(`bits.tsx › AgentTargetPill`) is one OTHER member's agent, all present by
default and each removable; the title names the thread and the existing text area
is its opening message. On send, every remaining pill is an EXPLICITLY ADDRESSED
target whose member gets a Dopl notification — an agent is sending a message to
your agent. This is the fail-closed addressing rule made visible (INVARIANTS §5):
N pills = N addressees, removing them all reaches nobody, and "broadcast" stays
a shape the product does not have.

**Lifecycle, as the mock draws it.** Send CREATES A THREAD: the title becomes the
thread title, the pills become its addressees, and the request lands in the
channel transcript as a **thread card** (`message-pane.tsx ›
ThreadRequestCard`) — a `.bento` message-card face (`bits.tsx › MESSAGE_CARD`,
extracted from the attachment card when this second caller arrived) carrying the
`AGENT THREAD` tag, the title, the body preview, one `AddresseePill` per
addressee, the approval count and an **Open thread** button that switches the
center pane. The card is ONE artifact; storage FANS OUT — a thread is one
requester + one target (INVARIANTS §5), so port time writes one `channel_tasks`
row per pill and the card renders them as a group.

Each pill's green check is that member's own **consent decision** — the prompt
channels already raise. Consent is per-target, server-side, TTL'd and re-derived
at consume time (INVARIANTS §6); the fixture's `approved` boolean is a DISPLAY
SIMPLIFICATION of a row that can also expire or be revoked, not a latch.

**`requested` is a MOCK-SIDE status — and it is now DERIVED rather than stored.**
The shipping model still has no such task status: there it is an open thread
whose consent rows are still `pending`, and an addressee who never answers is a
thread that never starts. Phase 3 wired the word to the one direction the model
can actually answer — `view-model-requested.ts › requestedThreadIds` joins the
VIEWER'S OWN consent inbox to the transcript on the triggering `seq`, so
"requested" means "you have been asked and have not answered". ⚠ The mirror
image — "my addressee has not answered me" — is NOT derivable and is F-206.

- *Judgment*: requested threads file under the right panel's **Active** segment.
  They are live work in formation; Inactive means CLOSED. A third segment would
  split the live column for a state the card already names on its face.
- The thread view of a requested thread carries a slim status strip under the
  header (`Requested — 1 of 3 agents approved`), the kit's SectionBox header face
  at pane width. Taken, not skipped: which agents have joined is invisible from a
  two-message transcript, and the strip is the only place the thread view says it.
  - ⚠ **NOT BUILT, and its COUNT is the reason.** "1 of 3 agents approved" is the
    per-target consent projection that does not exist (F-206). The word
    `Requested` is derivable and rides on the card's `PendingChip`; the count is
    not, and a strip whose headline number is fabricated is worse than no strip.

## Sidebar

- No workspace switcher in this surface (removed from mock 2026-08-17; the
  shell already owns workspace identity).
- Sections, in order: quiet nav rows → **Favorites** → **Direct messages** →
  **Channels**. DMs are their own header section (rows = people, avatar +
  presence), not a nav row. Maps to `is_direct` channels; favorites are a
  client-side preference (no backing column yet — needs one, or a local pref,
  at port time).
  - *Mock deviation*: DM rows use a plain `Avatar`, not
    `AvatarWithPresence`. The presence ring's `ring-2` + `p-0.5` float takes
    an `xs` avatar to ~32px, which neither fits the 36px row nor lines up
    with the 26px icon tiles beside it. Presence in this column needs a
    smaller ring variant before it can drop in.
- Row icons/emojis sit on small raised white tiles (kit face, not a local
  recipe) — `bits.tsx › IconTile`, a `.btn-light` face. Avatars are never
  tiled: a person is already a face.
- **ACTIVE and REQUESTED threads are rows in this tree**, nested one indent step
  under the channel / DM / favorite they belong to, derived from
  `mock-threads.ts › SIDEBAR_THREADS_BY_PARENT` — the same fixture the right
  panel's cards read, so the two columns cannot disagree. **Inactive threads
  are never here**: a closed thread has nothing to walk into, and the tree is a
  list of places you can go. Maps to `channel_tasks` rows with status open,
  grouped by `channel_id`.
  - A thread row's two glyphs sit BARE on the sidebar surface — no `IconTile`.
    A tile is a button face, and a thread is a CHILD of the row above it, not a
    peer control: the `↳` elbow says "under this", and the second glyph says
    which state it is in (a display claim, same rule as the transcript's chip).
  - **Glyph legend** (WIRED in Phase 3): `Bot` = active, an agent is party to it
    and working; `Clock` = requested, addressed and waiting on consent. `Clock`
    beat `CircleDashed` on two counts — at 13px a dashed ring's gaps fall under a
    pixel and it mushes into a fuzzy dot beside the crisp `Bot`, and it is the
    SAME glyph the card's `PendingChip` uses, so one shape means "waiting on
    approval" in both columns.
    - ⚠ **The clock is the VIEWER'S OWN state and can never be anybody else's.**
      It renders for a thread YOU have been asked about and have not answered. A
      thread you REQUESTED never wears it, however long its addressee takes —
      see F-206 and the note above.
  - *Mock deviation*: only threads with a `THREAD_TRANSCRIPTS` entry
    ("UI-kit design", "Design QA sweep") actually open. The rest are inert, like
    every other control on this page.
- **The selected row MIRRORS THE CENTER PANE** (rule changed 2026-08-17 —
  previously the open channel was always selected). Whatever the middle column
  is showing wears `.raised-tab`: with a thread open, the THREAD row is
  selected and its channel row drops back to resting; with no thread open, the
  open channel (`# Website`) is selected. A thread the tree does not show would
  leave its channel selected rather than selecting nothing.

## Wiring intent (Samuel, 2026-08-18 — port-time behavior, NOT in the mock)

Vocabulary: **channel** = the main channel chat; **thread** = threads.

- **Agents MAY post to the main channel, sparsely.** A capability, not a habit:
  relevance-gated (likely system-prompt guidance to the agent), never
  thread-scoped chatter spilling into the channel. Thread agents talk in their
  thread; the channel post is the exception. ✅ **SHIPPED in Phase 11
  (2026-08-18) — the AGENT-FACING half, which is the whole of it:** the guidance
  is stated in `dopl_channel`'s description (the law bullet "reply where you
  were asked" now carries the grant, so the rule no longer reads as a ban) AND
  in the RESULT of a post that landed in the main room
  (`channel-post-guidance.ts › mainRoomPostNote`), because a result is read at
  the moment the agent picks its next action. **"Sparsely" became a bar the
  agent can apply**: if it has already posted to this channel in this run, the
  next one needs a reason a human would name out loud. The desktop's spawned
  sessions get the same grant in `main/prompt-framing-text.js › VOCABULARY`.
  ⚠ **Nothing ENFORCES sparseness** — there is no rate limit and none was
  designed; this is guidance, and the operator's per-call approval is the only
  brake in the product today.
- **Launch flow replaces bare approval.** ✅ **SHIPPED in Phase 8 (2026-08-18).**
  When an agent-thread request arrives, the addressee's panel carries a **Launch
  agent** action (not "approve"). Clicking it EXPANDS the panel into launch
  settings, then a launch. ⚠ **The settings are the two EXISTING permission axes
  plus the working folder, and nothing more** — "permission bypass" is not its
  own control, it is the `bypass` VALUE on the tools axis. A third axis would be
  a claim about containment that the desktop cannot consume; if the design wants
  one, it is a desktop change first (`main/session-profiles.js`), a UI change
  second. On launch the agent is ACTIVE: it appears in the Agents tab and in the
  thread (the Agents tab is still Phase 5 fixtures).
- **Agent view grows controls**: pause the agent, change its settings, plus the
  existing direct 1:1 lane.
- **Windowing inverts.** Today: request → desktop notification → click → a NEW
  WINDOW per thread (the session window with its open-session settings). New
  default: notification click FOCUSES the main desktop app and auto-navigates
  to the channel/DM where the request was made, to launch or decline there.
  Each opened thread view gets an **open as new window** button — a pop-out,
  movable window (to be designed) — so the per-thread window becomes opt-in
  instead of the default.
- **Notification policy: mention-gated.** Today every agent post into a thread
  raises a desktop notification. New rule: agent/thread activity notifies ONLY
  when the agent explicitly @-tags me. Tagging is a capability the agent must
  be TOLD it has (system prompt) and should use for the important things — a
  needed decision, a summary, "I'm blocked" — because most thread traffic is
  agents talking to each other and the operator does not need a popup per
  message. (Mentions land in the Tags inbox either way; the notification is
  the escalation, the inbox is the record.) ✅ **THE TAGGING HALF SHIPPED in
  Phase 11 (2026-08-18); the GATING half is Phase 7 and is NOT in this branch.**
  What shipped: the agent is now TOLD it can tag, in `dopl_channel`'s law bullet
  on being blocked, in the description's conventions (the resolver's real match
  rule, `@` + handle in the body, exact and failing closed), in the RESULT of a
  threaded post that tagged nobody (`channel-post-guidance.ts › threadTagNote`),
  and in the desktop's `VOCABULARY` for spawned sessions — each stating WHEN
  (a decision only a person can make, a summary worth their minutes, "I am
  blocked"). **Plus the half the ruling did not ask for and the exact-match
  resolver made necessary:** the post's result now REPORTS how many readers the
  server resolved out of the body, or that it resolved NONE — a misspelled
  handle posts fine and reaches nobody, so without that line an agent believes
  it escalated. ⚠ **The agent-facing copy states the Tags INBOX and the direction
  of travel, never a notification**, because `main/targeting.js` still notifies
  per message until Phase 7 lands; promising a popup this branch cannot deliver
  is the invisible-delivery failure the addressing copy exists to prevent.

### Q&A rulings (Samuel, 2026-08-18, second round)

- **The launch-settings panel fully replaces the consent card**, including its
  desktop-only rows (working folder, permission preset) — same decision point,
  new surface. ✅ **SHIPPED in Phase 8 (2026-08-18):** `consent-card.tsx` and its
  test are deleted, `launch-panel.tsx` renders in BOTH surfaces (the shipping
  channels page and the v2 Inbox). ⚠ **It was a UI statement, not an
  authorization one** — INVARIANTS §6 now says so in as many words, because
  "replaces the consent card" is one careless read away from "replaces consent".
- **Trust / auto-allow → "auto-launch with saved settings for this person"** in
  principle, but **ON HOLD** — Samuel has not folded auto-allow into the
  product mentally and wants to revisit before wiring it. Do not build it into
  the launch flow yet; leave the seam.
- **Consent inbox lives in the sidebar "Inbox" nav row.** ✅ **SHIPPED in Phase 8
  (2026-08-18)** — the row opens `inbox-pane.tsx` in the center column, listing
  every request waiting on this viewer as a launch panel. ⚠ **Addressee side
  only**, and that is the only side that can exist: a consent read is scoped to
  `(operator, workspace)`, so a request you SENT never appears here (F-206).
- **The "New agent thread" panel is the ONLY way to raise an agent request.**
  ✅ **SHIPPED in Phase 3.** The plain composer is human chat, full stop — the
  intent pill (chat/request) and `lib/composer-mode.ts` are deleted, on the old
  channels page as well as the new one.
- **The DM implicit trigger is REMOVED.** ✅ **SHIPPED in Phase 3 (2026-08-18),
  both halves in one change:** the server's `peerUserId` fallback in
  `resolvePostMetadata` and the `knownTwo && isMember` branch in the desktop's
  `classify`. No auto-addressing in a 2-person DM; a DM agent request goes
  through the same explicit panel. ⚠ SHIP-ORDERED (INVARIANTS §13): web deploys
  before a desktop build.
- **Session pills / session cards are replaced** by the Agents tab + agent
  view. The pop-out thread window is the session window REDESIGNED — but it is
  a THREAD view (the thread, not the session, is what it shows).
- **THREAD CLOSING IS REMOVED.** ✅ **LANDED 2026-08-18 — wiring plan Phase 4.**
  The close machinery existed to make agents stop; with pause/end living on the
  AGENT (agent view), an open/closed thread status buys nothing. No close, no
  propose-then-confirm, no reopen — the user pauses or ends agents instead.
  (Port note, now history: this retired a large slice of INVARIANTS §5 —
  close/propose/confirm/reopen and the stale-threads cron that proposed on the
  product's behalf. ⚠ **The CALM-FLAG terminal reads were the one thing the note
  named that did NOT go**, and the distinction is worth keeping: a calm flag is
  about one member's SESSION ending, which was never an outcome for the shared
  thread, so deleting those readers would have taken the consent-DENY receipt
  with them. The mock's Active/Inactive filter mapped to activity ordering, per
  the third-round ruling below, rather than to anything derived from agents.)
- **Lifecycle events** (started/finished/failed): answered by the above — the
  agent's run state lives in the agent view, not as transcript rows.
- **Channel management maps over wholesale** (create, invite, visibility,
  delete, folders — folders exist in v1, `channel-folder-control.tsx`, and ride
  along).
- **Mention gating applies to human DMs too**: a DM notifies when you are
  tagged. Human-to-human mentions notify, yes.
- **Pause/end is for YOUR OWN local agents only** — nobody pauses another
  member's agent. The peer's side renders a paused/ended counterpart agent as
  **inactive/offline** (presence-style), NOT as a "thread stalled" state.

Third round (same day):

- **Onboarding explainer: KEEP for now**, redesign later.
- **Threads never leave.** No closed state, no archive — threads are kept
  forever and **sorted by activity** (sidebar and Threads tab alike; stale ones
  sink, nothing disappears). The mock's Active/Inactive filter does not survive
  the port as a status filter — activity ordering replaces it.

Fourth round (2026-08-18, wiring kickoff):

- **Sidebar thread bound**: the tree shows threads **active within the last 24
  hours OR requested**. The Threads tab still lists everything (paged, sorted
  by activity).
- **Design furniture stays HARDCODED**: the activity heatmap, Linked threads,
  Favorites, and the Assistant / Drafts / Saved-items nav rows keep their mock
  UI through the port — Samuel wires them later; do not drop them and do not
  render zeros from missing backing data.
- **Every disclosure/dropdown must function** in the wired page (section
  collapse chevrons, the Tags disclosure, tab rows, filters) — no inert
  chrome carried over from the mock.

Still open: the auto-launch-trust seam above (on hold by Samuel's call); the
demo-seed approach (how Samuel keeps seeing a fleshed-out UI with only one real
account — under discussion).

## Not represented in the mock (port-time work, not design questions)

⚠ **STRUCK 2026-08-18 (Phase 3), because they are now BUILT:** composer wiring
(the `channel_message_insert` path, through the existing write layer), addressing
ENFORCEMENT (zero pills is not sendable AND is a 400 — `schema.ts ›
TaskFanOutSchema`), the request fan-out into one thread per addressee, and
optimistic writes / `client_msg_id` idempotency (a base key minted at submit,
per-addressee keys derived server-side).

⚠ **STRUCK 2026-08-18 (Phase 8), for the half that is now BUILT:** the consent
DECISION surface. The mock rendered each decision's OUTCOME on the card and never
the control behind it; the control now exists as `launch-panel.tsx`, in the
channel scroller and in the new Inbox. **The outcome half is NOT built and cannot
be** — see F-206: a requester cannot read their addressee's consent row in any
state, so a green check on a posted card would be a claim about a real person's
decision that no read supports.

⚠ **The close = propose-then-confirm flow was also on this list and is OFF it:
Phase 4 DELETED it rather than porting it (2026-08-18).** Nothing in the mock
renders a thread's settled state, which is why its absence cost this list a line
rather than a redesign.

⚠ **STRUCK 2026-08-18: "realtime (OFF in the SPA — polling/refetch only)" used to sit in
that list and it was false.** The SPA rides the ui-sync doorbell and every channels table
is on it — INVARIANTS §7, F-199. It was inherited from the `pages/channels/index.tsx`
docblock, which has been corrected. **Realtime is not port-time work; it is already live,
and the wired page must register its new surfaces the way §7 requires.**
