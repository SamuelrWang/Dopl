# The agent id goes internal — the name is the address (2026-09-15)

## Samuel, verbatim

> "right now, the agent IDs we have, I want to make it so that the user really
> doesnt see it. basically, that ID is only internal for agents to be able to
> differentiate and for agents to see. But they don't need to be telling that or
> posting the id in the channel, in fact its a bad user experience. So they
> really shouldn't. Also, this means that for new agents, right now it auto fills
> the name with the ID. The name should be blank. And we should make sure, if
> agents are spinning up agents, they should be the ones that are naming the
> agent. Shouldn't be a nameless agent. And certainly shouldn't be an agent with
> the id as the name. Does this make sense? We need to trace this. In messages
> the agents should address by the tag which would be the name. The only time the
> agent id should be used in a sent message, is only if there is actually two
> agents with the exact same name that are active. Does this make sense? And if a
> user launches an agent with no name, just give it the name, New Agent."

## Samuel, verbatim — the SECOND ruling, later the same day

> "When people type the ads [@s], those should be the slugs. When people type ads,
> it should be going to the slug, not the name. The names should reflect the slug
> anyway, so that almost shouldn't be a conflict ever, right? … I think we should
> enforce a rule where no two agents that are addressable can have the same name.
> … If a user launches an agent with the same name, let's just have the name
> auto-renamed to that name and -1. For example, you have coder. Let's say there's
> already an active coder agent. If a user launches another agent called coder, or
> if their agent launches an agent called coder, it will automatically auto-resolve
> to coder-1. It will auto-resolve to coder-2 and so on and so forth. Of course,
> this is only something that needs to be enforced for agents that are in the idle
> or working state. If an agent is ended, they can't be addressed anyway, so it
> won't matter. They can have duplicate names … It's basically only for
> addressable agents, right?"

## The five rules this produces

1. **A human never reads a raw agent id.** Not on a card, not in a window title,
   not in a composer placeholder, not as a prefilled name.
2. **An agent may read its own id and a peer's** — it is how the server, the
   desktop and MCP tell two sessions apart — but it must not POST one.
3. **A message addresses an agent by its NAME tag** (`@bug-reviewer`).
4. **The id never appears in a sent message at all.** The first ruling carved out
   one case — two ACTIVE agents sharing a name — and the second **removed the
   case**: among addressable agents (idle or working, not ended) in one channel,
   display names are UNIQUE, because a name already taken is stored `<name>-1`,
   `-2`, … at commit. There is nothing left to disambiguate.
5. **Launch naming**: a human launch starts BLANK and a blank submit is named
   `New Agent`; an AGENT launching an agent must supply a name and is refused
   otherwise. The id is never the name.

---

# PHASE 1 — THE TRACE

## (a) Where the id is shown to a HUMAN

| # | Site | What leaks | Verdict |
|---|---|---|---|
| 1 | `src/features/channels/components/agents-model.ts › agentDisplayName` | returns `` `#${agentId}` `` when the agent has no operator name. **This is the root leak** — every card, header, window title, rail tab, thread-Info row, rename field, filter dropdown and activity line runs through it | FIX: fall back to `New Agent` |
| 2 | `src/features/channels/components/attribution-pill.tsx › attributionName` | returns `` `#${agentId}` `` for a stamped agent post with no name. **The transcript half of the same leak** | FIX: fall back to `New Agent` |
| 3 | `src/features/home/server/overview-tally.ts › mapAgents` | `name: row.display_name \|\| row.name` — `channel_sessions.name` IS the id, so the Home pane's agent board (`apps/desktop-ui/src/pages/home/overview-agent-board.tsx › AgentCard`) prints the raw 8 chars for any unnamed agent | FIX: fall back to `New Agent` |
| 4 | `src/features/channels/components/use-agent-launch.ts › defaultAgentName` | `` `#${agentId}` ``, written into the launch dialog's Name field by `› openPanel` | FIX: the prefill is deleted; the field starts blank |
| 5 | `src/features/channels/components/use-agent-launch-run.ts › launchWithIdentity` | compares the typed name against `defaultAgentName(address)` to decide "this is the prefill, not a rename" | FIX: a blank name is the only "not a rename" case left |
| 6 | `apps/desktop-ui/src/pages/agent-window/index.tsx` (the tab strip) | tab label — goes through `agentDisplayName`, so fixed by #1 | inherited |
| 7 | `src/features/channels/components/agent-window.tsx` | OS window title + header — `agentDisplayName` | inherited |
| 8 | `src/features/channels/components/agent-window-rail.tsx` | rail tab names — `agentDisplayName` | inherited |
| 9 | `src/features/channels/components/thread-info-tab.tsx` | thread Info agent rows — `agentDisplayName` | inherited |
| 10 | `src/features/channels/components/agent-rename.tsx › AgentName` | the cleared-name label — `agentDisplayName({displayName: null})` | inherited |
| 11 | `src/features/channels/components/agent-delete.tsx` | the "Ended"/deleted card — `agentDisplayName` | inherited |
| 12 | `src/features/channels/components/agents-tab-cards.tsx › AgentCard` | Agents-tab card title — `agentDisplayName` | inherited + gains the duplicate discriminator |
| 13 | `src/features/channels/components/composer-mentions.tsx › mentionSuggestions` | the @-picker's agent rows — `agentDisplayName` | inherited |
| 14 | `src/features/channels/components/channel-single-column.tsx` | the single-column face tab — `agentDisplayName` | inherited |
| 15 | `packages/mcp-server/src/tools/channel-session-table.ts › sessionRow` and `channel-session-render.ts › sessionRow` | `read_sessions` prints `@agent-<id>` and **no name at all** | AGENT surface — id stays (it is the address), name ADDED so name-addressing is usable |

**The existing pin.** `src/features/channels/components/agent-id-visibility.test.ts` is a
SOURCE sweep over every `.tsx` in that directory. It bans `agentDisplayId(`, bans
`>{agentId` as a JSX text child, and bans `` `${agentId}` `` interpolation — **with
`attribution-pill.tsx` explicitly EXEMPTED**, because `#<id>` was ruled a
NAME rather than an id (2026-08-31). That exemption is what let leak #2 stand. It is
removed by this wave and the file pins the new rule in both directions.

## (b) Where the id is told to AGENTS

| # | Site | Text | Verdict |
|---|---|---|---|
| 1 | `dopl-desktop-app/main/prompt-framing.js › agentIdentityFraming` | `YOUR AGENT ID IS <id>.` — the only identity line a session gets. It says nothing about the NAME and nothing about not posting the id | REWRITE: name + id + "the id is internal" |
| 2 | `packages/mcp-server/src/tools/channel-doctrine.ts › CHANNEL_LAW` | *"to=\"@agent-\<id\>\" or `@agent-<id>` in a body wakes THAT agent"* — teaches the id form as THE way to reach an agent | REWRITE: name tag first, id only for a duplicate name |
| 3 | `packages/mcp-server/src/tools/channel-addressing.ts › rosterAddressingRule` | *"`@agent-<id>` in the BODY … wakes one of YOUR OWN operator's agents by name"* | REWRITE to the name tag |
| 4 | `packages/mcp-server/src/tools/channel-schema.ts` (the `name` param's describe) | *"`@agent-<id>` stays the only address, nothing resolves an agent by its name"* — **factually false since 2026-08-28**; the name door is live in all three trees | CORRECT |
| 5 | `packages/mcp-server/src/tools/channel-session-handle.ts › addressableHandle` | *"A CUSTOM NAME IS NEVER A HANDLE HERE … No server holds it and this projection never carries it"* — **also stale**: `channel_sessions.display_name` exists (migration `20260905120000`) and `mapPeerSessionStateRow` projects it | CORRECT |
| 6 | `packages/mcp-server/src/instructions.ts` (the connect banner) | the connect banner lists `your live agents: @agent-xxxx, @agent-yyyy` | agent-facing; kept (it is the operator's own handle list) |
| 7 | `packages/mcp-server/src/tools/channel-wake-guidance.ts`, `channel-post-guidance.ts` | report the `@agent-…` handles a body named (`wake=`) | agent-facing diagnostics; kept, and gain the AMBIGUOUS verdict |
| 8 | `dopl-desktop-app/main/runtime/claude/axis-b.js` (the `rename_agent` tool) | the in-process rename tool: *"Display only — @agent-\<target\> is unchanged and remains the only address"* | CORRECT: a name IS an address |

## (c) The resolver — how `@<tag>` resolves TODAY

Three trees parse the same convention. **None of them can import another**, so the
rule is written down three times and pinned by cross-tree fixtures.

| Tree | Entry point | Name door | Ambiguity today |
|---|---|---|---|
| Web/server | `src/features/channels/lib/agent-mentions.ts › buildAgentMentionIndex` | slugged `displayName`, plus `agent-<id>` always | **MINTS A SUFFIX** — `coder`, `coder-1`, `coder-2` (Samuel, 2026-09-07) |
| Server write path | `src/features/channels/server/service-wake-verdict-handles.ts › resolveAgentRecipients` | builds that index over `liveChannelSessions` (human author) or `ownSessions` (agent author); `› bareId` normalises `@<id>` → `agent-<id>` | inherits the mint; the refusal is deleted |
| Desktop | `dopl-desktop-app/main/agent-handles.js › buildAgentHandleIndex` + `dopl-desktop-app/main/session-dispatch.js › mentionedAgentIds` | slugs only (the id forms belong to `session-dispatch.js › mentionedAgentIds`' own anchored regex) | **FAILS CLOSED** — `null`, resolves to NEITHER |

**The tag charset** (`src/features/channels/lib/mentions.ts › MENTION_TOKEN_RE`, `› mentionHandleOf`): a token is `@` followed by one or
more characters that are neither whitespace nor `@`; one trailing HTML tag and then a
trailing run of `` [.,:;!?'"`)\]}>*_~] `` come off, to a fixed point; comparison is
lowercase exact equality. **A display name with a space is NOT reachable whole** — the
slugger (`src/features/channels/lib/mentions.ts › mentionSlug`) collapses whitespace runs to a single
`-`, so "Bug Reviewer" is the tag `@bug-reviewer`. That is the existing, shipped
convention and this wave does not change it.

**So the two trees DISAGREE on the duplicate-name case today**: the server mints
`coder-1` and wakes the second agent; the desktop resolves `@coder` to nobody.
Samuel's rule 4 settles it in the desktop's favour.

**`channel_sessions`**: `name` is the minted handle (the id — `main/session-summary.js
› nameOf` answers `s.agentId`), CHECK `^[a-z][a-z0-9-]{1,30}$`. `display_name` is the
operator's name, peer-visible by design (2026-08-31), ≤60 chars. **"Two active agents
with the same name" is two live rows in one channel with the same
`lower(trim(display_name))` and different `name`.**

## (d) Launch naming — where the id becomes the name

| # | Site | Today |
|---|---|---|
| 1 | `src/features/channels/components/use-agent-launch.ts › openPanel` | mints an id and writes `#<id>` into the Name field |
| 2 | `src/features/channels/components/use-agent-launch-run.ts › launchWithIdentity` | skips the rename when the typed name still equals that prefill |
| 3 | `dopl-desktop-app/main/agent-names.js › displayNameFor` | `null` for an agent nobody renamed — the ABSENCE that every `#<id>` fallback above fills |
| 4 | `dopl-desktop-app/main/agent-identity-commit.js › commitRename` | the one write + projection-flush door for all three rename paths |
| 5 | `dopl-desktop-app/main/session-launch-op.js` | the SPA launch op — mints/accepts an agent id, **takes no name at all** |
| 6 | `dopl-desktop-app/main/launch-directive-wire.js › directiveFrom` (`targetName`) | carries a name for `kind='rename'` ONLY; the migration CHECK (`supabase/migrations/20260907120000_channel_launch_directives_kind.sql`, §5) forbids `target_name` on any other kind |
| 7 | `packages/mcp-server/src/tools/channel-schema-launch-fields.ts › LAUNCH_INPUT_FIELDS` | `op="manage" action="launch"` has `model`, `template`, `color`, `posture` — **and no `name`**. An agent literally cannot name the agent it launches |
| 8 | `packages/mcp-server/src/tools/channel-ops-launch.ts › opLaunchAgent` | the launch result reports `agent: @agent-<id>` |

**So #7 is the whole of Samuel's "if agents are spinning up agents, they should be the
ones that are naming the agent"**: the capability does not exist. Every agent-launched
agent is nameless by construction and therefore renders as its id.

## The standing rulings this wave is made against

| Ruling | Where | What this wave does to it |
|---|---|---|
| **THE RAW AGENT ID IS NEVER USER-VISIBLE** (Samuel, 2026-08-27) | `docs/INVARIANTS.md` §11 | **STRENGTHENED.** The row's own carve-out — *"`Agent #<id>` is a NAME the operator was shown at launch and accepted, not an id leaking through"* — is **withdrawn**. Samuel, 2026-09-15: the user really doesn't see it. The fallback is `New Agent`. |
| **The Agents tab / `agentDisplayName` is what renders** | `docs/INVARIANTS.md` §11 | unchanged in mechanism; the fallback string changes |
| **A peer cannot write `@agent-<id>` because the raw id is never user-visible chrome** | `docs/INVARIANTS.md` §11 | unchanged, and now consistent: the name tag is the address |
| **MINTED HANDLE SUFFIXES** — *"if coder exists, then other slugs will be coder-1, coder-2, coder-3"* (Samuel, 2026-09-07) | `src/features/channels/lib/agent-mentions.ts › buildAgentMentionIndex` | ⚠ **REVERSED.** See the note below. |
| **A NAME COLLISION FACES NOTHING** (Samuel, 2026-09-05) | `src/features/channels/lib/agent-mentions.ts › agentMentionFace` | **KEPT and generalised** — it was already the fail-closed answer on the render side; the resolver now agrees with it |
| **AN ENDED AGENT NO LONGER CLAIMS A HANDLE** (Samuel, 2026-09-06) | `src/features/channels/lib/agent-mentions.ts › addressableAgents` | **KEPT** — "two agents with the same name that are ACTIVE" is exactly this narrowing |
| **THE ID FORM IS NEVER WITHDRAWN** | `src/features/channels/lib/agent-mentions.ts` (module header) | **KEPT** — it is what rule 4 disambiguates WITH |

> ### ⚠ THE RULE MOVED OFF THE RESOLVER ENTIRELY — SAMUEL'S SECOND RULING
>
> The 2026-09-07 suffix ruling and the first 2026-09-15 ruling could not both
> hold, and this spec's first draft resolved that by making a duplicate name
> **fail closed** (`@coder` reaches neither; use the id). Samuel resolved it the
> other way, and better: **prevent the collision where the name is committed.**
>
> - A name already held by an ADDRESSABLE agent in that channel is stored
>   `<name>-1`, then `-2`, … — the **lowest free** suffix, compared by SLUG,
>   case-insensitively. `New Agent` collides like any other name.
> - The rename is **DURABLE**: it lives in `agent-names.js` → `channel_sessions.
>   display_name`, is decided once, and is never recomputed. **This is the whole
>   difference from 2026-09-07**, whose suffix was positional over the live set —
>   when the agent holding `coder` ended, the next one moved up and `@coder-1`
>   came to name a different agent than it did an hour ago.
> - **ENDED agents neither collide nor are renamed** (*"they can't be addressed
>   anyway, so it won't matter"*), so a name an agent frees by stopping goes to
>   the next launch and nothing already named is rewritten.
>
> **So the resolver carries neither a mint nor a contest.** `@coder` names exactly
> one addressable agent by construction, and the id stops being a disambiguator
> because there is nothing to disambiguate.
>
> ⚠ **THE ONE CASE THE RULE CANNOT COVER IS CROSS-MACHINE.** Names are minted on
> the machine that owns the id, so two MEMBERS can still each run a "Coder" in one
> room. `buildAgentMentionIndex` names the FIRST claimant there — which never
> re-points an address and never withdraws one — and the loser keeps its id form.

## The tag, and what happened to the disambiguator

**The tag is the stored display name, slugged** — `mentionSlug`: lowercase,
whitespace runs to a single `-`. "Bug Reviewer" is `@bug-reviewer`; the second
one is stored `Bug Reviewer-1` and is `@bug-reviewer-1`. Samuel: *"When people
type the ads, those should be the slugs … The names should reflect the slug
anyway, so that almost shouldn't be a conflict ever."*

**There is no disambiguator, because there is nothing to disambiguate.** The
first draft of this spec chose `@agent-<id>` for that role (over `@<name>#<id>`,
which would have been a fourth spelling of "what counts as an @-tag" in three
trees that cannot import each other). The id form **still resolves** — it is
minted once, never recycled, and a rename must not break an address somebody
wrote down — but **no copy anywhere tells a person or an agent to reach for it**.
A line teaching an id "for the rare case" is a line an agent will use in the
common one.

---

# PHASE 2 — WHAT WAS BUILT

## 1. The rule — launch-time uniqueness, and a resolver that needs no rule

- `dopl-desktop-app/main/agent-name-unique.js` — NEW, pure: `› uniqueAgentName` (lowest free
  `-N`, compared by slug) and `› addressableSiblings` (same channel, `state !== 'ended'`, not
  self). Driven by `dopl-desktop-app/test/agent-name-unique.test.mjs`.
- `dopl-desktop-app/main/agent-identity-commit.js › commitRename` — where it runs, and **the only
  place it needed to**: that wrapper is already the one door all three rename paths share (the IPC
  op, the in-process tool, the external directive) AND the launch lanes commit through it. Five
  call sites, one rule. `› uniqueFor` reads `session-summary.js › reportList` for the roster and
  **never throws**: a naming rule may not be the thing that fails a launch.
- `src/features/channels/lib/agent-mentions.ts › buildAgentMentionIndex` — pass 2 is now
  claim-if-free. No mint (2026-09-07), no contest (2026-09-15 morning). `AgentMentionIndex` is
  `ReadonlyMap<string, string>` again, which is where "a handle names exactly one agent" is
  proved. `agentHandleContested` is deleted.
- `src/features/channels/server/service-wake-verdict-handles.ts › resolveAgentRecipients` — the
  `null` branch and `contestedAgentHandles` are gone with it.
- `src/features/channels/lib/draft-recipients.ts` / `components/composer-recipients.tsx` —
  `DraftReach.contested` and the *"names two agents — use @agent-<id>"* line are deleted.

## 2. Agent-facing prose

- `dopl-desktop-app/main/prompt-framing-identity.js › agentIdentityFraming` (§1-split out of
  `prompt-framing.js` at the 500-line cap) — the id, its BOUNDARY, and the name-tag rule. The
  block's own ratchet moved 60 → 300 chars, recorded in `test/addressing-framing.test.mjs`.
- `packages/mcp-server/src/tools/channel-doctrine.ts` — the LAW's own-agents bullet teaches the
  name tag and states *never write an agent id in a message*, with the duplicate carve-out;
  `MANAGE` says a launch must be NAMED; the rename clause's three FALSE claims are deleted.
- `packages/mcp-server/src/tools/channel-schema.ts` — the `name` describe gains the launch clause
  and loses *"`@agent-<id>` stays the only address, nothing resolves an agent by its name"*.
- `dopl-desktop-app/main/runtime/claude/axis-b.js` — the in-process rename tool stops calling the
  id "the only address" and prints the slug the new name answers to.

## 3. Human UI

- `src/shared/lib/agent-name.ts` — the ONE face: `NEW_AGENT_NAME` / `agentFaceName`. Read by the
  channels tree, the transcript pill and the Home board's SERVER projection, because all three had
  their own copy of `#<id>`.
- `src/features/channels/components/agents-model-identity.ts` — §1-split out of `agents-model.ts`;
  holds `isAgentActive`, `agentDisplayId`, `agentDisplayName`. `agents-model.ts` re-exports them.
- `src/features/home/server/overview-tally.ts › mapAgents` — `row.display_name || row.name` was
  the Home board printing `channel_sessions.name`, which IS the id.
- `agent-id-visibility.test.ts` — the `attribution-pill.tsx` EXEMPTION is removed (it is where the
  leak lived), and the sweep pins that the pill asks for the shared face.
- ⚠ **NO `#<id>` TIE-BREAK ON CARDS.** `agentNameDiscriminators` and `AgentName`'s `discriminator`
  prop existed for part of 2026-09-15 and are **deleted**: Samuel's second ruling removed the
  case rather than the display. ENDED agents may share a name and are shown unsuffixed on
  purpose — there is nothing to choose between.

## 4. Launch naming

- **Human launch**: `use-agent-launch.ts › defaultAgentName` is DELETED and `› openPanel` writes
  nothing into the field; `ready` is no longer gated on the name and the disabled-submit hint goes
  with it. `use-agent-launch-run.ts › launchWithIdentity` names a blank submit `New Agent` — and
  a refusal is reported only for a name the operator actually TYPED, so an older desktop with no
  `sessions.rename` op does not show an error banner under every blank launch.
- **Agent launch**: `name` is REQUIRED.
  - `supabase/migrations/20261006120000_channel_launch_directives_agent_name.sql` — **two**
    columns: `agent_name` (what was asked) and `applied_agent_name` (what was stored). Both
    nullable at rest (§13) and both pinned to `kind='launch'`.
  - `src/features/channels/schema-launch.ts › LaunchCreateSchema.agentName` — the fence.
    `schema-launch-decide.ts › LaunchDecideSchema` carries `appliedAgentName`.
  - `packages/mcp-server/src/tools/channel-ops-launch-name.ts` — `› launchName` (the two refusals)
    and `› launchedTag` (the slug the result publishes). A nameless launch and an id-shaped name
    are refused before anything is filed. ⚠ The id-shape check refuses the PASTED forms outright
    and a BARE eight characters only when it carries a digit — the naïve test refused `reviewer`.
  - `dopl-desktop-app/main/launch-directive-wire.js › directiveFrom` carries the request and
    `› decideBody` carries the echo; `› launch-directive-spawn.js` commits the name after the id
    exists, defaults to `New Agent`, and reports back what was STORED.
- **The launcher learns the final name**: the MCP result's `name=` is the applied name, slugged
  (`channel-ops-launch.ts`), and the human dialog's card reads it off the summary push.
- **The agent learns its own**: `main/prompt-framing-identity.js › agentIdentityFraming` takes an
  optional `ctx.agentName` and speaks the STORED name, suffix and all.

## 5. Surfaces

| Surface | Changed |
|---|---|
| channels-v2 (web + desktop workspace pages) | YES — every card, pill, window, rail, picker and dialog, through the two shared resolutions |
| desktop Home pane | YES — `overview-tally.ts › mapAgents` is its agent board's title |
| MCP (`dopl_channel`) | YES — the doctrine, the `name` param, the launch refusals |
| desktop prompt framing | YES — but it needs a restart (main/) |
