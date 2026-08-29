# MCP SURFACE V2 — the whole /home space, from an agent — Scoping Plan

**Repo:** Dopl · branch `master` · HEAD `6d996ec5` · desktop `1.21.0` · verified against the tree 2026-08-28.
**Status:** ⚠ **BUILT IN FULL 2026-08-28 — WAVE A THEN WAVE B.** All thirteen §12 questions are
RULED and every ruling that produced code has shipped (see that section's header). This document was
SCOPING ONLY until then; the paragraphs below §12 are the DESIGN as scoped and are **not** a
description of the shipped tree.

- **Wave A:** `dopl_agent` + `dopl_agent_admin` (§5 minus `op="share"`), `shelf` on `dopl_kb`
  (§6.2), the confirm class (§7.3 (ii)), `dopl_search`'s templates group (§4.4).
- **Wave B:** `dopl_home` (§3.2), `dopl_search(scope="everywhere")` with per-leg billing (§4.2–4.3),
  `dopl_channel(op="update")` for `infoCard` ONLY (Q12), and §6.1's shelf sibling key on BOTH list
  surfaces — knowledge and templates.

**What is still NOT built, and each is a RULING rather than a gap:** an agent may not share an
existing KB into a channel (Q5), there is no shelf MOVE (Q8), no MCP delete of anything (Q9), and
`name`/`topic`/`archived` do not come to MCP (Q12 — F-346 holds that hole open deliberately).

⚠ Re-derive the live surface from `server.ts › createServer`'s register calls minus
`gating.ts › HIDDEN_TOOLS`, never from this document.
**Precedent build:** `docs/specs/home-knowledge-panels.plan.md` (M0–M5 shape, the audience-ceiling
argument, the adversarial-pin culture) and `docs/specs/home-agents-tab.plan.md` (the /home template face).
**Depends on / touches:** F-323 (agent-authored container KB), F-327 (one-channel-per-container
unenforced — every design here takes the SET of a container's channels), F-329 (B1 is a strong
tripwire, not a fence — this plan does not close it and does not pretend to), F-333 / F-336 (the
credential-audience split this plan builds on), F-342 (the three unfiltered shelf readers, and the
absence of a MOVE affordance), F-343 (/home cannot tell a member from a guest inside a container).

## Samuel's ruling — the product goal, restated

Build out the ENTIRE Dopl MCP surface so a user's agent can do EVERYTHING the personal (/home) space
offers without the user ever opening the desktop app: fully create and manage agents and agent
templates (personal shelf AND shared-into-channel), fully create and edit knowledge (bases, files,
folders, rename, content). Four requirements, each of which is a section below:

1. **Clear addressing** (§3) — personal space and individual workspaces are distinct tooling
   contexts; a user may be in several workspaces or none; the tooling must make it obvious where
   things live.
2. **Deduction / find** (§4) — the user says "that knowledge base about X" and it could live in any
   scope; the agent must be able to FIND it across the scopes it may see.
3. **Context-bleed safety** (§8) — workspace data must not leak across scopes; the isolation model is
   explicit and enforced.
4. **Ambiguity protocol** (§7) — when placement or target is unclear the agent confirms or refuses,
   and that is DESIGNED INTO THE TOOL SURFACE, not left to prompting.

---

## 0. Corrections to the brief (measured, not assumed)

Five things the brief assumes are not what the tree does, and three of them change the design.

1. 🔒 **THE HOME-SHELF FENCE IS NOT A WALL BETWEEN MCP AND THE PERSONAL SHELF, AND THE BRIEF'S
   HARDEST QUESTION MOSTLY DISSOLVES.** `src/features/knowledge/server/service-base-writes.ts ›
   resolveHomeScope` and `src/features/agent-templates/server/service-writes.ts ›
   resolveTemplateHomeScope` ask **`isSharedCredential`**, not "is this an agent". Per
   `src/shared/auth/credential-audience.ts › isSharedCredential`, an ordinary unlocked device/OAuth
   token has **no** `apiKeyWorkspaceId`, so it answers **false** — it is a person-standing credential
   and passes condition 1 today, unchanged. **The reason MCP cannot write the personal shelf is not
   the fence. It is that `homeScoped` is not on the wire at all** — the string appears NOWHERE under
   `packages/` (re-derive: `grep -rn homeScoped packages/`), so neither the tool schema nor
   `@dopl/client` can send it. Condition 3 (the caller's own default standard workspace) does the
   rest of the work on its own. **Consequence: closing this gap is plumbing plus a fence RE-STATEMENT,
   not a fence relaxation** — see Q4 for the one credential class where it really is a relaxation.
2. 🔒 **THE HARD REFUSAL IS THE GRANT, NOT THE SHELF.**
   `src/features/knowledge/server/service-channel-grants.ts › setChannelKnowledgeGrant` refuses
   `ctx.source === "agent"` OUTRIGHT, and `service-shared.ts › buildKnowledgeContext` derives
   `source: auth.agentTokenId ? "agent" : "user"` — **every MCP caller is an agent, by construction.**
   So "share this base into that channel" is the one /home capability with a live, deliberate,
   credential-independent refusal in front of it (INVARIANTS §4A, 2026-08-27). Q5 is that fence.
3. **"FULLY CREATE AGENTS" IS THREE DIFFERENT GAPS AND ONLY ONE OF THEM IS MISSING MACHINERY.**
   (a) *Author a template* — `POST/PATCH /api/agent-templates` are **NOT `sessionOnly`** and floor at
   `member` (INVARIANTS §5A: "an orchestrator agent LISTING templates is the point"), so an agent
   token already reaches them over HTTP; **there is simply no MCP tool** (`server.ts › createServer`
   registers no template registrar). (b) *Launch one* — `dopl_channel(op="launch_agent")` already
   files a `channel_launch_directives` row and resolves the template server-side. (c) *Run one* — the
   server starts nothing and cannot; a machine claims the directive. **(a) is the whole build; (b) is
   an addressing problem; (c) is out of scope and must stay stated.**
4. ⚠ **`dopl_channel` PUBLISHES 14 OPS, NOT 15** — measured 2026-08-28 by reading
   `packages/mcp-server/src/tools/channel-schema.ts › CHANNEL_INPUT_SHAPE`'s `op` options:
   `list, open, invite, post, milestone, read, await, members, list_threads, get_thread,
   read_sessions, create_thread, set_thread_mode, launch_agent`. INVARIANTS §10 says 14 and is right.
5. **`sessionOnly` re-measured 2026-08-28: `grep -rl "sessionOnly: true" src/app/api --include=route.ts | wc -l` → 27** —
   agrees with INVARIANTS §3's stamped 27. ⚠ **Drop the `--include=route.ts` and the answer is 31**
   (test files). Run the documented command, not a paraphrase of it.

6. 🚫 **"WITHOUT EVER OPENING THE DESKTOP APP" HAS A HARD FLOOR, AND IT IS NOT NEGOTIABLE BY THIS
   SURFACE.** The server starts nothing and cannot reach a desktop main process (INVARIANTS §11:
   "the table is a MAILBOX, not a command"). Worse for the goal as stated: the consent for the whole
   lane is a per-machine `electron-store` boolean, `dopl-desktop-app/main/channel-prefs.js ›
   getOrchestratorLaunch` (`orchestratorLaunchEnabled`), **default FALSE**, read at decision time and
   reachable from one `appWindowOnly` IPC pair — from no route, no op and no column. **So an agent
   can author everything and still launch nothing until the operator has, once, opened the app and
   turned it on.** That is a product fact the surface must SAY, not a gap to close: everything below
   is "author and manage without the app"; RUNNING an agent still needs a machine that has opted in.
   ⚠ And `no-bridge` has **two producers** — the toggle being off (silent, no server write at all)
   and `launch-directives.js › spawn` finding the machine is not watching that channel — so the MCP
   sentence naming the toggle is right about one of them and incomplete about the other.
7. ⚠ **THE LAUNCH-DIRECTIVE MIGRATION HEADERS SAY "WRITTEN, NOT APPLIED" AND INVARIANTS SAYS APPLIED
   — READ §12, NOT THE FILE.** `supabase/migrations/20260822160000_channel_launch_directives.sql`
   opens `⚠️ WRITTEN, NOT APPLIED`; INVARIANTS §12 re-measured all three of that wave's files APPLIED
   on 2026-08-24, joined on the NAME, and §5A re-measured the template one again on 2026-08-26. **The
   header is stale prose, and this is F-304's re-stamp trap for the third time.** Deploy state is a
   measurement: re-derive with `supabase migration list` (or MCP `list_migrations`) **joined on the
   name**, never on the filename, before anything in §10 depends on the table.
8. **"FILES" IN THE BRIEF MEANS MARKDOWN ENTRIES. There is no file UPLOAD anywhere in the product** —
   no `type="file"`, no `FormData`, no drop zone under `src/features/knowledge/components`
   (`knowledge-v2/list/tree-rows.tsx` says "No drag-drop, by design"), and `dopl_kb(op="write_file")`
   takes a markdown string. **So MCP is not behind the UI on files; both surfaces have the same
   capability**, and "fully create knowledge files" is already true today (§6.6).

Also verified and load-bearing below: `POST /api/home/channels` is **not** `sessionOnly` (an agent
token may already create a home channel) while `POST /api/home/links` **is** (minting a credential
that reaches a PERSON is the line) — INVARIANTS §4A, Samuel's rulings 2026-08-24. The link's other
two writes are `sessionOnly` too: `DELETE /api/home/links/[linkId]` (revoke) and
`POST /api/home/link/[token]/claim` (whose outcome is a workspace MEMBERSHIP).

---

## 1. Current state — the whole surface, measured

### 1.1 The 14 tools and where each op's scope comes from

Registration is `packages/mcp-server/src/server.ts › createServer` minus `gating.ts › HIDDEN_TOOLS`
(empty). 12 domain tools through `registrar.ts › registerTool`, 2 meta through `› registerMetaTool`.
Read-only sessions see 10 (`gating.ts › READ_ONLY_BLOCKED_TOOLS`).

| Tool | Ops | Scope arg | Floor | Notable gate |
|---|---|---|---|---|
| `dopl_kb` | 12 (`list_bases get_tree list_dir read_file search create_base update_base create_folder move_folder write_file move_file set_visibility`) | injected `workspace` | viewer read / member write | `AGENT_WRITE_DISABLED`; `set_visibility` is **public-only, one-way** |
| `dopl_kb_admin` | 3 delete ops | ″ | — | **every op refused** |
| `dopl_skill` | 8 | ″ | viewer / member | `set_visibility` takes BOTH values here (unlike `dopl_kb`) |
| `dopl_skill_admin` | 1 | ″ | — | refused |
| `dopl_chats` | 9 | ″ | viewer / member | entitlement-gated export/append |
| `dopl_chats_admin` | 2 | ″ | — | refused |
| `dopl_ontology` | 18 | ″ | viewer / member | — |
| `dopl_ontology_admin` | 2 | ″ | — | refused |
| `dopl_channel` | 14 | ″ + `channel` | guest on 8 ops | `launch_agent`'s seven refusal words |
| `dopl_members` | 7, READ-ONLY | ″ | membership | email admin-or-self |
| `dopl_map` | none (no `op`) | ″ | viewer | 3-domain manifest of ONE workspace |
| `dopl_search` | none (no `op`) | ″ | viewer | ONE workspace; no chats/members/channels |
| `list_workspaces` | none | **NONE** (user-scoped) | — | uncharged; **standard workspaces only** |
| `current_workspace` | none | **NONE** | — | uncharged |

### 1.2 The addressing machinery, in one paragraph

`registrar.ts › WORKSPACE_ARG_SHAPE` injects an optional `workspace` (slug or UUID) into EVERY domain
tool's schema; provided → `directory.resolveWorkspaceRef(ref)` then the handler runs inside
`workspaceContext.run(id, …)` so loopback requests carry `X-Workspace-Id`; blank → refused (distinct
from omitted, deliberately); omitted → the boot-resolved session default, or
`workspace-directory.ts › noWorkspaceError` when the caller has 0 or 2+ memberships. **One workspace
per call, always.** `workspace-directory.ts › getWorkspaceList` filters through
`isStandardWorkspace` — so a `kind='link'` home-channel container is **never listed** — while
`› resolveWorkspaceRef` deliberately resolves against the UNFILTERED directory, which is what makes a
container addressable at all. That asymmetry is the container door, and it is the load-bearing fact
of §3.

### 1.3 The audience ceiling and the credential axes (INVARIANTS §4/§10)

- **B1, the credential lock** — `mcp_tokens.workspace_id` → `apiKeyWorkspaceId` →
  `withWorkspaceAuth`'s 403. Minted by `src/shared/auth/mcp-container-token.ts › issueContainerToken`
  when the desktop spawns into a container WITH A PEER. 🔒 FENCE (workspace axis only). Residual #3
  keeps F-329 open; this plan does not close it.
- **`workspace_lock_kind`** — a SEPARATE axis read only by
  `src/shared/auth/credential-audience.ts › isSharedCredential`. Arms: no lock ⇒ false;
  `CONTAINER_SESSION_LOCK` ⇒ false; **anything else or unknown ⇒ true (fail-closed)**.
- **Layer A, the grant fence** — `src/features/knowledge/server/service-audience.ts ›
  resolveAgentAudience`. Agent + `kind='link'` + >1 active member ⇒ reachable iff a
  `channel_resource_grants` row on one of the container's channels. It can only ever CLOSE.
- **B3, the directory lock** — `factory.ts › bootServer` passes `lockedTo` into
  `createWorkspaceDirectory`. ⚠ TRIPWIRE, one connection's view.
- **Guest metering** — the credit charge (`registrar.ts › createCreditedRunner`) floors at `guest` on
  `POST /api/mcp/credits/consume` precisely because `charge()` fails open; a 403 there made guest tool
  calls FREE (F-325). Container burn reroutes to the container owner's oldest-owned standard
  workspace (`billing/server/credits-service.ts › resolveBillingTarget`).

### 1.4 The gap — what /home does that MCP cannot

| /home capability | HTTP route | Agent-token reachable? | MCP tool today |
|---|---|---|---|
| List my home channels | `GET /api/home/channels` (`withUserAuth`) | ✅ yes | ❌ **none** |
| Create a home channel | `POST /api/home/channels` | ✅ yes (NOT `sessionOnly`) | ❌ **none** |
| Mint / revoke an invite link | `POST/DELETE /api/home/links` | ❌ `sessionOnly` | ❌ none (and must stay) |
| List the PERSONAL knowledge shelf | `GET /api/knowledge/bases?shelf=home` | ✅ yes | ❌ `list_bases` sends no `shelf` |
| Create a base ON the personal shelf | `POST /api/knowledge/bases` `{homeScoped:true}` | ✅ yes | ❌ `create_base` sends no `homeScoped` |
| Create a base shared INTO a channel | same route, grant written in the same call | ❌ agent refused at `setChannelKnowledgeGrant` | ❌ |
| Set a `(kb, channel)` grant | `PUT …/channel-grants` | ❌ `sessionOnly` **and** agent-refused | ❌ |
| Knowledge files/folders/rename/content | `dopl_kb` write ops | ✅ | ✅ **already complete** |
| Delete a base / folder / entry | app-only | ❌ by policy | ❌ refused, permanently |
| List / read agent templates | `GET /api/agent-templates` | ✅ (not `sessionOnly`) | ❌ **none** |
| Create / edit a template | `POST/PATCH /api/agent-templates` | ✅ `member`+ | ❌ **none** |
| Template on the PERSONAL shelf | same, `{homeScoped:true}` | ✅ (fence passes for a device token) | ❌ |
| Share a template into a channel | same, `{visibility:"workspace"}` in the container | ✅ | ❌ |
| Delete a template | `DELETE …/[templateId]` | ❌ `sessionOnly` | ❌ |
| Star / unstar a base | `PUT/DELETE …/bases/[baseId]/star` (`viewer` — a personal bookmark) | ✅ | ❌ none |
| Export a base / folder / entry | `GET …/export` | ✅ | ❌ none |
| Teams access mode + agent-write toggle | `PATCH …/bases/[baseId]` | ✅ (teams create is agent-refused) | ❌ none |
| Curate a channel's Info card | `PATCH /api/channels/[channelId]` `{infoCard}` — documented **agent-writable, membership-gated, deliberately not `sessionOnly`** | ✅ | ❌ none — and `@dopl/client` has no channel-update method at all |
| Archive / unarchive a channel | same route | ✅ | ❌ none |
| **Rename a channel** | same route accepts `name`/`topic` | ✅ | ❌ none — **and no UI exposes it either** (§1.5) |
| Change channel visibility | same route | ❌ field-level `SESSION_ONLY_FIELDS = ["visibility"]` | ❌ |
| Delete a home channel | `DELETE /api/channels/[channelId]` (`member`) | ✅ | ❌ none — and /home suppresses the control (`relationship-record.tsx` passes `memberManagement: false`) |
| Upload a binary file | — | — | — **exists nowhere; see §0.8** |
| Launch an agent into a channel | `POST /api/channels/launch-directives` | ✅ | ✅ `dopl_channel(op="launch_agent")` — ⚠ inert until the operator's desktop opts in (§0.6) |
| Find something across scopes | — | — | ❌ **impossible** (§4) |

**Read the table as four findings.** (i) Knowledge CONTENT authoring is already done — the gap is
SHELF ADDRESSING, not CRUD, and file upload is not a gap because it exists nowhere. (ii) Templates are
entirely absent from MCP although the HTTP surface was built to be agent-reachable. (iii) Three
capabilities are refused ON PURPOSE (links, grants, deletes) and the first must stay refused.
(iv) **A cluster of channel-MANAGEMENT writes are agent-reachable, unreached by MCP, and in one case
unreached by any UI either** — rename is accepted by the route and exposed by nothing. → Q12.

⚠ **The build is larger than a tool file.** `grep -rn "api/home\|home_scoped\|shelf" packages/`
returns **zero hits**: `@dopl/client` has no home module, no shelf param and no template module.
Every op below needs an SDK method beside its tool, and `packages/*/dist` must be rebuilt or the old
surface ships.

### 1.5 The two launch lanes, and why only one of them is MCP's

Nothing in `apps/desktop-ui/**` writes a launch directive. The **UI lane** goes
`channels-v2/agents-tab.tsx` → `channels-v2/agents-controls.ts › launchAgentOnThread` → the Electron
IPC bridge → `dopl-desktop-app/main/session-engine.js › launchRequesterSession`, and the row it
eventually records is a `channel_sessions` projection the desktop PUSHES. The **directive lane** is
MCP's alone: `dopl_channel(op="launch_agent")` →
`src/features/channels/server/service-launch.ts › createLaunchDirective` → a row the operator's
desktop claims (`dopl-desktop-app/main/launch-directives.js`) and decides with one of seven words.

Three consequences the design must carry:

1. **A directive is an ASK with a bounded hold** (`wait_ms` default 15s, cap 30s). A timeout is a
   PENDING directive, never a failure, and re-issuing starts a SECOND agent nothing can tell apart
   afterwards.
2. **Presence short-circuits before any row exists** — an offline operator gets a 200 with
   `offline: true` and no row filed.
3. 🔒 ⚠ **THE TWO LANES DO NOT CARRY THE SAME HUMAN CHECK, AND THE ASYMMETRY MATTERS THE MOMENT
   TEMPLATES BECOME AGENT-AUTHORABLE.** The button lane raises a first-run `template-approval` prompt
   for a template ANOTHER MEMBER wrote (`main/session-launch-op.js`); the directive lane has no such
   gate — the standing toggle is its whole consent. ⚠ `'template-approval'` is IPC-only and INVARIANTS
   §5A forbids it ever entering the `refusal_reason` CHECK, "because a column that could store it
   would tell a future reader this lane has an approval gate it does not have". Once §5 lets an agent
   AUTHOR and SHARE a template into a container, a peer's directive-lane launch of that template
   reaches their machine with no first-run prompt. → **Q13.**

---

## 2. Design principles this surface commits to

1. **ONE OP, ONE UNAMBIGUOUS PLACE.** Every write names its scope or is refused. Absent scope may
   never widen (`route.ts › readShelf`'s precedent: an unrecognized `?shelf=` is a **400**, because a
   misspelled `?shelf=hom` would otherwise answer the WIDER list).
2. **A READ MAY BE WIDE ONLY IF EVERY ROW CARRIES ITS PROVENANCE.** Never a merged blob. This is how
   §4 satisfies requirement 2 without violating requirement 3.
3. **FAN-OUT IS N ORDINARY FENCED CALLS, NEVER ONE WIDENED QUERY.** No new read path, no new fence,
   nothing to get wrong twice.
4. **NEVER PICK.** `service-resolve-ref.ts › resolveTemplateRef` is the shipped precedent: an
   ambiguous name is REFUSED with every match listed. Generalized in §7.
5. **A CONFIRM AFFORDANCE IS A TRIPWIRE, NOT A FENCE — and the two are never dressed as one.** The
   fences stay `sessionOnly`, the `source === "agent"` refusals, B1, and layer A.
6. **NEW OPS ON EXISTING FAMILY TOOLS WHERE A FAMILY EXISTS.** New tools only for genuinely new
   nouns (§9).

---

## 3. The addressing model

### 3.1 The correction that makes the whole section work: **"personal" is TWO things**

`/home` composes two structurally different stores and the tool surface must not blur them:

- **A HOME CHANNEL** is a hidden `kind='link'` **workspace** (a container) holding one channel and
  one-or-more members (INVARIANTS §4A). It is a TENANCY. It is addressable today via `workspace=`.
- **THE PERSONAL SHELF** is the `home_scoped = true` rows inside the caller's own **default standard
  workspace** (`workspaces/server/repository.ts › findDefaultWorkspaceForUser`, the same lookup
  `POST /api/boot` runs). It is NOT a tenancy — it is a SHELF, a `WHERE` over one workspace's rows.

So the two axes are orthogonal and each gets its own argument. **Conflating them into one `scope`
enum is the trap** — it would make "personal" mean a workspace in one op and a filter in another, and
that is exactly the confusion requirement 1 exists to kill.

| Axis | Argument | Values | Absent means |
|---|---|---|---|
| **Tenancy** | `workspace` (existing, injected) | slug or UUID, standard **or** container | session default, or REFUSE (unchanged) |
| **Shelf** | `shelf` (NEW, knowledge + templates only) | `"personal"` \| `"workspace"` | see 3.3 — and it differs for reads and writes |

`shelf` is spelled to MIRROR `GET /api/knowledge/bases?shelf=` and `GET /api/agent-templates?shelf=`
**value for value**, so the tool arg and the HTTP param cannot drift apart. ⚠ The HTTP param uses
`home`; the tool arg uses **`personal`**, because that is the operator-facing noun the /home face
settled on (INVARIANTS §5A: "Private" was relabelled **Personal**, 2026-08-27). The client maps one to
the other in ONE place; a second mapping is how they drift. → **Q1** if Samuel prefers `home` on both.

### 3.2 How a container becomes addressable — `dopl_home`, and why NOT `list_workspaces`

A container is unlistable by design: `getWorkspaceList` filters through `isStandardWorkspace` and
INVARIANTS §4A forbids advertising a container as a workspace anywhere. **Do not loosen that
predicate** — it is a positive test precisely so a future `kind` cannot leak in (F-295), and four
consumers share it.

Instead, a new **user-scoped meta-ish tool `dopl_home`** answers containers as what they ARE to the
user — home channels, not workspaces:

- `op="list_channels"` → over `GET /api/home/channels`. Each row renders: channel name, the
  **container workspace id** (the handle every other tool takes as `workspace=`), the channel id, the
  peer roster, and whether the caller is alone in it.
- `op="create_channel"` → `POST /api/home/channels` (already agent-reachable, NOT `sessionOnly`).
- 🚫 **NO link mint op, ever.** `POST /api/home/links` is `sessionOnly` because it mints a credential
  that reaches a PERSON. An MCP op here would be a request to remove that gate.

🔒 **`dopl_home` MUST RESPECT B3.** `factory.ts › bootServer`'s `lockedTo` narrows
`getWorkspaceList`/`resolveWorkspaceRef`; a new tool that reads `/api/home/channels` directly would
hand a locked session the ids of its operator's OTHER containers and void the lock's whole point.
**The lock must be threaded into this tool and the list filtered to `[lockedTo]`** — stated here
because it is the single easiest way to regress the tripwire, and `container-lock.test.ts` must gain
a case for it.

⚠ **It cannot be a META tool** (`registerMetaTool`) even though it is user-scoped: meta tools are
uncharged BY DECISION because they are how a lost agent finds out where it is, and this one both
READS content-adjacent data and WRITES. It registers through `registerTool` with **no** `workspace`
arg — which the current registrar cannot express (the arg is unconditionally injected). → **Q2**.

### 3.3 The absent-argument rule, stated per direction

| Op class | `shelf` absent | Rationale |
|---|---|---|
| **READ** (`list_bases`, template `list`) | BOTH shelves, **every row shelf-labelled** | F-342 rules the unfiltered MCP read RIGHT and says it "must stay right": an operator's agent asking "what knowledge is here" should see the operator's whole workspace. Principle 2 makes the width safe. |
| **WRITE** (`create_base`, template `create`) | `workspace` shelf | `resolveHomeScope`'s "THE DEFAULT IS FALSE AND SILENT" — every existing caller keeps writing workspace-shelf rows with no new failure mode. Absent picks the NARROWER, already-live default; it never widens. |
| **Unrecognized value** | **REFUSE**, naming both legal values | `readShelf`'s 400. |

⚠ **The asymmetry is deliberate and must be written into the op description**, or an agent reads
"absent = both" from the list op and expects it on create.

---

## 4. Find / resolve across scopes

### 4.1 What is impossible today, precisely

`dopl_search` takes `query` + `limit` and the injected `workspace`. It searches ONE workspace's
knowledge entries, skills and ontology objects. Containers are unlistable, so an agent cannot even
ENUMERATE the scopes to loop over; templates and channels are not searched by anything; `dopl_map` is
likewise one workspace. **"That knowledge base about X" is unanswerable across scopes today.**

### 4.2 The proposal — `dopl_search` gains a `scope` argument

`scope: "here" | "everywhere"`, default **`"here"`** (byte-identical to today's behaviour for every
existing caller).

`"everywhere"` fans out over the caller's real reach:

```
legs = getWorkspaceList()                      // standard memberships, isStandardWorkspace-filtered
     ∪ dopl_home list_channels → container ids  // the caller's home channels
     — both narrowed to [lockedTo] when B3 is armed
```

and issues **one ordinary, already-fenced search per leg**, each inside that leg's own
`workspaceContext.run(...)`. Results render under a per-scope heading:

```
## Acme (workspace · slug `acme-x7q2` · id `…`)
### Knowledge entries
- …
## Home channel with Dana (home channel · container id `…`)
### Knowledge entries
- …
```

🔒 **Four properties this shape buys, each of which is why it is the recommendation:**

1. **No new fence.** Every leg is the same request a single-scope call makes. Layer A, B1, `canSeeBase`
   and the guest floors all apply per leg with no re-statement — and a re-statement is exactly what
   F-336 and the `service-shared.ts` mirror-list warn about.
2. **Provenance is structural, not decorative.** A hit cannot render without its scope heading, so
   requirement 3 is satisfied by construction rather than by a label somebody can forget.
3. **A FAILED leg is NAMED, never rendered as empty.** `tools/partial-read.ts › partialRead` is the
   shipped idiom (`search.ts` and `map.ts` both use it) and a scope-level version is the same
   mechanism one level up. "No matches in Acme" and "Acme could not be read" must never look alike.
4. **B3 is respected because the leg LIST is the locked list.** A locked session searches its
   container and learns nothing about the existence of anything else.

### 4.3 The two costs, stated rather than hidden

- **CREDITS.** `registrar.ts › createCreditedRunner` charges exactly once per tool call, for the
  RESOLVED workspace. An `everywhere` search would do N workspaces' work on one credit and land the
  burn on one counter. Three options in **Q3**; the recommendation is to charge PER LEG explicitly at
  the same seam (the way `opRefusal` is called explicitly on both registration paths), plus a hard
  `MAX_SCOPES` cap with the truncation NAMED in the result.
- **LATENCY.** N × the current fan of 3 soft reads. Bounded by the same cap; the result states the
  scope count it actually searched, never a promise of exhaustiveness — `search.ts › scopeNote`'s
  discipline ("no group here is proof of absence") extends to scopes verbatim.

### 4.4 What `everywhere` does NOT search, and why the sentence matters

Today `dopl_search` already excludes the chat archive, members, teams and channels, and matches
skills/ontology on names and trigger metadata only. **Widening the SCOPE axis must not be read as
widening the DOMAIN axis.** Templates are the one domain worth adding here (an agent asked to "use my
research agent" needs to find it), and adding them is cheap because `GET /api/agent-templates` is
already agent-reachable. → **Q6**.

---

## 5. Templates — the missing tool

### 5.1 Shape: a new family tool `dopl_agent` (+ `dopl_agent_admin`)

Repo idiom is a family tool with an `op` enum plus a flat all-optional bag, `missingParams` at
runtime, and a `_admin` twin publishing the delete ops **only to refuse them** (`delete-policy.ts ›
deleteAdminDescription` — "an absent tool would read as a broken connection and be retried").

⚠ **The NAME is a genuine product fork.** INVARIANTS §5A records that "Agents" already names TWO
surfaces (identities on /home, running sessions in the channel info column) and that **renaming
either needs Samuel's word**. A tool called `dopl_agent` sitting beside `dopl_channel(op="launch_agent",
op="read_sessions")` inherits that collision. → **Q7**.

| op | R/W | Args | Server |
|---|---|---|---|
| `list` | R | `shelf?` | `GET /api/agent-templates?shelf=` — grouped by visibility, EVERY row labelled with its shelf and its visibility |
| `get` | R | `template` (id or exact name) | `GET …/[templateId]` |
| `create` | W | `name` (req), `description?`, `instructions?`, `model?`, `fields?`, `visibility?`, `knowledge_bases?`, `shelf?` | `POST /api/agent-templates` (`member`+) |
| `update` | W | `template` + the same optionals | `PATCH …/[templateId]` |
| `share` | W | `template`, `visibility` | `PATCH` — see 5.3 |
| **`_admin` `delete`** | refused | `template` | `DELETE` is `sessionOnly` AND `DELETE_OP_SHAPE` fail-closes it. **Doubly refused, and the tool exists so the refusal is discoverable.** |

`template` takes **id or exact name** in one param, resolved through
`agent-templates/server/service-resolve-ref.ts › resolveTemplateRef` — the SAME resolver
`launch_agent` already uses, so an agent learns one rule. Ambiguity refuses with the match list (§7).

### 5.2 The personal shelf, and what the fence actually costs

`create` with `shelf: "personal"` sends `homeScoped: true` and targets the caller's default standard
workspace. `resolveTemplateHomeScope`'s three conditions then decide:

| Credential | Cond. 1 `!isSharedCredential` | Cond. 2 `private` | Cond. 3 own default std ws | Outcome |
|---|---|---|---|---|
| Unlocked device / OAuth token | ✅ passes | ✅ if the op sends `private` | ✅ if `workspace=` is that workspace | **ALLOWED** — no relaxation needed |
| Container-locked session (`container_session`) | ✅ passes | ✅ | ❌ B1's 403 fires first | **REFUSED, by B1, on the workspace axis** — the correct fence, not the shelf one |
| Any other lock kind (no producer today) | ❌ | — | — | **REFUSED** — the M-10 rule, unchanged |

🔒 **Read the middle row carefully: a container session is refused by the WORKSPACE lock and not by
the shelf fence, and the two must not be confused.** That confusion IS F-336, and the mirror-list in
`service-shared.ts › canSeeBase` exists to stop it recurring. Nothing in this plan lets a
container-locked credential reach the operator's home workspace, and nothing should.

⚠ **`create` must therefore SEND `visibility: "private"` explicitly when `shelf: "personal"`**, or
condition 2 refuses on a default the agent never chose. Better: the op REFUSES the combination
`shelf:"personal"` + `visibility != "private"` locally, before the round trip, with a sentence naming
the rule — the `channel-ops-write.ts` refuse-before-send idiom.

### 5.3 Sharing a template into a channel — the one place templates are EASIER than knowledge

A template has no grant table: sharing into a container IS `visibility: "workspace"` (INVARIANTS §5A,
Samuel's ruling Q1 — "a template has ONE consumer per row"). So `op="share"` is a `PATCH` with no new
server work and no fence to relax. ⚠ **But it is audience-changing** — it publishes the operator's
agent identity into the room a peer is standing in, which is precisely the argument
`lib/template-draft.ts › containerCopyDraft` was reversed over on 2026-08-27. **This is the canonical
member of §7's confirm class.**

### 5.4 Launch — nothing to build, and one sentence to add

`dopl_channel(op="launch_agent")` already takes `channel`, `thread`, `goal`, `model`, `template`
(id **or** exact name, resolved server-side under the CALLER's visibility) and `wait_ms`. With §3.2's
container handle in hand, an agent can address a home channel and launch into it today. **The only
change this plan proposes to the launch op is a sentence**: its result copy should name the §0.6
floor once — that the ask reaches a machine, that the machine's opt-in is a setting no server can
read, and that `no-bridge` covers both the toggle and a machine not watching that channel. ⚠ **Do not
"improve" the seven refusal words**; the word crosses the wire and the SENTENCE is written in the MCP
tree precisely so a reword needs no desktop release.

🔒 **AND THE TWO FENCES ON THIS LANE BELONG TO DIFFERENT PEOPLE, WHICH IS WHY §5's WRITES CANNOT
LAUNDER A LAUNCH** (INVARIANTS §5A): the CREATE fence is the orchestrator's credential — it cannot
NAME a template it cannot see; the RESOLVE fence is the operator's own, on their machine, at claim
time. A KB the operator cannot read is simply OMITTED from their resolve payload, so a shared
template cannot launder access to a private base. Nothing in this plan touches either.

### 5.5 What templates still cannot do, and the honest sentence

There is no way to MOVE a template (or a base) between shelves — `home_scoped` is set at create and
never written again, and neither update schema accepts it (F-342). An agent asked to "move my
research agent to my personal shelf" can only CREATE A COPY, and the two rows are strangers (the same
snapshot-not-reference culture `containerCopyDraft` ships). → **Q8**.

---

## 6. Knowledge — closing the shelf gap

Content CRUD is already complete (§1.4). Four additions, one refusal, one question.

1. **`list_bases` gains `shelf?`** and renders a shelf label on every row. ⚠ **The label needs a
   sibling key on the wire**, because `home_scoped` is deliberately NOT projected onto
   `KnowledgeBase` (`server/dto.ts › KNOWLEDGE_BASE_COLS` omits it, so no client can re-implement the
   fence — INVARIANTS §4A). Adding it to the DTO would widen the SDK-mirrored row type and trip
   `scripts/check-knowledge-type-drift.ts`. **A sibling key is the shipped answer for exactly this**
   (`channelGrants` on the same list response, §9's rule).
2. **`create_base` gains `shelf?` and `visibility?`.** `shelf:"personal"` ⇒ `homeScoped: true` +
   `visibility: "private"`, with the same local refuse-before-send as 5.2.
3. **`set_visibility` stays one-way public.** The op's own description already says so and the
   asymmetry with `dopl_skill` is old; widening it is not this plan's business.
4. **Deletion stays app-only.** `DELETE_OP_SHAPE` fail-closes any future `*_admin` op whose name reads
   as a deletion, and `DELETE_REFUSAL` already names the app and closes the retry loop. **"Fully
   manage" therefore stops short of delete, by standing policy, and the spec says so out loud rather
   than quietly proposing an exception.** → confirm in **Q9**.
5. 🚫 **`share_into_channel` is NOT proposed for v1.** `setChannelKnowledgeGrant` refuses agents
   outright and the refusal was deliberately MOVED to the one place both doors pass through
   (2026-08-27). RULING 1 of the knowledge-panels wave already gives the agent a path — create the
   base IN the container — and that path needs no fence change. → **Q5** carries the options if
   Samuel wants it.
6. **Files / folders / rename / content: nothing to build.** `write_file`, `move_file`,
   `create_folder`, `move_folder`, `update_base` already cover the brief's list, including
   `expected_version` optimistic concurrency, and there is no binary upload to be behind on (§0.8).
   Say this in the report rather than shipping a redundant op.
7. **Star and export are OMITTED from v1 by decision, not oversight.** A star is a personal bookmark
   on a surface the agent does not navigate, and export streams a tree an agent can already read
   entry-by-entry. Recorded so nobody reads the omission as an accident.

---

## 7. The ambiguity / confirm protocol

The brief's requirement 4 is that this lives in the SURFACE, not the prompt. Three mechanisms, in
increasing strength, each applied to a named class of op.

### 7.1 THE THREE-ANSWER RULE (every ref-taking op)

A ref (`base`, `template`, `channel`, `workspace`) resolves to exactly one of:

- **RESOLVED** — act.
- **AMBIGUOUS** — REFUSE, listing every candidate with its immutable id AND its scope label. Never
  pick. Shipped precedent: `resolveTemplateRef` (409 `AGENT_TEMPLATE_AMBIGUOUS`, rendered by
  `channel-ops-launch.ts › ambiguousTemplate`) — "every natural tie-break starts an identity the
  caller did not choose and reports success".
- **NOT FOUND** — refuse with the same shape a hidden row gets. **404-not-403, always** — the
  difference between the two codes is an existence oracle (INVARIANTS §5A).

⚠ **The candidate list is not an oracle**, and the reason must be stated at each new site: every row
in it already passed that caller's own visibility predicate, so it discloses exactly what the list op
would.

### 7.2 THE UNADDRESSED-WRITE REFUSAL (every create op)

A create whose placement is under-determined is REFUSED with the choices, never defaulted. This is
`workspace-directory.ts › noWorkspaceError` one level down: it already refuses a no-`workspace=` call
from a 2+-membership caller and prints the list. The new instance is the shelf axis — but note §3.3:
absent `shelf` on a write is NOT under-determined, because `false` is the standing default. **The
refusal fires on a CONTRADICTION**, e.g. `shelf:"personal"` with a `workspace=` that is not the
caller's default standard workspace, or `shelf:"personal"` + a non-private visibility. Both are
refused LOCALLY, before the round trip.

### 7.3 THE CONFIRM CLASS (audience-changing writes only)

Ops in scope: template `share`, template `create` with a container + `visibility:"workspace"`,
`launch_agent` into a container with a peer, and (if Q5 ever opens it) a knowledge grant.

**Mechanism — three options, and the choice is real (→ Q10):**

| | Mechanism | Strength | Cost |
|---|---|---|---|
| **(i)** | `confirm: true` boolean on the op | Weak — a model sets it on the first call from the description alone | ~0 |
| **(ii)** ★ | First call returns a PREVIEW plus an opaque server-minted `confirm_token`; the act runs only when that token is echoed back | Strong against a CONFUSED agent: the token cannot be guessed, so the preview is FORCED into the agent's context before the act | A token store + TTL; two round trips |
| **(iii)** | No mechanism; rely on the desktop's outbound-consent lane | Zero new surface | Only covers desktop-run sessions; an external MCP client has no such lane |

Recommendation: **(ii)**, and **only for the confirm class**. ⚠ **A confirm on every write trains the
agent to skip it** — the identical argument INVARIANTS §10 makes for untrusted-content headers ("a
header on every result trains agents to skip headers") and §5's minimal-copy ruling makes for UI.

🔒 ⚠ **AND THE HONEST SENTENCE, WHICH GOES IN THE MODULE HEADER SO NOBODY MISTAKES IT LATER: a
confirm token is a TRIPWIRE, NOT A FENCE.** Nothing stops an agent calling the preview and echoing the
token back without ever showing a human. What actually refuses the human-reaching acts is the
`sessionOnly` set, the `source === "agent"` refusals, B1 and layer A. The token buys that the agent
SAW what it was about to do — which is worth having, and is not the same as a person having approved
it.

---

## 8. The isolation matrix

Credential kinds (the row axis) — note these are two independent fields, not one ladder:

- **D** — unlocked device / OAuth token. `apiKeyWorkspaceId` null ⇒ `isSharedCredential` **false**;
  `source: "agent"`.
- **C** — container-locked session token, `workspace_lock_kind = 'container_session'`
  (`credential-audience.ts › CONTAINER_SESSION_LOCK`). `isSharedCredential` **false**; B1-fenced to
  one workspace; B3-narrowed; layer-A ceilinged.
- **K** — locked, any other or unstated kind. `isSharedCredential` **true**. **No producer exists
  today; the row is here because the predicate fails closed on purpose and a future minter inherits
  this column, not a wider one.**

Scopes (the column axis): **P** personal shelf (`home_scoped` in the caller's default standard
workspace) · **W** a standard workspace they are a member of · **L** a `kind='link'` container.

| | P read | P write | W read | W write | L read | L write | share (audience-changing) | launch | delete |
|---|---|---|---|---|---|---|---|---|---|
| **D** | ✅ shelf-labelled | ✅ (`resolveHomeScope` passes) | ✅ | ✅ `member`+ | ✅ if member | ✅ `member`+ | ⚠ **confirm-gated** (templates) · 🚫 **refused** (KB grants) | ✅ directive | 🚫 always |
| **C** | 🚫 **B1 403** — not this credential's workspace | 🚫 **B1 403** | 🚫 B1 403 unless it IS the locked ws | 🚫 same | ✅ **only granted rows** (layer A) | ✅ granted + `member`+ | ⚠ confirm-gated within the container only | ✅ | 🚫 |
| **K** | 🚫 `isSharedCredential` | 🚫 `HOME_SCOPE_FORBIDDEN` | ✅ **`public`/`workspace` rows only** (M-10) | ✅ but forced non-private | 🚫 B1 | 🚫 B1 | 🚫 | ✅ `workspace` templates only | 🚫 |

Enforcing symbol per cell class, so no cell is a claim without a fence behind it:

| Cell class | Enforced by | Kind |
|---|---|---|
| Which workspace at all | `mcp_tokens.workspace_id` → `withWorkspaceAuth` 403 | 🔒 FENCE (B1) |
| Which rows in a container | `service-audience.ts › resolveAgentAudience` | 🔒 FENCE (layer A) |
| Whether a credential stands for a person | `credential-audience.ts › isSharedCredential` | 🔒 FENCE (visibility axis) |
| Which shelf a write lands on | `service-base-writes.ts › resolveHomeScope` / `service-writes.ts › resolveTemplateHomeScope` | 🔒 FENCE (403, never a downgrade) |
| Whether an agent may set a grant | `service-channel-grants.ts › setChannelKnowledgeGrant` | 🔒 FENCE (`source` refusal) |
| Whether an agent may mint a link | `sessionOnly` on `POST /api/home/links` | 🔒 FENCE (credential class) |
| What this connection is SHOWN | `workspace-directory.ts › getWorkspaceList` + `lockedTo` | ⚠ TRIPWIRE (B3) |
| What the agent SAW before acting | §7.3's confirm token | ⚠ TRIPWIRE |
| One machine's permission gate | `dopl-desktop-app/main/session-audience.js` | ⚠ TRIPWIRE (B2) |

🔒 **THE THREE CONTEXT-BLEED RULES THIS PLAN ADDS, each of which is a way the new surface could regress
an existing fence:**

1. **`dopl_home(op="list_channels")` MUST be `lockedTo`-filtered** (§3.2), or it becomes the
   enumeration oracle B3 exists to deny.
2. **`dopl_search(scope="everywhere")` MUST derive its legs from the SAME locked list**, and every leg
   must run as an ordinary per-workspace request — never a service-role query over a workspace set.
3. **No result may render rows from two scopes under one heading.** Provenance is the design, and a
   "flat, deduplicated" convenience rendering would silently delete it.

⚠ **What this plan does NOT close, said plainly:** F-329's residual — a `full`-profile session has
Bash and the operator's unlocked device token is reachable on disk, so B1 is a strong tripwire rather
than the fence it was once declared. Every ⚠ in the matrix above is bounded by that, and this surface
neither worsens nor repairs it.

---

## 9. Migration and back-compat

- **NEW OPS ON EXISTING FAMILY TOOLS** wherever a family exists (`dopl_kb`, `dopl_search`). Exactly
  **two new tool names**: `dopl_agent` + `dopl_agent_admin` (§5, name → Q7) and `dopl_home` (§3.2).
  Surface moves **14 → 17** write-capable, **10 → 12** read-only (`dopl_agent_admin` joins
  `READ_ONLY_BLOCKED_TOOLS`). ⚠ Re-derive from `server.ts › createServer`'s register calls minus
  `HIDDEN_TOOLS`; never quote 17 without the posture.
- **EVERY NEW WRITE OP GOES IN `gating.ts › WRITE_OPS`** or a `dopl.read`-only token writes through a
  non-admin tool. ⚠ `tools/parity-harness.ts` parses that constant out of the **SOURCE TEXT** — no
  double quotes in comments inside the set, or a quoted phrase is read as an op name.
- **`delete-policy.ts › DELETE_BLOCKED_OPS` gains a `dopl_agent_admin` row**;
  `delete-block.test.ts` pins the map against the live registrar list, so the row and the registrar
  ship together or the suite is red.
- **EVERY NEW ARG IS OPTIONAL AND ABSENT KEEPS TODAY'S ANSWER** — `scope` defaults `"here"`, `shelf`
  defaults per §3.3, `homeScoped` stays false-and-silent server-side.
- ⚠ **`strictInput` MEANS A NEW ARG IS A CONTRACT.** A caller that sends `shelf` to an older server
  gets `-32602 Unrecognized key`, so a client that starts sending it must not be shipped ahead of the
  server (§13's release ordering: web deploy first, then desktop, then floor).
- **`packages/*/dist` IS WHAT THE APP LOADS.** `npm run build:packages` after editing either package's
  `src/`, or the old surface ships.
- **Gates to re-run beyond `test:all`:** `npm run typecheck -w @dopl/desktop-ui`,
  `node scripts/check-doc-refs.mjs`, the `size-check` CI job (the 500-line cap over `packages/` — the
  new tool files must be split before they approach it), `npx tsx scripts/check-knowledge-type-drift.ts`
  (item 1 of §6 is the one that could trip it), `npx tsx scripts/check-role-drift.ts`. Re-derive the
  list: `grep -n 'run:' .github/workflows/ci.yml`.

---

## 10. Milestones (proposed; each green on the full §14 table, Samuel reviews live)

⚠ **STATE, 2026-08-28 — M0 THROUGH M5 ARE ALL SHIPPED**, wave A (M1, M2, M4) then wave B (M0, M3,
and the rest of M5). Three deviations, each deliberate:

- **M2 SHIPPED WITHOUT `op="share"`.** Raising `visibility` on `op="update"` IS the share act — a
  template has no grant table — so a second verb would be two doors onto one write, and `WRITE_OPS`
  would have to know about both.
- **M1's SIBLING-KEY SHELF LABEL SLIPPED TO WAVE B and then landed**, on BOTH list surfaces rather
  than only knowledge: `homeScopedBaseIds` and `homeScopedTemplateIds`. Wave A shipped the argument
  and said out loud that rows carried no label; leaving the two list ops disagreeing about whether a
  shelf is knowable would have been the same confusion the one-mapping rule exists to prevent.
- **THE M0←M1 SEQUENCING DID NOT HOLD AND DID NOT NEED TO.** The container half of the shelf work
  needs no `dopl_home`, because a container is already addressable with `workspace=<container id>`
  (§1.2's asymmetry). M1 and M2 shipped first.

- **M0 — Addressing.** A new `@dopl/client` home module (there is none — §1.4), `dopl_home`
  (`list_channels` / `create_channel`), `lockedTo` threading, the registrar's "no `workspace` arg"
  path (Q2), `npm run build:packages`. Checkpoint: a locked session lists exactly one channel; an
  unlocked one lists all and each row's container id round-trips as `workspace=` on `dopl_kb`.
- **M1 — Shelves.** `shelf` on `dopl_kb(list_bases | create_base)`, the sibling-key label, the
  local contradiction refusals. Checkpoint: create on both shelves from MCP; read each back; the
  workspace Knowledge page and the /home pane each still show exactly one of them.
- **M2 — Templates.** `dopl_agent` + `dopl_agent_admin`, `resolveTemplateRef` reuse, `WRITE_OPS` and
  `DELETE_BLOCKED_OPS` rows. Checkpoint: author a template from MCP, `launch_agent` it by name, and
  demonstrate the ambiguous-name refusal listing both matches.
- **M3 — Find.** `dopl_search(scope="everywhere")`, per-scope headings, per-leg partial-read notices,
  the credit decision from Q3. Checkpoint: THE adversarial pass — a base in each of three scopes,
  found once each, correctly attributed; then the same run under a container lock returns exactly one
  scope and no evidence the others exist.
- **M4 — Confirm protocol.** §7.3's chosen mechanism over the confirm class. Checkpoint: a share
  without the token refuses and NOTHING is written; the module header carries the tripwire sentence.
- **M5 — Docs ritual.** INVARIANTS §10 (the surface count and posture, the new addressing rule, the
  confirm class), §4A (the `dopl_home` lock rule), §5A (the template tool), §3 (re-measure
  `sessionOnly`); ENGINEERING's dated stratum (why shelf and tenancy are two axes); findings for
  anything measured-and-left; `check-doc-refs`; sync the `Dopl Development` KB.

Sequencing: M1←M0 (shelf writes need the container handle for the container half); M2←M0; M3←M0+M2;
M4←M2. M1 and M2 are parallel.

---

## 11. Critical files

- `packages/mcp-server/src/registrar.ts` — `WORKSPACE_ARG_SHAPE`, `strictInput`, `createCreditedRunner`
  (every §3, §4.3 and §9 decision lands here)
- `packages/mcp-server/src/workspace-directory.ts` — the listing/resolution asymmetry and `lockedTo`
- `packages/mcp-server/src/gating.ts` + `packages/mcp-server/src/delete-policy.ts` — the four gates
- `packages/mcp-server/src/tools/search.ts` · `packages/mcp-server/src/tools/knowledge.ts`
- `packages/mcp-server/src/factory.ts` — `bootServer`, where the lock is decided
- `src/shared/auth/credential-audience.ts` — the two axes, and the predicate every gate may ask
- `src/features/knowledge/server/service-base-writes.ts` · `src/features/agent-templates/server/service-writes.ts` — the two shelf fences
- `src/features/knowledge/server/service-channel-grants.ts` — the agent refusal (Q5)
- `src/app/api/home/channels/route.ts` · `src/app/api/home/links/route.ts` — the two different write gates
- `src/features/agent-templates/server/service-resolve-ref.ts` — the never-pick resolver §7 generalizes
- `packages/mcp-server/src/container-lock.test.ts` — where §8's rule 1 gets its pin
- `packages/dopl-client/src/client.ts` — the SDK the new ops need methods on (no home/template module exists)
- `dopl-desktop-app/main/launch-directives.js` · `dopl-desktop-app/main/channel-prefs.js` — the claim
  loop and the toggle that is §0.6's floor
- `packages/mcp-server/src/tools/channel-ops-launch.ts` — the seven refusal sentences §5.4 adds one line to

---

## 12. QUESTIONS — ALL THIRTEEN RULED 2026-08-28

**Every question below is CLOSED.** Samuel ruled all thirteen on 2026-08-28; each carries a
`✅ RULED` line stating the answer and, where the answer diverges from the recommendation, why the
divergence is the design. ⚠ **The Rec lines are kept as written, not rewritten to agree** — a
recommendation edited to match the ruling deletes the evidence that a choice was made.

⚠ **BOTH WAVES ARE BUILT** (2026-08-28, `packages/mcp-server`). Wave A: the `dopl_agent` /
`dopl_agent_admin` family (Q7, Q9), `shelf: "personal"` on `dopl_kb` (Q1, Q4), the confirm-token
class (Q10), `dopl_search`'s templates group (Q6). Wave B: `dopl_home` as a CHARGED meta tool (Q2,
Q11), `dopl_search(scope="everywhere")` with per-leg billing and a named truncation (Q3), and
`dopl_channel(op="update")` for `infoCard` only (Q12). **Q5, Q8 and Q13 are rulings that required no
code, and their "nothing built" is the answer rather than an omission.**

**Q1 — `shelf` values: `personal` or `home`?** The HTTP param is `?shelf=home|workspace`; the
operator-facing noun since 2026-08-27 is **Personal**. Options: (a) tool says `personal`, client maps
to `home` in one place; (b) tool says `home`, matching the wire and diverging from the UI noun.
**Rec: (a)** — the agent's vocabulary should be the operator's, and one mapping in one place is
cheaper than teaching an agent a word no human uses.
✅ **RULED (a), 2026-08-28.** BUILT: the tool arg is `personal`, mapped onto the wire's `home` in
exactly one place — `packages/mcp-server/src/tools/shelf.ts › toWireShelf`. Both `dopl_kb` and
`dopl_agent` call it; a second mapping anywhere is the drift this ruling exists to prevent.

**Q2 — may a domain tool opt OUT of the injected `workspace` arg?** `dopl_home` is user-scoped (it
LISTS the workspaces others take as an argument) but writes and reads content-adjacent data, so it
cannot be a meta tool (meta tools are uncharged by decision). Options: (a) add an opt-out flag to
`registerTool`; (b) register it as a meta tool and charge it EXPLICITLY, the way `opRefusal` is called
explicitly on both paths; (c) give it a `workspace` arg that it refuses if passed.
**Rec: (b)** — it keeps ONE registration path per posture and the explicit-charge precedent already
exists in the registrar's own docblock. ⚠ (c) publishes an argument that can only ever be wrong.
✅ **RULED (b), 2026-08-28.** BUILT: `registerMetaTool` gained an OPT-IN `MetaToolOptions.charged`
and `dopl_home` is the only tool that takes it. The charge is written in `registerMetaTool`'s own
body, by name, exactly as `opRefusal` is on both paths — never folded into a shared wrapper, because
a blanket charge on that path would meter `current_workspace` / `list_workspaces` and delete the
decision that keeps them free.
- **WHICH WORKSPACE PAYS**, for a tool that targets none: the session default, else the FIRST
  workspace the session may LIST. ⚠ Under a container lock that list is `[container]`, so the burn
  reroutes server-side to the container owner (`resolveBillingTarget`) — the F-325 answer, reached
  for free.
- ⚠ **NO LISTABLE WORKSPACE ⇒ NO CHARGE, FAIL-OPEN AND STATED.** This tool is user-scoped precisely
  so it works for a caller with no resolved workspace; refusing them would break the one path it
  exists to serve. The hole is a decision, not a gap.

**Q3 — who pays for an `everywhere` search?** One tool call, N workspaces' work. Options: (a) charge
ONE credit against the resolved default (cheapest, and lets an agent search a paid workspace's
neighbours for free); (b) charge PER LEG explicitly, with a `MAX_SCOPES` cap and the truncation named
in the result; (c) leave `everywhere` off the surface and make the agent loop, paying per call
anyway. **Rec: (b)** — it is the only option where the meter and the work agree, and (c) is (b) with a
worse agent experience.
✅ **RULED (b), 2026-08-28.** BUILT: `dopl_search` gained `scope: "here" | "everywhere"` (default
`here`, byte-identical to before) and `tools/search-everywhere.ts`.
- **PER-LEG BILLING**, minus the ONE leg `registrar.ts` already charged before the handler ran —
  matched BY ID, not by position, because the resolved workspace is not always the first leg. Legs
  run SEQUENTIALLY so the meter gates the work, the same "charge, then run" ordering the registrar
  keeps.
- **`MAX_SCOPES = 6`**, a latency budget rather than a taste: each leg is four reads and the legs are
  sequential. The truncation is NAMED, and so is running OUT OF CREDITS mid-fan-out — which STOPS
  the fan-out, keeps the legs already paid for, and says the rest is "unknown, not empty".
- 🔒 **THE LEG LIST IS THE LOCKED LIST** (`tools/home-scopes.ts › searchLegs`), de-duped on id, so a
  container-locked session searches exactly its own room.

**Q4 — is a home-shelf write from a NON-person credential ever wanted?** Today `isSharedCredential`
refuses it and there is no producer of such a credential. Options: (a) keep the refusal verbatim
(nothing to build); (b) add an explicit shelf argument with its own gate for a future service
credential. **Rec: (a)** — the whole point of the fail-closed predicate is that a new lock kind must
NAME ITSELF before it inherits anybody's reach.
✅ **RULED (a), 2026-08-28** — the refusal stays VERBATIM. BUILT: nothing in
`packages/mcp-server/src/tools/shelf.ts` or either write op touches `isSharedCredential`; the only
new code is `shelf.ts › homeShelfForbidden`, which RENDERS the 403 and never softens it. A create
that asks for the personal shelf and is refused is refused — it is never quietly written to the
workspace shelf. Pinned in `tools/shelf-confirm.test.ts` and `tools/agent-ops.test.ts`.

**Q5 — may an agent share a knowledge base into a channel?** Today
`setChannelKnowledgeGrant` refuses `source === "agent"` outright, and RULING 1 of the knowledge-panels
wave says "to share, create the KB in the channel". Options: (a) keep refused for v1 — the agent has a
working path; (b) allow only at level `agent_only` (an agent may widen its OWN reach, never a
human's); (c) allow both levels behind §7.3's confirm token; (d) allow when the credential is
user-standing AND the caller created the base. **Rec: (a) for v1, and (b) as the first relaxation if
one is wanted** — (b) is the only option where the blast radius stays inside the agent's own reach,
and this is the single place in the design where an agent's act changes what ANOTHER PERSON sees.
✅ **RULED (a), 2026-08-28** — REFUSED in v1, unchanged. NOTHING BUILT AND THAT IS THE POINT:
`setChannelKnowledgeGrant`'s `source === "agent"` refusal is untouched, `@dopl/client` gained no
grant method, and `dopl_kb` gained no `share_into_channel` op. The agent's working path is RULING 1's
— create the base IN the container — which is why `create_base` is the op the confirm class covers.

**Q6 — should `dopl_search` search TEMPLATES?** "Use my research agent" is exactly the reference the
find requirement is about, and `GET /api/agent-templates` is already agent-reachable. Options: (a) add
a fourth group; (b) leave search to knowledge/skills/ontology and let `dopl_agent(op="list")` answer
it per scope. **Rec: (a)** — a find surface that cannot find the thing the user names by nickname is
the requirement half-met. ⚠ Adding it changes `dopl_search`'s DOMAIN_COUNT and every "what this does
not cover" sentence; both are pinned.
✅ **RULED (a), 2026-08-28.** BUILT: a fourth group over `client.listAgentTemplates()`, matched on
NAME + DESCRIPTION only — never on `instructions`, because folding a system prompt another member
wrote into the haystack lets their prose decide which identity a stranger's agent surfaces.
⚠ **THE PINNED COUNT WAS A LITERAL, NOT A CONSTANT.** `dopl_search` had `reads.notice(3, "groups")`
inline and the word "THREE" in prose that nothing tied to it; it is now
`search.ts › SEARCH_GROUP_COUNT`. (`dopl_map`'s own `DOMAIN_COUNT = 3` is a DIFFERENT constant and
did NOT move — the map still fans out over three domains.)

**Q7 — what is the template tool called?** INVARIANTS §5A records that "Agents" already names two
surfaces and that **renaming either needs your word**. Options: (a) `dopl_agent` — matches the
operator's noun and the /home tab, inherits the collision with `dopl_channel(op="read_sessions")`;
(b) `dopl_template` — unambiguous to an agent, a word no operator uses; (c) ops on `dopl_channel`,
since launching already lives there — rejected here because a template is not a channel thing and
`dopl_channel` is already the biggest tool on the surface. **Rec: (a)**, with the collision stated in
the tool description ("identities you author; running agents are `dopl_channel(op=\"read_sessions\")`").
✅ **RULED (a), 2026-08-28** — `dopl_agent`, with the collision sentence in the description. BUILT:
`packages/mcp-server/src/tools/agent.ts › AGENT_DESCRIPTION` opens by saying these are the identities
you AUTHOR, then routes "the agents currently RUNNING in a channel" to
`dopl_channel(op="read_sessions")` and starting one to `dopl_channel(op="launch_agent")`. The routing
is pinned as a test, not left to prose review.

**Q8 — fund a MOVE between shelves?** `home_scoped` is set at create and never written again, for
bases and templates alike (F-342). An agent asked to "move that to my personal shelf" can only copy,
and copies are strangers. Options: (a) no move, v1 (matches today, and F-342 records the absence as a
decision); (b) `shelf` becomes writable on both update schemas; (c) an explicit `move_shelf` op with
its own gate. **Rec: (a) for v1** — but note this is the first wave where the absence has a USER
asking for it out loud, which is different from the state F-342 recorded.
✅ **RULED (a), 2026-08-28** — no move in v1. BUILT AS A TEACHING REFUSAL, not as silence:
`dopl_agent(op="update")` REFUSES a `shelf` argument rather than dropping it, and the refusal says
there is no move, that the only path is a new `op="create"` on the other shelf, and that **the copy
and the original are STRANGERS**. A silently ignored `shelf` here would return a 2xx over a move that
never happened. `AgentTemplateUpdateInput` in the SDK deliberately has no `homeScoped`.

**Q9 — confirm that "do everything /home does" STOPS SHORT OF DELETE.** Deletion is app-only by
standing policy (`delete-policy.ts`), and `DELETE /api/agent-templates/[templateId]` and the KB
deletes are additionally `sessionOnly`. Options: (a) unchanged — the agent refuses and names the app;
(b) carve out a confirm-token delete for the agent's OWN home-shelf rows only. **Rec: (a)** — the
policy's argument is that an MCP delete has no human in the loop at the moment the row goes, and
§7.3's own honest sentence says a token does not supply one.
✅ **RULED (a), 2026-08-28** — deletes stay app-only, and the tool NAMES the app. BUILT:
`dopl_agent_admin` publishes `delete` only to refuse it, `delete-policy.ts › DELETE_BLOCKED_OPS`
gained its row, and `DELETE_OP_SHAPE` would refuse it on the name alone anyway. ⚠ **The SDK has no
`deleteAgentTemplate` at all** — the verb was deliberately left unbound, so there is no method for a
future op to reach for by accident. Four verbs on the client, not five.

**Q10 — which confirm mechanism (§7.3)?** (i) `confirm: true` boolean, (ii) opaque server-minted
token from a dry-run preview, (iii) nothing — rely on the desktop's outbound-consent lane.
**Rec: (ii)**, scoped to the audience-changing class only. ⚠ Whichever you pick, the module header
carries the sentence that it is a tripwire and not a fence.
✅ **RULED (ii), 2026-08-28** — dry run plus an opaque server-minted token, scoped to the
audience-changing write class ONLY. BUILT: `packages/mcp-server/src/tools/confirm-token.ts`, whose
module header carries the tripwire-not-fence sentence verbatim in intent, and whose PREVIEW carries
it to the agent too ("a step that makes you LOOK, not a permission check").
- **The class, as shipped:** a template landing at `visibility: "workspace"` or a base landing at
  `visibility: "public"`, INSIDE a `kind='link'` container with more than one active member. Nothing
  else. A standard-workspace publish is NOT gated, deliberately — `dopl_kb(op="set_visibility")` has
  published bases workspace-wide with no confirm since long before this wave, and gating one door and
  not the other is theatre.
- **The token** is `randomBytes(18)`, single-use, 5-minute TTL, and fingerprinted over tool + op +
  CALLER + workspace + the exact payload. Replay, expiry, a re-aimed payload and another caller's
  token all refuse and write nothing.
- 🔒 **THE STORE IS PROCESS-LOCAL AND THAT IS STATED, NOT HIDDEN.** `factory.ts › bootServer` boots
  once per HTTP REQUEST, so the store is module-scoped rather than session-scoped. A token minted in
  one process is UNKNOWN in another — and unknown REFUSES. The failure mode of a lost store is
  "preview again", never "the write goes through".
- **A stray token on a call outside the class is REFUSED, not ignored** — the same rule
  `registrar.ts › strictInput` applies to an unknown argument, one level up.

**Q11 — is `dopl_home(op="create_channel")` in scope for v1?** The route is already agent-reachable
and NOT `sessionOnly` on your 2026-08-24 ruling ("a container the caller is alone in reaches
nobody"). Options: (a) yes — it completes "create a home channel without opening the app"; (b) read
only for v1. **Rec: (a)**, and note the natural follow-up is refused by design: the agent can make the
room but cannot invite anyone into it, because minting the link is `sessionOnly`.
✅ **RULED (a), 2026-08-28.** BUILT: `dopl_home(op="create_channel")`, and **the follow-up refusal
is in the op's own RESULT**, not only in the description — an agent that makes a room and is not told
it cannot invite anybody walks the op enum looking for an invite, then a link, then a members op, and
reads each absence as a broken connection. 🚫 No link mint, revoke or claim is bound on
`@dopl/client` at all: all three are `sessionOnly`, the same deliberate omission
`deleteAgentTemplate` makes.

**Q12 — do the channel-MANAGEMENT writes come to MCP, and does RENAME get its first surface here?**
`PATCH /api/channels/[channelId]` accepts `name`, `topic`, `archived` and `infoCard` at `member`,
none of them `sessionOnly`, and `infoCard` is documented as *deliberately* agent-writable. **But
`name`/`topic` are exposed by NO UI on /home or the workspace channels page** — the route accepts a
rename nothing can ask for. Options: (a) add `dopl_channel(op="update")` covering
`name|topic|archived|infoCard`, making MCP the first rename surface; (b) `infoCard` only (the one
with an explicit agent-writable ruling behind it) and file the rest; (c) none for v1. **Rec: (b) plus
a finding for the rename hole** — shipping a rename first on the agent surface means the operator's
only way to undo it is to ask the agent, and that is a worse first surface than none.
✅ **RULED (b), 2026-08-28.** BUILT: `dopl_channel(op="update")` and `@dopl/client ›
updateChannel`, whose `ChannelUpdateInput` carries **exactly one key**. `name`/`topic`/`archived`
are unreachable from MCP by construction rather than by discipline, and a test pins that the patch
this op sends has one key. **F-346 IS FILED and stays open** (`docs/REFACTOR-FINDINGS.md`) — the
route accepts a rename no UI can ask for, and the fix is a HUMAN affordance, not an agent one.
- ⚠ **THE CARD IS REPLACED WHOLE, SO THE OP ALSO READS.** Omitting `info_card` renders the current
  card and changes nothing — the read-modify-write handle a whole-card contract requires, without a
  second op to gate, classify and describe. A blind write would delete every row the caller did not
  happen to know about.

**Q13 — the `template-approval` asymmetry (§1.5.3).** Once an agent can author and share a template
into a container, a peer's directive-lane launch of that peer-authored template reaches their machine
with no first-run human prompt, where the button lane would have raised one. Options: (a) accept —
the standing toggle is the consent, and the desktop still wears the foreign-template ROLE header
(`main/prompt-framing-template.js › FOREIGN_HEADER`) so the agent is told whose words it is running;
(b) extend `template-approval` to the directive lane, which needs a consent shape that is not a
proposed reply and is adjacent to F-321; (c) refuse a directive naming a template the operator did
not author, i.e. an eighth refusal word. **Rec: (a) for v1, recorded as a known asymmetry** — the
role header already carries the security posture, and (c) would break the shared-template product on
the one lane it was built for. ⚠ Whatever you pick, `'template-approval'` must NOT enter the
`refusal_reason` CHECK (INVARIANTS §5A).
✅ **RULED (a), 2026-08-28** — ACCEPTED, and RECORDED as a known asymmetry rather than left implicit.
Wave A makes it live: an agent can now author and share a template into a container, so a peer's
directive-lane launch of that template reaches their machine with **no first-run `template-approval`
prompt**, where the button lane would have raised one. What still holds: the standing per-machine
toggle is the consent for the whole lane, and the desktop wears the foreign-template ROLE header
(`main/prompt-framing-template.js › FOREIGN_HEADER`) so the running agent is told whose words it is
running. ⚠ NOTHING WAS ADDED TO THE `refusal_reason` CHECK, and nothing may be — a column that could
store `'template-approval'` would tell a future reader this lane has an approval gate it does not
have.
