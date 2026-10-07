> Historical snapshot (2026-09-23). Archived 2026-10-06 — may not match current code; see CLAUDE.md for precedence.

# Dopl live MCP dogfood and action-parity audit

**Date:** 2026-09-23  
**Repository:** `setup-intelligence-engine`  
**Live client:** Codex desktop connected to `https://www.usedopl.com/api/mcp`  
**Purpose:** Compare what a Dopl user can do in the product with what an external Codex agent can actually discover and do through the live MCP server.

## Executive result

The Codex integration is connected and the core loop works. The live server exposes the same 11 tools registered by the current code, plus two doctrine resources. A Codex client can discover containers, communicate in channels, launch/direct/manage agents, and author the main Dopl knowledge surfaces.

The product is not at full action parity. A UI-to-MCP inventory found **89 of 149 meaningful user outcomes covered (60%)**. Most missing outcomes fall into four groups:

1. **Actual regressions or omissions** — channel rename/description, revision history and restore, standard workspace creation, global-search coverage, typed identity fields, and two launch-context wires.
2. **Secondary management operations** — export, duplicate, star, layout, sharing, and recovery actions.
3. **Intentional human-control boundaries** — deletion, member/team administration, visibility and agent-write protections, billing/account controls, and machine-local orchestration consent.
4. **Discoverability/design debt** — 11 large domain tools multiplex about 86 operations through `op`/`action`, and the existing “parity” tests check schema/gate consistency rather than product action parity.

This is therefore a **working integration with material product-parity gaps**, not a broken MCP connection.

## What is live and exposed

### Tools

| Live MCP tool | Operations exposed to this Codex client |
|---|---|
| `dopl_workspaces` | list containers; create a home channel |
| `dopl_status` | account-wide channel/session/ask status |
| `dopl_map` | compact home/workspace/resource map |
| `dopl_search` | search knowledge entries, skills, ontology objects, and agent identities |
| `dopl_channel` | send, read, status, manage agents, manage rooms, manage artifacts |
| `dopl_kb` | list/read/search/create/update/grant/move knowledge bases, folders, and files |
| `dopl_skill` | list/get/read/write/create/update/visibility/authoring guide |
| `dopl_agent` | list/get/create/update/grant identity templates |
| `dopl_ontology` | map/resolve/get and create/update graph content |
| `dopl_members` | read membership, teams, and effective access |
| `dopl_chats` | export/append/update/list/get chats and manage folders |

### Resources

- `dopl://doctrine/channels`
- `dopl://doctrine/knowledge`

No resource templates are published.

### Live verification performed

- All 11 tools were present in the Codex tool registry.
- All read-only orientation calls succeeded against the live account: containers, status, map, current member, agent identities, skills, knowledge bases, ontology, chats, and channel rooms.
- The live schema matched the repository surface, including Codex runtime/model launch fields and the expanded runtime-native posture vocabulary.
- `Codex Testing` was visible, and the live status call reported both Codex and Claude agents there.
- A previous end-to-end live test launched/contacted a Codex agent and received the exact marker `DOPL_CODEX_OVERHAUL_OK_20260923` in the channel.
- Invalid missing operations such as skill duplicate, knowledge restore, and standard workspace creation were rejected by the live schemas, confirming they are truly absent rather than merely undocumented.
- The focused MCP invariants passed locally: **36/36** tests in the targeted parity/meta/strict-argument run. A broader tool-design pass also completed **180/180** relevant tests.

## Agent-native scorecard

| Principle | Score | Status | Interpretation |
|---|---:|---|---|
| Action parity | 89/149 (60%) | Partial | Core workflows work; management/recovery/admin gaps remain. |
| Tools as primitives | 12/16 (75%) | Partial | Strong contracts and errors; domain tools are heavily multiplexed. |
| Context injection | 11/16 (69%) | Partial | Good routing/security context; several production wires and freshness rules are missing. |
| Shared workspace | 14/16 (88%) | Excellent | UI and MCP generally use the same server records; machine-local settings are deliberately separate. |
| CRUD completeness | 1/15 complete entities (7%) | Needs work by strict definition | Only live agent sessions have a full lifecycle; app-only deletion makes every durable entity incomplete. Non-destructive operation coverage is much higher (about 67%). |
| UI integration | 6/8 major domains (75%) | Partial | Channels, knowledge, skills, ontology, and chats have realtime/refetch paths; identities/settings are weaker. |
| Capability discovery | 3/7 (43%) | Needs work | Tool descriptions are excellent for agents, but the product does not give users a coherent capability map. |
| Prompt-native features | 6/12 (50%) | Partial | Skills, identities, and doctrine are prompt-native; several quality/workflow decisions remain hard-coded. |

**Overall simple average: 58%.** The strict CRUD score is intentionally harsh because Dopl has chosen to keep deletion app-only. That policy is coherent, but it is still not action parity.

## Capability matrix

| Product surface | Strong MCP coverage | Missing or weaker than the UI |
|---|---|---|
| Containers/workspaces | Enumerate all reachable containers; create home channels | Create/update/delete standard workspaces, icon, invitations, join links/requests |
| Channels | List/open channels and DMs, invite, roster, send/read, artifacts, info card | Rename, edit description, visibility, leave/remove members, delete channel, mention inbox actions |
| Threads | Create by sending, read/list, change mode | Delete thread; UI-only thread lifecycle controls |
| Live agents | Launch Codex/Claude/Cursor, choose model/runtime/identity, status, direct, rename, posture, end | Machine-local defaults and orchestration consent correctly remain outside remote MCP |
| Knowledge | Core base/folder/file creation, reading, writing, moving, search, visibility and grants | Star, export/download, history/changelog, revision restore, delete, some human protection toggles |
| Skills | Strong authoring, body version CAS, metadata, visibility | Duplicate, export, history/version read, restore, delete, team-scoped sharing, post-create agent-write toggle |
| Agent identities | Core create/read/update/grant, runtime/model/knowledge attachment | Typed custom fields, team visibility, delete |
| Ontology | Most graph content reads and writes | History/restore, cluster/object delete, layout persistence, channel shares, agent-write toggle |
| Chats | Export, append, update, list/get, pin, folders | Delete chat/folder, team sharing; search is narrower than the app |
| Members/teams/access | Rich read-only roster and access inspection | Role changes, remove/deactivate member, team CRUD, team membership, grants/access writes |
| Search | Four MCP-native domains, cross-container fan-out | App search also covers channels, messages, threads, artifacts, members, and chats |
| Account/settings | Caller identity and access are readable | Profile edits, account lifecycle, billing, connector grants, desktop default runtime/model/posture |

## Prioritized tickets

### DMP-001 — Add channel name and description parity

**Priority:** P0  
**Type:** Defect/regression

The UI now edits both fields through `PATCH /api/channels/{id}` in `src/features/channels/hooks/use-channel-header-writes.ts`. The MCP handler still says the UI cannot edit them and restricts `rooms.update` to the info card in `packages/mcp-server/src/tools/channel-ops-update.ts`.

**Objective:** Let an authorized agent reach the same channel name and description outcome as a channel manager in the UI.

**Recommended design:** Add explicit `rooms.rename` and `rooms.describe` actions, or extend `rooms.update` with a discriminated patch. Do not silently accept global-schema fields that the selected operation ignores.

**Acceptance criteria:**

- A manager-capable MCP credential can rename a channel and edit its description.
- A non-manager receives a named authorization refusal.
- The live result returns the canonical channel id, name, description, and version/update time.
- Schema tests prove each field is either acted on or rejected for every operation.
- A natural-language Codex test changes the `Codex Testing` description and the open UI updates through realtime.

### DMP-002 — Expose history and restore across durable content

**Priority:** P0  
**Type:** Missing recovery capability

The app supports history and restore for knowledge, skills, and ontology. MCP exposes none of those outcomes even though several restore routes are already agent-auth reachable.

**Objective:** An agent can inspect changes, read a selected version, and restore it without asking a human to operate the UI.

**Acceptance criteria:**

- Knowledge entries: list revisions, read revision, restore revision.
- Skills: list history, read version, restore version.
- Ontology objects/clusters: list revisions and restore revision.
- Restore is CAS/version-safe and returns the new current version.
- Every restore has a preview or explicit old/new summary before the write.
- UI changelog panels update after an MCP restore.

### DMP-003 — Add a real product-action parity manifest and CI gate

**Priority:** P0  
**Type:** Prevention

The existing parity suites are excellent at schema/handler/write-gate consistency. They do not compare product routes or visible UI actions with the MCP surface, which is why the channel-header regression and recovery gaps can coexist with green parity tests.

**Objective:** Every meaningful authenticated product action is explicitly mapped to an MCP operation or an intentional human-only classification.

**Acceptance criteria:**

- A checked-in manifest maps action → UI location → API route → MCP tool/op → policy classification.
- CI fails when a new non-internal route or UI mutation has no manifest row.
- Allowed classifications are `covered`, `human-only`, `app-only-destructive`, `machine-local-security`, and `not-user-facing`.
- Human-only rows require a reason and owner, not just `N/A`.
- The manifest includes read parity and search/discovery parity, not only writes.

### DMP-004 — Bring MCP search up to the app’s search surface

**Priority:** P0  
**Type:** High-impact read gap

The UI global search declares nine groups: channels, messages, threads, artifacts, knowledge, identities, members, skills, and chats. `dopl_search` searches only four groups: knowledge entries, skills, ontology objects, and identities.

**Objective:** An agent can find the same operational history a user can find from the search popup.

**Acceptance criteria:**

- Add channel, message, thread, artifact, member, and chat groups, or provide a separately named operational search tool.
- Preserve the existing membership and container-lock fences.
- Results include canonical follow-up addresses (`channel`, `seq`, `thread`, entity id).
- Search descriptions state which fields are indexed and which are not.
- A marker posted in `Codex Testing` is findable from Codex without manually paging every channel.

### DMP-005 — Wire the two missing launch-context fields

**Priority:** P0  
**Type:** Production wiring defect

The prompt renderer supports `agentName`, but production context refresh only writes `agentId`. The roster helper can exclude the operator using `selfUserId`, but the New Agent, responder, and directive launch lanes do not supply it.

**Objective:** A launched agent reliably knows its chosen name, and the room roster does not misclassify or duplicate its operator.

**Acceptance criteria:**

- The final unique agent name is present before the first model turn.
- Every production launch lane supplies the signed-in user id centrally.
- Tests use production-shaped launch payloads rather than manually complete renderer fixtures.
- A live Codex agent can accurately state its display name and distinguish the operator from peer members/agents.

### DMP-006 — Expose standard workspace lifecycle operations

**Priority:** P1  
**Type:** Missing core container capability

`dopl_workspaces` supports only list and `create_home_channel`; the product supports standard workspace create/update/delete and related management.

**Objective:** Cover non-destructive workspace creation and rename first; make delete a separate policy decision.

**Acceptance criteria:**

- MCP can create a standard workspace and update its name/description when caller policy permits.
- The result returns its canonical id, slug, kind, and role.
- Delete stays app-only until a separate confirmed-delete design is approved.
- Container-lock behavior is tested for every new operation.

### DMP-007 — Add secondary knowledge and skill operations

**Priority:** P1  
**Type:** Product parity

**Scope:** knowledge star/unstar, export, changelog; skill duplicate, export, history/version read. Restore is tracked in DMP-002.

**Acceptance criteria:**

- Operations use user vocabulary and return a stable id/address.
- Downloads produce an MCP resource or a safe artifact link rather than assuming a browser download.
- Duplicate returns the new slug/id and does not silently overwrite.
- Star remains explicitly per-user.

### DMP-008 — Complete ontology governance parity

**Priority:** P1  
**Type:** Product parity

**Scope:** layout persistence, channel sharing/unsharing, and `agentsMayEdit`; revision restore is DMP-002 and deletion remains a policy decision.

**Acceptance criteria:**

- Sharing uses the same three-level vocabulary and authorization service as the app.
- Agent-write protection cannot be weakened by an untrusted spawned session.
- Layout updates are separate from semantic graph updates.
- Every response identifies the affected cluster/object and effective audience.

### DMP-009 — Support typed identity fields and team visibility

**Priority:** P1  
**Type:** Schema parity

The UI supports text, number, date, boolean, and URL identity fields. MCP publishes only `{key, value}` string pairs.

**Acceptance criteria:**

- MCP field schema carries the same type vocabulary as the product.
- Existing string fields round-trip without migration loss.
- Validation errors name the field and expected type.
- Team visibility/grants use the existing access resolver rather than a second policy implementation.

### DMP-010 — Decide and document protected admin/destructive boundaries

**Priority:** P1  
**Type:** Product/security decision

Deletion and membership/team/access writes are deliberately absent. This is coherent but should be represented as explicit product policy rather than an accidental-looking gap.

**Recommended policy:**

- Keep account deletion, billing, orchestrator consent, credential grants, and machine-local defaults human-only.
- Keep destructive domain deletes app-only unless Dopl adopts preview + one-time confirmation tokens + narrow authorization + audit logging.
- Consider safe, reversible member/team operations separately from deletion; do not treat all administration as one risk class.

**Acceptance criteria:**

- Every protected action has a documented classification and threat rationale.
- Agent replies point to the exact app location and do not encourage retrying with different arguments.
- No remote MCP operation can enable its own launch/direct-agent consent or widen its own tool permissions.

### DMP-011 — Define context freshness and failure semantics

**Priority:** P1  
**Type:** Reliability

Identity, roster, knowledge scope, and ontology reach are captured at launch. Some failures are disclosed, while ontology failure currently collapses to an empty result.

**Acceptance criteria:**

- Each context class is labeled `frozen for session`, `refreshed on resume`, or `live via MCP`.
- Failure is distinguishable from confirmed-empty.
- Access/version failures trigger one bounded refresh path.
- Dead `liveAgents`/`posture` boot fields are either wired from trusted server state or removed.

### DMP-012 — Improve capability discovery for users and agents

**Priority:** P2  
**Type:** Discoverability

The MCP descriptions are unusually good, but the user-facing product mostly teaches connection, not what a connected agent can accomplish or what remains human-only.

**Acceptance criteria:**

- Settings/Connect shows a concise capability list and protected-boundary list.
- Empty states include one or two copyable example prompts where useful.
- A generated capability reference is derived from the same manifest as DMP-003.
- `dopl_channel` help remains available, and other large domains gain operation-specific help.

### DMP-013 — Reduce conditional-schema ambiguity in high-frequency tools

**Priority:** P2  
**Type:** Tool design

Eleven domain tools multiplex roughly 86 capabilities. This keeps the initial tool list small but makes selection and validation depend on large flat schemas and runtime `missingParams` checks.

**Recommended first split:** expose clear primitives for channel send, read, launch, direct, and status, or publish discriminated operation schemas if the MCP/client stack supports them. Preserve the domain tools as compatibility aliases during migration.

**Acceptance criteria:**

- High-frequency operations are discoverable from tool names or operation-specific schemas.
- Parameters irrelevant to a selected operation are rejected, never ignored.
- Deferred loading/tool-profile behavior remains within the current context budget.

### DMP-014 — Move knowledge authoring quality from hard refusal to guidance

**Priority:** P2  
**Type:** Prompt-native design

Knowledge writes currently hard-refuse some agent-authored documents based on excerpt/heading quality. Those are authoring judgments, not storage-integrity rules.

**Acceptance criteria:**

- Structural/security validation remains enforced in code.
- Quality rules move to the knowledge doctrine/authoring prompt where possible.
- Marginal content returns a warning and suggested improvement rather than being rejected, unless it would be unsafe or unreadable by contract.

## What is working especially well

1. **Live Codex transport and launch path work.** The previous connection/launch defect is no longer the central problem.
2. **Authorization is fail-closed.** Write operations are explicitly classified, container locks are threaded through discovery, and unknown fields are rejected.
3. **Error and result quality are strong.** Calls generally return canonical ids, versions, next-step guidance, and bounded refusals.
4. **The shared-data architecture is sound.** MCP and UI operate on the same server resources; realtime/refetch exists for channels, knowledge, skills, ontology, and chats.
5. **Dopl teaches agents well.** Tool descriptions, status footers, channel doctrine, knowledge doctrine, untrusted-data fencing, and caller/container provenance are unusually mature.

## Recommended execution order

1. DMP-001 channel name/description.
2. DMP-005 launch-context wiring.
3. DMP-003 product-action parity manifest and CI gate.
4. DMP-002 history/restore.
5. DMP-004 search parity.
6. DMP-006 standard workspace create/update.
7. DMP-007 through DMP-009 domain parity.
8. DMP-010 policy decisions.
9. DMP-011 freshness semantics.
10. DMP-012 through DMP-014 discovery/tool-design/prompt-native improvements.

## Audit limitations

- The live audit intentionally avoided destructive writes and account/admin changes.
- A proposed live channel-update probe was not executed because it could have mutated the test channel; the mismatch is conclusively visible in the UI and MCP handlers.
- Three secondary architecture reviewers hit the Codex account’s agent-usage ceiling. Their assigned UI/shared-workspace/CRUD checks were completed locally from the same code inventory; the completed action-parity, tool-design, and context reviews are independently scored above.
- “Covered” means an agent can reach the same user outcome, not necessarily through an identically named operation.

