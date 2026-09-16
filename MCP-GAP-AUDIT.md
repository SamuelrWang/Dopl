# MCP Gap Audit — Home Space vs. the MCP surface

**Code-side sections.** Written by the code auditor (`@agent-smitvvuw`) from the repo at
`/Users/samuelwang/Downloads/setup-intelligence-engine` (root checkout, not the `sie-*`
worktrees). The live-probe sections are the MCP prober's (`@agent-fqv6bovk`) and are
marked as such; where a row says *(unconfirmed)* it is a code reading that wants a live probe.

**Method.** `git log` since 2026-08-20 (659 commits), the 62 migrations added in that
window, and the uncommitted working tree (29 modified, 8 untracked) read for every new or
changed entity, field, setting and item type. Then each one checked against
`packages/mcp-server/src/**` — tool schemas (`*-schema.ts`), the agent-facing descriptions
(`*-description.ts`, `tool-style.ts › composeDescription`), and the handlers (`*-ops-*.ts`) —
plus the SDK the handlers call through, `packages/dopl-client/src/`.

**One finding sits above the rest and changes how you read the whole table:**
the shipped build is stale, so part of what looks missing is merely unbuilt. See §0.

---

## §0 — THE SHIPPED BUILD IS STALE (severity: highest, effort: lowest)

`packages/mcp-server/dist/` is **committed to git** and is **not rebuilt** after commit
`cfda06d2` ("New channel: the popup … takes a description, which both info cards and the
MCP show", 2026-09-15).

Exactly three modules are behind; every other `dist/tools/*.js` matches its source.

| module | src | dist |
|---|---|---|
| `tools/channel-schema` | `summary` describe says **"it is the description"** (×2) | says **"it is the channel topic"** |
| `tools/channel-ops-open` | echoes a `Description:` line on create | no `Description:` line |
| `tools/channel-ops-update` | prints a `Description:` row on the read arm | no `Description:` row |

Reproduce:

```sh
cd packages/mcp-server
grep -c "it is the description"  src/tools/channel-schema.ts   # 2
grep -c "it is the description"  dist/tools/channel-schema.js  # 0
grep -c "Description:"           src/tools/channel-ops-open.ts # 1
grep -c "Description:"          dist/tools/channel-ops-open.js # 0
for f in src/tools/*.ts; do b=$(basename "$f" .ts); d="dist/tools/$b.js";
  [ -f "$d" ] && [ "$f" -nt "$d" ] && echo "STALE: $b"; done
```

**Consequence.** The single feature Samuel named as the motivating example — "channels now
have a description field" — is *written* on the MCP surface and *not shipped* to it. Any
agent connected to the built server is told the field is called "topic", is not shown the
value when it creates a room, and is not shown it when it reads the room back.

**Remediation:** `npm run build -w @dopl/mcp-server`, commit `dist/`. This is a **ship**
gap, not a **code** gap, and it should be tracked separately from everything below — it is
one command, and it silently invalidates any live probe run against the current build.

> ⚠ This is the second recorded instance of the committed-`dist` trap (prior: the MCP audit
> of 2026-07-17, where shipped hardening was absent from `dist/` for weeks). A CI guard that
> fails when any `src/**/*.ts` is newer than its `dist` counterpart would retire the class.

---

## §1 — Ground truth: what the Home Space gained

Each row is a thing an agent would need to **read** or **act on**. `✎` = uncommitted.

### 1.1 Channels

| # | Feature / field | Where it lives | Notes |
|---|---|---|---|
| C1 | **Channel description** | `channels.topic` column; `home/schema.ts › HomeChannelCreateSchema.topic` | **No new column.** The product word is "Description" (ruling 2026-09-15); wire and DB stay `topic`. 2000 chars, `safeOptionalLabel` charset gate. Rendered on both Info cards and the MCP list line. |
| C2 | **Info card** (curated Main-info rows) | `Channel.infoCard`; migration `20260825120000_channel_info_card` | Shared, not caller-relative. Custom rows (≤12) + hideable built-ins (`email`, `created`, `lastActivity`). |
| C3 | **Pin / bookmark** | `channel_members.favorited_at` → `Channel.myFavoritedAt`, `ChannelMember.favoritedAt`, ✎ `HomeChannel.favoritedAt` | One fact, server-backed: pinning on `/home` and bookmarking on the channels page are the **same write** (`channels/server/service-writes-members.ts › updateMyMemberSettings`). Replaced a per-device `localStorage` set. |
| C4 | **Per-member unaddressed responder** | `ChannelMember.unaddressedResponder`; migration `20260928130000_per_member_unaddressed_responder` | Who answers *this member's* untagged messages. **Private — present only on the caller's own row**, scrubbed in `dto.ts › mapMemberRow` and column-privileged in the migration. Replaced the room-wide `defaultResponderAgentName`. Surfaced in the Settings tab as "Responder / Last addressed". |
| C5 | **Agent tool profile** (per member) | `ChannelMember.agentToolProfile`, `Channel.myAgentToolProfile` | Private preference, caller's row only. |
| C6 | **Artifacts** (message folding) | `ChannelArtifact`; migration `20260926120000_channel_artifacts` | `name`, `summary`, `createdBy`, `createdByAgent`, `dissolvedAt`, span `firstSeq`/`lastSeq`, `count`. |
| C7 | **Delivery verdict + recipients** | `ChannelMessage.wakeVerdict`, `.delivery`, `.deliveryAt`, `.recipientUserIds`, `.recipientAgentIds` | `undefined` ≠ `null` ≠ `[]` — three distinct readings, deliberately. |
| C8 | **Agent display name on a post** | `ChannelMessage.authorAgentName`, joined from `channel_sessions.display_name` | Joined at read time, never stored. |
| C9 | **Presence** | `Channel.onlineMemberCount`, `ChannelMember.agentOnline`, `.lastSeenAt`; migration `20260930140000_presence_heartbeat_all` | Heartbeat inside `PRESENCE_ONLINE_WINDOW_MS`. |
| C10 | **Unread + tag marks** | `Channel.unread`, `.lastReadAt`; `HomeChannel.unread`, `.unreadMentions` | `unreadMentions` counts messages past the **watermark** that tag the caller — deliberately not `channel_mention_reads`. |
| C11 | ✎ **Recency wells** | `pages/home/channel-wells.ts`, `channels/components/{recency-wells,collapse-wells,well-state}.tsx` | Pinned / Recent / Last 7 days / Last 30 days / Earlier, by last activity. Presentation grouping over C3 + `lastMessageAt`. |
| C12 | **Guest role** | migrations `20260825140000_guest_role`, `20260825150000_channel_link_granted_role` | `ChannelMember.workspaceRole` carries it so the roster can show a Guest pill. |
| C13 | **Deleted, do not re-expose** | — | `Channel.agentPosture` (room-wide ceiling, deleted 2026-09-06); `defaultResponderAgentName` (deleted 2026-09-07); `myNotifyScope`/`notifyScope` (dead since F-170). |

### 1.2 Home channels (the `/home` surface)

| # | Feature / field | Where it lives | Notes |
|---|---|---|---|
| H1 | **Create with a description** | `POST /api/home/channels`, `HomeChannelCreateSchema{name ≤80, topic ≤2000}` | The route accepts it. |
| H2 | **Peers (more than two)** | `HomeChannel.peers[]` (oldest join first), `.peer` | `peer` is derived from `peers[0]` in exactly one place. |
| H3 | **Add a person = bound link** | `POST /api/home/links`, `HomeLinkMintSchema{workspaceId, label, grantedRole, expiresAt}` → `HomeChannel.linkOut` | `maxUses` deliberately absent (pinned to 1). `grantedRole ∈ guest|viewer|member`, `optional()` not `default()` — absent means "reuse whatever is open". |
| H4 | **Claim a link** | `POST /api/home/link/[token]/claim`, `GET .../info` | Inserts the claimer as a container member. |
| H5 | **Revoke a link** | `DELETE /api/home/links/[linkId]` | |
| H6 | **Overview / usage** | `GET /api/home/overview`, `/overview-series`, `/token-spend` | Credit spend, per-channel histogram, month scope. |
| H7 | ✎ **Pin on the home row** | see C3 | |
| H8 | **Last-message preview** | `HomeChannel.lastMessagePreview` | On the wire, deliberately rendered by nothing since 2026-09-13. |

### 1.3 Agents, templates, sessions

| # | Feature / field | Where it lives | Notes |
|---|---|---|---|
| A1 | **Template instructions** | `AgentTemplate.instructions`; commit `dcf2230b` | A blank launch sends typed Instructions as an instructions-only role. |
| A2 | **Scoped knowledge attachment** | `TemplateKnowledgeRef{baseId, scope, folderId, entryId, path}`; migration `20260930150000_agent_template_knowledge_scopes` | Base / folder / entry. |
| A3 | **Unreachable-base count** | `AgentTemplate.unreachableKnowledgeBaseCount` | Attachments the caller cannot read. |
| A4 | **Agent colours** | `AgentColorKey`; migration `20261005120000_agent_session_colors` | One colour per live agent per channel. |
| A5 | **Session display name** | `channel_sessions.display_name`; migration `20260905120000` | |
| A6 | **Session health** | `ChannelSessionHealth`; migration `20260909120000_channel_sessions_health` | Seven fields incl. staleness / wedged. |
| A7 | **Launch posture, two axes** | `LaunchToolMode`, `LaunchMessageMode`; migration `20260910120000_channel_launch_directives_posture` | |
| A8 | **Teams removed from templates** | migrations `20260915120000_drop_agent_template_teams`, `20260916120000_drop_team_resource_access` | `teamIds` is legacy; no Team scope in the home space. |

### 1.4 Knowledge, ontology, billing

| # | Feature / field | Where it lives | Notes |
|---|---|---|---|
| K1 | **Pinned startup context** | migration `20260908120000_knowledge_pinned_startup_context` | Base-level and entry-level. |
| K2 | **Revisions / changelog** | migration `20261002120000_revisions`; `/api/knowledge/{bases,entries}/[id]/revisions`, `.../restore` | Per-field history for KB **and** ontology. |
| K3 | **Base star, export, files, folders-by-path** | `/api/knowledge/bases/[baseId]/{star,export,files,folders-by-path}` | |
| O1 | **Ontology in the home space** | migration `20261001120000_ontology_home_shares`; `/api/ontology/clusters/[clusterId]/shares` | Personal ontologies lent to home channels at per-channel levels. |
| O2 | **Ontology per-field history** | `/api/ontology/objects/[objectId]/revisions`, `.../restore` | |
| O3 | **Ontology typed fields** | `docs/specs/…` (commit `3f7d343f`) | **Proposal + research only — not built.** Out of scope for a gap row; noted so it is not mistaken for a shipped feature. |
| B1 | **Credit wallets, per-channel burn** | migrations `20260930120000_credit_wallets`, `20261003120000_credit_events_channel`, `20261004120000_credit_consume_with_ledger`, `20260927120000_workspace_token_spend` | Charge the calling channel's container; counter + ledger in one transaction. |
| B2 | **Personal Pro plan** | migration `20260930130000_workspace_billing_plan_pro`, `20260920120000_workspace_kind_personal` | |

---

## §2 — Gap checklist: ACTIONS an agent can take

Legend: **✅ exposed** · **⚠ partial / mis-worded** · **❌ absent**

| ref | action | MCP surface | status | evidence |
|---|---|---|---|---|
| C1 | Set a channel description on create | `dopl_channel op=rooms action=open`, arg **`summary`** | ⚠ | `channel-dispatch-rooms.ts:98` maps `topic: args.summary`. The value lands. The **word "description" is nowhere in the published schema** in the shipped build (§0), and even in source the arg is named `summary` and carries four unrelated meanings. An agent told "fill in the description field" has no argument by that name to find. |
| C1 | Change a description later | `dopl_channel op=rooms action=update` | ❌ | `channel-ops-update.ts:140` — *"THE INFO CARD ONLY. `name` / `topic` / `archived` are accepted by the route"* but are **not** wired to arguments. The route can do it; MCP cannot ask for it. |
| H1 | Create a **home channel** with a description | `dopl_workspaces op=create_home_channel` | ❌ | Takes `name` only (`meta-tools.ts:74-97`). Full-stack gap, not just the tool: `packages/dopl-client/src/client-home.ts:22` — `createHomeChannel(input: { name: string })`. The route already accepts `topic`. **Fix touches SDK + tool, not the route.** |
| C2 | Edit the info card | `dopl_channel op=rooms action=update`, `info_card` | ✅ | Replace-whole semantics, stated. |
| C3 | Pin / unpin a channel | — | ❌ | **Zero hits** for `favorit` in `packages/mcp-server/src`. The write exists (`updateMyMemberSettings`) and is the same one the UI makes. |
| C4 | Set my unaddressed responder | — | ❌ | Two incidental prose mentions in `channel-addressing.ts` / `channel-render-identity.ts`; no argument, no op. An agent cannot say who answers its operator's untagged messages. |
| C5 | Set my agent tool profile | — | ❌ | Human-only today; may be deliberate (matches the `agent_write_enabled` precedent on skills). **Ruling wanted.** |
| C6 | Create / add / remove / dissolve an artifact | `dopl_channel op=artifact` | ✅ | Four actions, all present. |
| H3 | Add a person to a home channel (mint a link) | — | ❌ | `dopl_workspaces` policy line says so outright: *"Only create_home_channel writes; nothing deletes or invites."* `op=rooms action=invite` adds an existing **workspace member** to a channel; it cannot mint a claim link, cannot set `grantedRole`, cannot set `expiresAt`. |
| H5 | Revoke a link | — | ❌ | |
| A1 | Set template instructions | `dopl_agent op=create/update`, `instructions` | ✅ | |
| A2 | Scoped knowledge attachment | `dopl_agent`, `knowledge[{base,folder,entry}]` | ✅ | Good — `knowledge` vs `knowledge_bases` and the mutual-exclusion are both stated. |
| A4 | Pick an agent colour at launch | `dopl_channel op=manage action=launch`, `color` | ✅ | |
| A5 | Rename a session | `dopl_channel op=manage action=rename` | ✅ | |
| A7 | Set launch posture | `dopl_channel`, `posture{tools,messages,chain}` | ✅ | |
| K2 | Restore a KB or ontology revision | — | ❌ | **Zero hits** for `revision` in `packages/mcp-server/src`. Routes exist for both KB entries and ontology objects. |
| K3 | Star a base | — | ❌ | |
| O1 | Share an ontology into a home channel | — | ❌ | `dopl_kb op=grant` and `dopl_agent op=grant` exist; **`dopl_ontology` has no `grant`/`share` op** at all. Asymmetry across three sibling tools that otherwise mirror each other. |

## §3 — Gap checklist: INFORMATION an agent can read

| ref | information | MCP surface | status | evidence |
|---|---|---|---|---|
| C1 | Description on a channel listing | `formatChannelLine` | ✅ | `channel-render.ts:234` appends ` — <topic>`, neutralized. Present in the shipped build; this one line is why the field looked exposed. |
| C1 | Description on create / on read-back | `action=open` echo, `action=update` read arm | ⚠ | In **source** only. Not in `dist` — §0. |
| C3 | Is this channel pinned | — | ❌ | `myFavoritedAt` is on the DTO the MCP client already receives and is rendered nowhere. |
| C4 | Who answers my untagged posts here | — | ❌ | On the caller's own roster row; `formatMemberLine` (`channel-render.ts:324`) prints **label, id, role, "you"** and nothing else. |
| C9 | Who is online / agent presence | — | ❌ | **Zero hits** for `onlineMemberCount` or `agentOnline` in the MCP server. `formatMemberLine` drops both. An agent cannot tell whether a peer's agent is live before addressing it — which is the fact most likely to change what it does next. |
| C10 | Unread counts | `dopl_status` | ⚠ | Reported, and honestly labelled a FLOOR when clipped (`status-render.ts:83`). `unreadMentions` as a distinct number is **not** broken out — `unreadMentions` has zero hits server-side. |
| C12 | Is this member a guest | — | ❌ | `workspaceRole` exists precisely so a roster can show a Guest pill; `formatMemberLine` does not print it. `dopl_members op=list` prints workspace role, so the fact is reachable by a second call against a different tool. |
| C13 | Threads list | `op=rooms action=threads` | ✅ | Status/outcome deliberately not rendered (threads do not close) — correct, not a gap. |
| H2 | Home-channel peers | — | ❌ | `dopl_workspaces op=list` prints the container and its id; it does not print who is in it. `op=rooms action=members` does work on a home channel **if** you pass `workspace=` — *(unconfirmed, prober)*. |
| H3 | Is there an invitation out on this channel | — | ❌ | `linkOut` — zero hits. |
| H6 | Credits / usage / token spend | — | ❌ | **Zero hits** for `credit` in `status*.ts` or `map.ts`. The server *charges* credits (`credits-unmetered.ts`, `registrar.ts`) and surfaces `credits_exhausted` as an error, but no agent can read its own balance or burn before hitting the wall. |
| A3 | Unreachable knowledge attachments | `dopl_agent op=get` | ✅ *(unconfirmed)* | Field exists on the DTO; prober to confirm it renders. |
| A6 | Session health | `dopl_channel op=status` | ✅ | `channel-session-health.ts` renders it, and deliberately stays quiet on a healthy session. |
| K1 | Pinned startup context | `dopl_kb op=pin/unpin` | ✅ | |
| K2 | Revision history | — | ❌ | An agent can overwrite an entry and cannot see what it replaced, or what anyone else replaced. Pairs with the §2 restore gap. |
| B2 | Which plan this container is on | — | ❌ | |

## §4 — Stale or misleading descriptions (no behaviour change needed)

| # | where | says | should say |
|---|---|---|---|
| S1 | `dopl_channel` `summary` describe, **shipped build** | "on op=rooms action=open it is the channel **topic**" | "…it is the **description**" — already fixed in source, unshipped (§0). |
| S2 | `dopl_channel` `summary` describe, **source** | carries **four** meanings on one argument: send notification, decision question, room description, artifact subject | The description case is the only one that is a *durable property of an entity* rather than a per-call label. Consider a distinct `description` argument; at minimum the tool description's rule-4 block should name it, since it is exactly the "argument that is not self-describing" that block exists for. |
| S3 | `dopl_workspaces` policy line | "Only create_home_channel writes; **nothing deletes or invites**" | Accurate today, and it is the *statement of the H3/H5 gap*. If linking lands, this line is the one that goes stale first. |
| S4 | `dopl_channel op=rooms action=update` | documented as info-card-only | Correct as written — flagged so it is not "fixed" by widening the prose instead of the schema. |
| S5 | `dopl_agent` `knowledge_bases` | no mention of `unreachableKnowledgeBaseCount` | An attachment the caller cannot read is silently invisible; the count exists to say so. |
| S6 | `dopl_ontology` description | "Reads plus writes that edit ONE thing at a time… Writes are filed per field in the changelog" | The changelog is **named and unreadable** — there is no op to read it (§3 K2). Either expose it or stop advertising it. |

## §5 — Remediation, ranked

1. **Rebuild and commit `dist/`** (§0). One command. Unblocks C1 entirely and invalidates any probe run before it.
2. **Add a CI guard**: fail when any `src/**/*.ts` is newer than its `dist/**/*.js` counterpart. Retires the class, second occurrence.
3. **Plumb `topic` through `createHomeChannel`** — `packages/dopl-client/src/client-home.ts` + `meta-tools.ts`. The route already takes it. (H1)
4. **Widen `op=rooms action=update`** to accept `name` / `topic` / `archived`. The route accepts them; only the schema withholds them. (C1)
5. **Render the caller-relative channel facts that are already on the wire**: `myFavoritedAt`, `onlineMemberCount`, `agentOnline`, `workspaceRole`, `unaddressedResponder`. Zero new queries — every one of these is on a DTO the MCP client already receives. Highest information-per-line-of-code in this audit. (C3, C4, C9, C12)
6. **Decide the home-channel linking question** (H3/H5). This is a product ruling, not an oversight: minting a claim URL is a capability with a blast radius, and the schema's own docblock argues single-use links exist because "a URL that admits everyone it is forwarded to" was a real incident. Recommend **read-only first** (`linkOut` visible), mint behind a confirm-token like the publish ops already use.
7. **Credits/usage read** (H6). An agent that can be told `credits_exhausted` should be able to see it coming.
8. **Revisions** (K2) and **ontology grant** (O1) — both are sibling-tool asymmetries; `dopl_kb` and `dopl_agent` both have `grant`, `dopl_ontology` does not.

## §6 — Open for the prober (`@agent-fqv6bovk`) and for Samuel

- **P1** Does the live `summary` describe say "topic" or "description"? Confirms §0 end to end.
- **P2** Does `action=open` with `summary` still *write* the value even in the stale build? Code says yes; if the value lands and only the wording is behind, §0 is strictly a wording+echo gap.
- **P3** Does `op=rooms action=members` work against a home channel with `workspace=` passed? (H2)
- **P4** Anything reachable that this audit read as absent — favourites, presence, credits, revisions — is a **false negative here** and worth more than the rest of the document.
- **Q1 (Samuel)** Should an agent be able to mint a claim link into a home channel at all? (§5.6)
- **Q2 (Samuel)** Is `agentToolProfile` (C5) deliberately human-only, matching `agent_write_enabled` on skills?
- **Q3 (Samuel)** Is the intent that "description" becomes a first-class MCP argument, or that `summary` keeps carrying it? S2 turns on this.

## §7 — THE SILENT-FAILURE PATTERN (four instances, one day)

Four defects found 2026-09-15 share one shape: an action returned **successfully and did
nothing** — no error, no log, and in three of four the calling side reported success.

| what stayed quiet | how long | what found it |
|---|---|---|
| **Direction lane** — `orchestratorDirectEnabled` defaults OFF and its settings switch was never built (preload bridge present, no caller), so every private direction was dropped with no claim and no error. | **15 days**, 38 directions, 0 ever claimed | a dedicated tracer, after 3 re-sends were blamed on the recipient |
| **Tool-gate banner** — a windowless gate's ONLY surface is a macOS notification, and the dev Electron is absent from all 81 registered clients in `com.apple.ncprefs`, so none was ever displayed. | **10 min per gate**, expiring unanswered | an investigator asking why one agent was wedged |
| **Transcript query** — the render path is instrumented; what the query RETURNED is the half this machine does not log, so a row that never arrives leaves no trace. | still unlogged (instrumentation is an open yes/no) | elimination, after every deterministic render path was cleared |
| **Citation jump** — `jumpToSeq` returned early on an unloaded seq, setting no scroll target, so the pane's "older than the loaded history" notice could never fire. | **4 min** (`7f908261` → `a24c11cd`) | a status summary asserting a behaviour nobody had verified end to end |

**Candidate rule.** *A user- or agent-initiated action may fail loudly or succeed; it may
never return silently.* Absent-not-disabled already covers a capability that is MISSING;
this covers one that is present and does nothing.

**Why green suites miss it.** All four sat behind passing tests, and the fourth is the proof:
`message-markdown-refs.test.tsx` mounts the leaf and passes both props by hand, so it stays
green whether or not any host ever passes them. **Mounting the unit proves nothing about the
caller** — a silent return is invisible to every test that does not exercise the seam.
