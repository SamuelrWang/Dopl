# 06 — Rulings archive: what is already decided about /home and workspaces

**Built 2026-09-17** against `docs/workspace-parity` @ `03506fcd` (= `master`). **READ-ONLY research — no
source file was edited to produce this, and nothing here is a new decision.**

## What this document is for

The desktop **HOME space** has moved far ahead of **WORKSPACES**, and a parity uplift is being mapped.
Other researchers audit the code. **This is the decision archive**: every ruling Samuel has already made
that bears on either surface, so the uplift carries what must be carried, refuses what was deliberately
refused, and **reopens nothing that is settled**.

Samuel's standing frame for the uplift, restated so every row below can be read against it:

> *"as little code as possible, no repeat code"* — one implementation per feature; host-specific only
> when the two surfaces are different **in kind**.

### How to read the ledger

- **Scope as ruled** is what the ruling *said*, not what the code does. `unspecified` is the interesting
  column: it is where the uplift has latitude, and also where it can get something wrong quietly.
- **Implication for parity** is one of:
  - **CARRY** — the workspace surface should end up with this.
  - **DO NOT CARRY** — the ruling is home-shaped, or the workspace side was deliberately left different.
  - **ALREADY BOTH** — one implementation already serves both hosts; the uplift must not fork it.
  - **RE-ASK** — the ruling's reasoning does not obviously survive the move to a multi-member workspace.
- **Sources** are `file:LINE` as measured on 2026-09-17, a `commit <sha7>`, or a Dopl KB path. Per
  CLAUDE.md's own standing rule, *a line number is wrong within a day* — the line numbers here are a
  **finding aid**, not an anchor. Re-grep the quoted phrase if a line has moved.

### The three documents that matter most, before anything else

1. **`docs/DRIFT-LEDGER-2026-08-30.md`** is **prior art for this exact uplift** — its own title is
   *"everything outside `/home`, judged against the `/home` standard"*. It carries **33 ruled-LEAVE items
   recorded so the next wave does not re-litigate them** and **36 ASKs, of which only 5 were ever ruled**.
   §B and §E below are largely that document, brought forward. **Read its §5 before calling anything drift.**
2. **`docs/DESIGN-SYSTEM.md:94`** carries the ruling that authorises the whole uplift (§F, P1).
3. **`docs/INVARIANTS.md`** is the standing statement of current state; **`docs/ENGINEERING.md`** is the
   archaeology. Precedence is **code > INVARIANTS > ENGINEERING** (`CLAUDE.md:18`).

---

## A. Rulings ledger

Split into themes for navigation; it is one ledger. Quotes are Samuel's recorded words where the source
records them; everything else is marked **(paraphrase)**.

### A.1 — The frame, the palette, and the standard itself

| Date | Ruling | Source | Scope as ruled | In force? | Implication for parity |
|---|---|---|---|---|---|
| 2026-08-30 | *"the workspace pages adopt /home's frame model and palette — the two surfaces must match."* (live review) | `docs/DESIGN-SYSTEM.md:94` | **both** | **YES — this is the charter** | **CARRY.** This is the ruling the uplift exists to finish. It also kills the older `"/home ONLY"` note on the frame tokens, which is explicitly marked SUPERSEDED. |
| 2026-08-30 | *"it should be the sidebar panel gray, then the inner panel is white, and panels on top of that go back to that sidebar panel gray — it's alternating. Look at the home page, that's literally what it looks like."* | `docs/DESIGN-SYSTEM.md:102-116` | **both** | yes | **CARRY.** `/home` is named as the literal spec: *"The workspace shell is that structure with the nav where the list is."* Four levels, dark at level 0 only. |
| 2026-08-30 | *"The right panel sits ON TOP OF the gray panel that holds the sidebar."* — ONE float per surface, everything else nested inside it | `docs/DESIGN-SYSTEM.md:108-113` | **both** | yes | **CARRY.** `pages/home/index.tsx` is the reference implementation. |
| 2026-08-30 | ASK-31 SETTLED: *"home-frame wins, one token."* `--rail: #2c3640` deleted from both token copies; `--body-bg` reads `var(--home-frame)` | `docs/DRIFT-LEDGER-2026-08-30.md:964-973` | **both** | yes (DONE) | **ALREADY BOTH.** Precedent for the whole uplift: where the two surfaces held near-identical values, /home's won and the other was **deleted, not aliased**. |
| — | The `--home-` PREFIX is kept deliberately although the tokens are now app-wide — renaming to `--frame-*` would touch every consumer for zero behaviour change | `docs/DESIGN-SYSTEM.md:96-100` | both | yes | **DO NOT CARRY a rename.** A `--home-*` token on a workspace page is correct, not drift. Never fold them into `--bg-*`. |
| 2026-09-17 | A `/home` face that two trees render is **declared in `src/`** and the SPA re-exports it; the Next tree cannot import `apps/` at all. **A SECOND DECLARATION OF ANY OF THESE IS THE BUG** | `docs/INVARIANTS.md:44` | **both** | yes | **CARRY — this is the mechanism.** The established route for sharing a /home face with a second host: move the shared half DOWN into `src/`, keep every existing import path via re-export. Two suites already pin "no re-spelled recipe". |
| 2026-09-16 | *"nothing should be named channels v2, it's just channels now"* | `docs/INVARIANTS.md:370`; `commit 075bea0f` | both | yes | Naming only. Do not reintroduce `channels-v2` in new parity code. |

### A.2 — The home container model (§4A) — what a "home space" actually is

| Date | Ruling | Source | Scope as ruled | In force? | Implication for parity |
|---|---|---|---|---|---|
| 2026-08-24 | The 2026-08-23 **immutability rule is REVERSED**, deliberate — *"do not reinstate."* A container starts with ONE member and grows | `docs/INVARIANTS.md:259` | home-only | yes | **DO NOT CARRY / do not re-derive.** `LINK_CONTAINER_IMMUTABLE` is a dead error code. The rename *is* the reversal made visible. |
| 2026-08-26 | **THE ROSTER HAS NO CEILING** — the two-member cap is retired; what replaced it is the single-use TOKEN, not a bigger number | `docs/INVARIANTS.md:214, 223, 258` | home-only | yes | **DO NOT CARRY.** Workspaces already grow by invitation; the token model is the home container's answer to a problem workspaces do not have. |
| 2026-08-24 | **THE THREE WRITE GATES, and they are not the same.** `POST /api/home/channels` is NOT `sessionOnly` (an agent may create one, matching `POST /api/workspaces`); `POST /api/home/links` IS `sessionOnly` — *"it mints a credential that reaches a PERSON, which is the line"*; ANY member may mint, not the owner only — *"a home channel is a relationship, not a tenancy"* | `docs/INVARIANTS.md:267` | home-only | yes | **RE-ASK if the uplift touches workspace link/invite minting.** The *"reaches a PERSON"* test is a general principle; its application here is container-shaped. |
| 2026-08-26 | Home channels grow **ONE PERSON AT A TIME**, each by their own single-use link bound to the container | `docs/INVARIANTS.md:214` | home-only | yes | DO NOT CARRY. |
| 2026-09-06 (code 09-07) | **PERSONAL REACH IS DEFAULT-ON IN SHARED CHANNELS, AND THE ARMING SWITCH IS DELETED.** An agent in ANY room, shared or solo, reaches its OPERATOR's shelf unconditionally. The fence closes on exactly two facts: a SHARED credential, or NO personal container | `docs/INVARIANTS.md:239` | **both** | yes | **ALREADY BOTH.** `shared/tenancy/personal-reach.ts › resolvePersonalReach` is the ONE decision point. A parity change must not re-introduce a per-room arming switch — that narrowing was explicitly removed. |
| 2026-09-02 (B10) | *"home is the default; all workspaces are just normal workspaces"* | `docs/INVARIANTS.md:1096` | **both** | yes | **CARRY as the mental model.** Explicitly levels the two: home is not a privileged species, it is the default container. Strong support for one implementation. |
| 2026-09-02 (B13, ruling B2) | `workspace=` is a LIST-AND-CREATE argument, and everywhere else it is **ignored rather than refused**; the MCP server picks NOTHING (session pin, sole-membership auto-target and `WORKSPACE_REQUIRED` all deleted) | `docs/INVARIANTS.md:1092, 1096` | both | yes | ALREADY BOTH. |
| 2026-09-10 | A caller with **no standard workspace is forwarded to their HOME SPACE**, `?plan=` or not | `docs/INVARIANTS.md:195` | both | yes | CARRY — home is the fallback destination, not an error state. |
| 2026-09-10 | **NO CHANNELS AT ALL IS A FIRST-CLASS STATE on /home**, and three surfaces used to get it wrong | `docs/INVARIANTS.md:309` | home-only | yes | **RE-ASK.** An empty workspace is equally a first-class state and the reasoning transfers cleanly; nothing says it was ruled for workspaces. |
| 2026-09-10 | *"drop seed content"* — a fresh home space seeds nothing | `docs/INVARIANTS.md:192` | home-only (explicitly *"about the personal shelf, not about the corpus"*) | yes | **DO NOT CARRY blindly.** The bullet itself scopes the ruling away from workspace seeding (`createWorkspaceForUser` unchanged). |

### A.3 — The channels surface: one component, two hosts

| Date | Ruling | Source | Scope as ruled | In force? | Implication for parity |
|---|---|---|---|---|---|
| 2026-08-18 (Phase 12) | **THERE IS EXACTLY ONE CHANNELS SURFACE, AND IT IS THE PORTED ONE** — the cutover; `channel-pane.tsx` deleted | `docs/INVARIANTS.md:369, 818` | both | yes | **ALREADY BOTH — the governing precedent.** The last time two channel UIs existed, the answer was to delete one, not to sync them. |
| 2026-08-25 → | `channel-surface.tsx › ChannelSurfaceCapabilities` is **the host's narrowing** — three flags: `memberManagement` + `selfManagement` NARROW and default `true`, `knowledge` ADDS and defaults `false`. **ONE FLAG, TWO CONTROLS, ON PURPOSE** — two would let a host ship a dead control with nothing saying so | `docs/INVARIANTS.md:563` | **both** | yes | **CARRY — this is the parity seam.** New host differences belong here as a named flag, never as a forked component. |
| 2026-08-25 (second correction) | **THREAD ACTIVITY IS THE CHANNELS PAGE'S DENSITY STRIP, WIRED.** First pass substituted a plain list because the heatmap was a fixture; *"the ruling is to keep the PICTURE and make it true"* — squares + shade ramp now render on **both** surfaces *"so they cannot drift apart while only one is wired"* | `docs/INVARIANTS.md:570` | **both** | yes | **ALREADY BOTH + a principle:** when one surface has a fake, fix the fake — do not delete the affordance, and do not wire only one side. |
| 2026-09-05 | The channels page is wired too (F-316 CLOSED) | `docs/INVARIANTS.md:575` | both | yes | ALREADY BOTH. |
| 2026-09-16 | **THE CHANNELS INFO TAB EDITS `name` AND `topic` IN PLACE** — click-to-edit, *"the line IS the field — no underline, no border, no pencil"*; no new endpoint, no new gate; one field per save | `docs/INVARIANTS.md:151`; `commit e937eb1b` | workspace channels page first | yes | **CARRY — and it already was.** See the next row: this is the archetype of a ruling arriving on one surface and being carried one ruling later. |
| 2026-09-17 | *"On the right, the info tab: I want to be able to click where the name and description are… and then I should be able to edit the name and description of the channel."* — a host that REPLACES the body now gets the same bundle instead of losing it; `/home`'s `Hash` glyph went with it | `docs/INVARIANTS.md:151`; `commit 43c40598`, `b34a18ec` | **both** | yes | **ALREADY BOTH.** The defect named in the bullet is the exact failure mode of this uplift: *"/home's card came to be display-only while `surface-info-panel.tsx` was already minting the write for a tab it was not rendering"* — i.e. **a slot-replacing host silently loses a capability**. Audit every `infoTab`/slot host for this. |
| 2026-08-25 | **THE INFO TAB'S CURATED CARD IS CURATED, AND THE CURATION IS STORED** — hover-only ×, ghost row adds a custom `label: value` pair, edited in place | `docs/INVARIANTS.md:547` | ruled unspecified; **live on /home only so far** | yes | **CARRY — named gap.** The bullet says so in as many words: *"Live on /home only so far … the workspace channels page's `channels/components/info-tab.tsx` still renders its fixed list."* |
| 2026-09-04 (F-666) | *"There should be no Knowledge tab at all for the web: just Info, Threads, and Agents."* — since this date **NO host passes `knowledge` at all**; the component and its API stay live with no caller, and **re-adding the face needs Samuel's word** | `docs/INVARIANTS.md:563` | **both** | yes | **DO NOT CARRY, and DO NOT re-add.** Explicitly requires a fresh ruling. The five-tab column did not fit 380px — the budget is a measurement. |
| 2026-08-19 (live review) | Tabs **moved off the pane header**. *"THE CHANNEL HEADER'S RIGHT SIDE IS THE INFO TOGGLE AND NOTHING ELSE."* | `docs/INVARIANTS.md:372` | both | yes | CARRY. |
| 2026-08-28 (live review) | The heading reads **"Channel info"** on /home — it was *"Main info"*, which *"named a position on the tab rather than a subject"* | `docs/INVARIANTS.md:548` | home-only | yes | **CARRY the principle** (a heading names a subject, not a position), re-check the workspace heading against it. |
| 2026-09-13 | Draggable divider between transcript and info pane — *"I should be able to click on it and drag left and right… it should only go left"* | `docs/INVARIANTS.md:557`; `commit adb200fb` | unspecified | yes | **RE-ASK / verify** which host mounts it. |
| 2026-09-15 | **Pinned / Recent / Earlier** collapsible gray wells on the /home channel list — *"one for Pinned, one for Recents (channels with activity in the last 24 hours), and Earlier"*; the box is the Agents tab's well **exactly** | `docs/INVARIANTS.md:312`; `commit dce0030a` | home-only | yes | **CARRY (candidate).** No workspace equivalent. Machinery is already shared (`collapse-wells.tsx › WellsColumn`, `recency-wells.tsx › wellFor`) so the cost is a call site, not a component. |
| 2026-09-15 | **A `variant="tab"` SHIPPED AND WAS RETRACTED THE SAME DAY** — *"I actually don't like the tab look… Just make the gray dropdowns match exactly those instead."* Union, both class strings, folder-tab overlap and doc rows all DELETED; **do not re-derive one** | `docs/INVARIANTS.md:312` | both | yes | **DO NOT CARRY.** A tab-shaped well is a settled no. |
| 2026-09-15 | Well gray is `--seg-fill`, **not** `--home-panel` — same-day correction, *"there's no gray background on this at all"*; **no fourth gray was minted** | `docs/INVARIANTS.md:312` | both | yes | CARRY the token choice. `face` varies the FILL and **may never vary the layout**. |
| 2026-09-15 / 2026-09-17 | **ALL WELLS ALWAYS RENDER, EMPTY OR NOT** — *"I want there to be something there, like the gray box… it will just be empty until the user actually puts something in it, but I still want it to be there."* Extended 2026-09-17 to Threads and Agents: *"in the Threads and Agents view, i want to have the gray boxes kept there even if there's nothing in them. Same as the channel picker"* | `docs/INVARIANTS.md:312, 1776, 1777`; `commit a118614b` | **both tabs + the /home column** | yes | **CARRY.** Note this REVERSED a prior rule that an empty well is not rendered. `showEmpty` still defaults `false` — the safe default for a new well set, **not** a statement about those tabs. |
| — | **AN EMPTY WELL CARRIES NO PLACEHOLDER SENTENCE** (minimal copy); empty sentences are drawn **beside** the boxes, not instead of them | `docs/INVARIANTS.md:312, 1776` | both | yes | CARRY. |
| 2026-09-15 | **PINNED MEANS FAVOURITED — THE PIN *IS* THE BOOKMARK**, one server-backed fact. *"remove the pin icon that appears when i hover over the picker. instead replace the bookmark icon next to the channel name with the pin icon."* | `docs/INVARIANTS.md:312` | **both** | yes | **ALREADY BOTH.** *"Pinning on /home and bookmarking on the workspace channels page are the same act on the same row"* — both mount `message-pane-header.tsx`. |
| 2026-09-15 | A per-device `localStorage` pin **lived for one afternoon and is DELETED** — *"Do not mint a second pin store."* | `docs/INVARIANTS.md:312` | both | yes | **DO NOT CARRY.** |
| 2026-09-15 | *"the bookmark icon like alway breaks and is super buggy"* → the fact lives in two client caches; bridged by `pages/home/use-home-channel-sync.ts`, which **copies key by key and never invents one** | `docs/INVARIANTS.md:312` | both | yes | **CARRY as a hazard class.** Any fact rendered by both `GET /api/channels` and `GET /api/home/channels` needs this bridge. The rename write hit the identical two-cache gap on 2026-09-17. |
| 2026-09-13 | Nothing renders `HomeChannel.lastMessagePreview` — over the list column, the last message on a row *"just doesn't make sense imo"*; the row wants *"some notification system for new @s"* → two unread marks (a dot, an `@ N` pill) | `docs/INVARIANTS.md:980, 981` | home-only | yes | **RE-ASK** for the workspace list column. |
| 2026-09-15 | A solo channel's row says what the channel is for; a peopled one shows who is in it | `commit 22e44845` | home-only | yes | RE-ASK (a workspace channel is never solo in the same sense). |
| 2026-08-18 (Phase 7) | **PER-MESSAGE DESKTOP NOTIFICATIONS ARE RETIRED.** The mention is the escalation; the Tags inbox is the record | `docs/INVARIANTS.md:1677` | both | yes | **DO NOT CARRY / do not reintroduce.** |
| 2026-09-15 | **Mentions** is a top-level category on /home, and the row names the agent that tagged you, in that agent's colour; it is on a home channel's Info tab too and it is **called Mentions** | `commit 19e83461, f0626dac, aa2d212e` | home-only | yes | **CARRY (candidate).** The 2026-09-15 bullet records the same *"minting a write for a tab it was not rendering"* defect here ("the same defect the mentions inbox had, one ruling earlier"). |

### A.4 — Knowledge: the shelf split, and what was deliberately left asymmetric

| Date | Ruling | Source | Scope as ruled | In force? | Implication for parity |
|---|---|---|---|---|---|
| 2026-08-26 | **SCOPE C IS A SHELF, NOT A WORKSPACE.** It lists ONLY bases created FROM that pane, and **the exclusion runs BOTH WAYS** — the workspace Knowledge page sends `?shelf=workspace` and does not show home-shelf bases either: *"two PLACES over one table, not a saved filter over one list"* | `docs/INVARIANTS.md:346`; `docs/ENGINEERING.md:4402-4404`; `docs/specs/home-knowledge-panels.plan.md:27` | **both, reciprocally** | yes (mechanism superseded by B10) | **ALREADY BOTH — and the reciprocity is the ruling.** A separation that runs one way *"is a saved filter, not a place."* The filter is a `WHERE`, never a client `.filter()`; an omitted `?shelf=` means BOTH shelves, so **forgetting it WIDENS**. |
| 2026-09-02 (B10/#18) | **ONE `kind='personal'` CONTAINER PER USER**, usable from ANY container the user is in; the `home_scoped` column retires; **sharing is a grant** | `docs/specs/mcp-v2-wave-b.md:39,47`; `docs/ENGINEERING.md:6210-6213` | both | yes | **CARRY.** Supersedes the *mechanism* of the 2026-08-26 shelf ruling while keeping its *effect*. Anything still reasoning from `home_scoped` is reasoning from a dead column. |
| 2026-08-27 | **THREE SCOPES BECAME TWO SECTIONS** on /home — the scope `SelectMenu` is **deleted**, "Private" is relabelled **"Personal"** (UI copy only; `visibility:'private'` unrenamed), **scope B no longer exists** | `docs/INVARIANTS.md:344`; `docs/specs/home-knowledge-panels.plan.md:6,14-17` | home-only | yes | **DO NOT CARRY the two-section shape blindly** — it exists because /home has no `public`/`team` audience. See the next row. |
| 2026-08-27 | **NEITHER /home CREATE ASKS THE AUDIENCE.** Shared is picker-less because its grant answers the question; Personal is picker-less because *"the button pressed IS the answer"*. **"The WORKSPACE Knowledge page passes neither prop and keeps the picker"** — that page's create button names no audience, *"so it is the one place the question is still worth asking"* | `docs/INVARIANTS.md:348`; `docs/ENGINEERING.md:4575-4581` | **explicit split: home hides, workspace keeps** | yes | **DO NOT CARRY.** This is the clearest "deliberately different" row in the archive. Removing the workspace picker would be reversing a ruling, not finishing a port. |
| 2026-08-26 | **THE PER-CHANNEL PRIVATE SCOPE IS DELETED, AND ITS CONSEQUENCE IS A RULE: A CONTAINER BASE REACHES /home ONLY THROUGH A CHANNEL GRANT.** An ungranted `private` base in a link container is unreachable *"and that is intended, not an oversight"* | `docs/INVARIANTS.md:344`; `docs/ENGINEERING.md:4450` | home-only | yes | DO NOT CARRY as a restriction; **CARRY the reasoning** — a private shelf inside a shared container is a place to lose things. |
| 2026-08-26 (M6) | **THE TAB'S ONE WARNING IS A `ConfirmDialog` FIRED ON THE TRANSITION — IT IS NOT, AND MAY NOT BECOME, A STANDING BANNER** | `docs/INVARIANTS.md:381` | home-only as written | yes | **CARRY the rule.** An explainer always on screen is read once; a confirmation is read every time it fires. Pinned by a test that bounds captions at 8 words. |
| 2026-08-26 (M5) | **THE AGENT AUDIENCE CEILING — ONE FENCE, TWO TRIPWIRES, AND THE DIFFERENCE MAY NEVER BE DRESSED AWAY** | `docs/INVARIANTS.md:1265` | both | yes | CARRY. |
| 2026-08-27 (F-336, *"option B"*) | A scope-B base is invisible to the operator's own agent **until it is granted `agent_only` (or `visible`)** on one of the container's channels | `docs/INVARIANTS.md:777, 1276` | both | yes | CARRY. |
| 2026-09-02 (B11) | ***"grants replace copies"*** — SHARE is a REFERENCE, never a copy: *"one object, and an edit reaches everyone it is lent to"* | `docs/INVARIANTS.md:767, 1076`; `docs/specs/mcp-v2-architecture.md:333` | both | yes | **CARRY — a hard constraint on the uplift.** Do not solve a home↔workspace sharing gap by copying rows. |
| 2026-09-02 (R2) | ***"you lend what you created, not what you can read."*** Being able to READ a row is not being able to LEND it | `docs/INVARIANTS.md:1077`; `docs/ENGINEERING.md:6235` | both | yes (Desktop Agent default; *Samuel may loosen*) | CARRY. |
| 2026-09-08 | *"right now, you can only select entire bases, but I want to be able to specific folders or entries/files"* → base/folder/entry attachment scopes | `docs/INVARIANTS.md:661, 1939` | both | yes | CARRY. **But F-680 is open**: whether a folder attachment should NARROW an agent's reach or only re-point it needs Samuel. |
| 2026-08-28 | Opening a base from /home: *"a mess of mismatched components, double-panelled, stray hairlines"* → `embedded` prop, one panel / one header, **the base's INFO page is the resting state** | `docs/ENGINEERING.md:4832-4862` | home-only | yes | **CARRY (candidate).** The `embedded` prop is the existing mechanism for a second host. |
| 2026-09-09 | The base info face's two flat sections are **Details and Changelog** | `docs/REFACTOR-FINDINGS.md:8385` | both | yes | CARRY (F-687 is its orphaned-module residue). |
| 2026-09-09 | Changelog granularity: **ONE ROW PER CHANGED FIELD**, Samuel's HubSpot shape — `old → new`, who, when, person-or-which-agent | `docs/INVARIANTS.md:1016`; `docs/specs/ontology-research/current-system-audit.md:331` | both | yes | CARRY. |

### A.5 — Agents, templates, sessions

| Date | Ruling | Source | Scope as ruled | In force? | Implication for parity |
|---|---|---|---|---|---|
| 2026-08-26 (Q6) | **"AGENTS" NAMES TWO DIFFERENT SURFACES AND BOTH NAMES STAY.** /home Agents = template IDENTITIES; the channel info column's Agents tab = live SESSIONS. *"Renaming needs Samuel's word — record the collision… don't rename."* | `docs/INVARIANTS.md:313, 765`; `docs/specs/home-agents-tab.plan.md:31` | both | yes — **collision RECORDED, not resolved** | **RE-ASK.** The uplift will put both names on one surface. This is §E's top item. |
| 2026-08-27 | **TWO SECTIONS, NO SCOPE PILL — THE /home AGENTS FACE**, converged on the Knowledge face | `docs/INVARIANTS.md:743`; `docs/ENGINEERING.md:4486` | home-only | yes | See A.4's audience row — same reasoning, same caution. |
| 2026-08-27 | Samuel over a screenshot: make the /home section a **normal flat rectangle** — no border line, no inset shadow, on the channel-list ground. **"the workspace Agents page is pixel-unchanged"** | `docs/INVARIANTS.md:761`; `docs/ENGINEERING.md:4584-4599` | home-only, explicitly | yes | **RE-ASK.** The spec that authorised it says *"a reversal for visual parity is an ENGINEERING.md entry, not a styling choice"* (`home-agents-tab.plan.md:29`, Q4) — i.e. bringing the workspace Agents page onto the flat face **is a ruling, and Q4 is still flagged for review**. |
| 2026-08-26 (Q1) | Ship template sharing on `agent_templates.visibility`, **not** a grant table — *"a grant would be a THIRD copy of the visibility matrix"* | `docs/specs/home-agents-tab.plan.md:25-26` | home-only | yes | CARRY the reasoning; F-334 is the unbuilt widening. |
| 2026-08-26 (Q2) | Cross-container reuse is a **COPY** — *"IT IS A SNAPSHOT THAT DIVERGES: no FK, no back-pointer, no sync"*; attached knowledge bases are DROPPED and cannot be re-attached by name | `docs/INVARIANTS.md:767`; `docs/specs/home-agents-tab.plan.md:27` | home-only | yes, though *"Use in this channel"* was **deleted 2026-09-02 (B15)** | **DO NOT reintroduce.** `docs/INVARIANTS.md:745`. |
| 2026-08-26 | A guest is kept out by the **server floors alone**, and there is deliberately **no UI gate** | `docs/INVARIANTS.md:776` | home-only | yes | CARRY the principle: **the fence is server-side; a hidden control is not a fence.** |
| 2026-08-22 | **THE TWO LAUNCH SURFACES NOW OPEN A TEMPLATE PICKER** — overrides `AGENT-TEMPLATES-SPEC.md` §3a's OQ-4 recommendation | `docs/INVARIANTS.md:1778` | both | yes | ALREADY BOTH. |
| 2026-09-13 | **ONE LAUNCH SURFACE** — the launch sheet was **DELETED rather than conformed**: *"the buttons aren't the right size, the title is off too. The popup as a whole doesn't match our popup UI"* | `docs/DESIGN-SYSTEM.md:435`; `commit 385efc28` | both | yes | **DO NOT CARRY a second launch form.** One LANE, one FORM. |
| 2026-08-27 | **AN AGENT'S IDENTITY IS CHOSEN BEFORE IT EXISTS, FROM THE COMPOSER'S LAUNCH PANEL** | `docs/INVARIANTS.md:1606` | both | yes | ALREADY BOTH. |
| 2026-08-22 | **THE AGENT'S WORK STREAM IS ONE COMPONENT, ON BOTH SURFACES**; the DIRECT 1:1 composer is on both agent surfaces; an ended agent says so **in one place per surface** | `docs/INVARIANTS.md:1764, 1767, 1768` | **both** | yes | **ALREADY BOTH — the model.** Extracted from the agent window, **never copied** into the panel. |
| 2026-08-22 | **AN ENDED AGENT IS DEAD, AND ITS RECORD LIVES SEVEN DAYS.** Supersedes the `MAX_ENDED` count bound | `docs/INVARIANTS.md:1562` | both | yes | CARRY. |
| 2026-08-25 | **AN AGENT CAN BE DELETED OUTRIGHT, AND THE DELETION IS LOCAL** | `docs/INVARIANTS.md:1574` | both | yes | CARRY. |
| 2026-09-13 | **THE CARDS SIT IN FOUR COLLAPSIBLE GRAY WELLS, BUCKETED BY TIME** (Agents tab), **AND THE THREADS TAB SITS IN THE SAME FOUR WELLS** | `docs/INVARIANTS.md:1776, 1777`; `commit 3f7acaa1, b4c66dc0` | both tabs | yes | ALREADY BOTH tabs; shares `recency-wells.tsx › RECENCY_WELLS / wellFor / RecencyWells` with /home's three-well set. |
| 2026-09-13 | **AN AGENT'S COLOUR IS UNIQUE PER CHANNEL AMONG LIVE SESSIONS, ACROSS MEMBERS**, and the database is the only thing that says so. *"if my agent is a specific shade of red, then the other user should not be able to launch an agent with that specific color of red either"*; a colour returns to the bank when the agent ends | `docs/INVARIANTS.md:614`; `docs/specs/agent-colors.md:3-49` | **both surfaces, one implementation** — *"the web/desktop workspace pages and /home's `StandaloneChannelSurface` import the same tree"* | yes | **ALREADY BOTH.** Server-side partial unique index; 409 returns the free set. |
| 2026-09-14 → 2026-09-16 | **The agent post accent is ONE DRAWN SHAPE** — a framed pill + a side bar, not a box: *"instead of it being an entire box… a vertical bar… move the agent/user identification pill to the right again"*; square where it joins the bar; then *"is it possible to make it a single component?"* → the bar-side border is dropped, the pill draws nothing | `docs/INVARIANTS.md:623`; `docs/DESIGN-SYSTEM.md:474-494`; `commit 66d8832f, 376c654f, 16a1575d` | both | yes | **CARRY.** The 2026-09-13 flat agent row was **REVERTED the same day** (`commit 6ddd3f89`) — do not re-derive it. |
| 2026-09-15 | **THE RAW AGENT ID IS NEVER USER-VISIBLE**, sharpened: *"that ID is only internal… The name should be blank… if agents are spinning up agents, they should be the ones that are naming the agent… if a user launches an agent with no name, just give it the name, New Agent."* | `docs/INVARIANTS.md:1577, 1582, 1592`; `docs/specs/agent-id-visibility.md:3-17` | **both** (the spec's surface table names channels **and** the desktop Home pane) | yes | **ALREADY BOTH.** Enforced by a source sweep (`agent-id-visibility.test.ts` reads every `.tsx` in the directory). The `Agent #<id>` carve-out is **withdrawn**. |
| 2026-09-15 | **NO TWO ADDRESSABLE AGENTS IN ONE CHANNEL WEAR THE SAME NAME** — *"it will automatically auto-resolve to coder-1… coder-2… only… for agents that are in the idle or working state"*; the rename is **DURABLE**, decided once at commit time, never recomputed | `docs/INVARIANTS.md:582, 1583`; `docs/specs/agent-id-visibility.md:19-32` | both | yes | **CARRY.** This REVERSED the 2026-09-07 positional-suffix rule, which re-pointed live addresses. |
| 2026-09-17 | **A SLUG-SHAPED NAME IS NORMALIZED, NOT REFUSED** | `docs/INVARIANTS.md:1596` | both | yes | CARRY. |
| 2026-08-28 | **AN AGENT'S PILL IS A BUTTON THAT OPENS THAT AGENT'S VIEW; A HUMAN'S IS NOT** — and since 2026-09-16 **the pill is a TOGGLE and the card is not** | `docs/INVARIANTS.md:477` | both | yes | CARRY. |
| 2026-08-22 | **ATTRIBUTION IS ONE PILL, AND THE GREY `Agent · <id>` CHIP IS DELETED** — from two reference screenshots; supersedes the chip ruling made earlier the same day | `docs/INVARIANTS.md:475` | both | yes | DO NOT reintroduce. |
| 2026-09-06 | **THE CHANNEL'S POSTURE CEILING IS DROPPED** — the settings overhaul removed **every** ceiling | `docs/INVARIANTS.md:609, 610` | both | yes | DO NOT reintroduce a ceiling. |
| 2026-09-01 | Agent cap **6 → 15**: *"im thinking to just increase the agent number to like 15 or something. because 6 is too limiting. As long as we give agents the ability to end other agents…"*; chained launches 12→30 | `docs/ENGINEERING.md:5651-5690` | both | yes | Supersedes *"Samuel's multi-machine ruling: the number does not go up"* (F-272) — **that older quote is dead.** |
| 2026-09-13 | **A PARKED AGENT SURVIVES A RESTART AS *Idle*, OR ENDS *VISIBLY*. NEVER AS NOTHING** — and the re-park window is 24h, amended hours later, because the first build revived **66** records, 63 older than a week: *"that's kind of a serious issue"* | `docs/INVARIANTS.md:1670` | both (desktop) | yes | CARRY — an instance of **honest states**. |
| 2026-09-13 | Blank launch: typed **Instructions** reach the agent as an instructions-only role; the field starts EMPTY on a blank launch (F-695) | `commit dcf2230b`; `docs/REFACTOR-FINDINGS.md:8852` | both | yes | CARRY. |

### A.6 — Ontology

| Date | Ruling | Source | Scope as ruled | In force? | Implication for parity |
|---|---|---|---|---|---|
| 2026-09-09 | **ONTOLOGY COMES TO THE HOME SPACE** (verbatim, long): a new tab **to the right of Agents**; ontologies belong to the user's home space; multiple per user; **default personal**; a setting shares one with a channel; per-channel member/guest view-or-edit; the same ontology may be shared to another channel with **different** permissions; per-channel agent access, view vs write; for solo channels an agent gets view+edit automatically with a toggle to view-only | `docs/INVARIANTS.md:313, 652`; `docs/specs/home-ontology.md:32-36` | **home-only** — Q5 explicitly refuses a `kind='standard'` workspace channel with a 400, and `pages/ontology/index.tsx` *"stays exactly as it is"* | yes | **RE-ASK — and it is the single biggest scope question in the archive.** Sharing an ontology into a **workspace** channel is an explicitly-refused, explicitly-out-of-scope case (§B, §E). |
| 2026-09-10 | **THE /home ONTOLOGY FACE *IS* THE WORKSPACE ONTOLOGY PAGE, NOT A LIST** — *"the UI for the ontology in the home should look a lot more like the ontology for workspaces … for the ontology switcher, instead of different tabs, have it be a dropdown"* | `docs/INVARIANTS.md:313` | **both** | yes | **ALREADY BOTH — and note the direction of travel is REVERSED here.** /home adopted the *workspace* page, not the other way round. The grid of cards and its Open/Share/Changelog/Delete pills are GONE. |
| 2026-09-10 | **THE BOARD'S HEADER WAS RESTYLED THE SAME DAY, ON BOTH SURFACES** — *"the workspace page mounts the same component and moved with it"*: the cluster NAME is the picker trigger (plain text, chevron, **no pill**); `ClusterSwitcher` has ONE face now, the `"pills"` strip and the `switcher` prop are DELETED; every remaining control is a row in ONE round gear menu | `docs/INVARIANTS.md:313` | **both** | yes | **ALREADY BOTH.** Model outcome for the uplift: one component, host rows injected. |
| 2026-09-10 | **DELETE IS ONE SLOT, NEVER TWO** — the workspace page's standalone `Trash2` button beside the gear is **DELETED**; the board contributes its own Delete row **only when the host gives none** | `docs/INVARIANTS.md:313` | **both** | yes | **CARRY — the host-injection pattern.** A host that brings its own passes `settingsMenu`. |
| 2026-09-11 | **"+ OBJECT" MAKES AN OBJECT TYPE — THE LANE — AND IT OPENS A POPUP**: *"what it's supposed to do is create a new object type, basically a new column … right now the code is messed up, where it's actually creating a new object on top of the column"*; Discard/Escape/backdrop sends nothing — *"a discard has to be free"* | `docs/INVARIANTS.md:313` | both | yes | CARRY. |
| 2026-09-11 | **VOCABULARY**: *"any wording that's called 'cluster' should not be there. It's like 'ontology' … it's not a column, it's an object"* → cluster=ontology, column=object(type), card=item — and **"NOTHING WAS RENAMED IN CODE, AND THAT IS THE RULING, NOT A SHORTCUT"** | `docs/INVARIANTS.md:315`; `docs/specs/ontology-research/current-system-audit.md:296-299` | both | yes, gated by `vocabulary.test.ts` | **CARRY.** Identifiers still say `column`; every user-facing string says object. |
| 2026-09-11 | **DOTTED GRID COMES BACK** — *"I want to bring that dotted grid back"*; the 2026-09-10 removal misread the objection (he objected to the FILL, not the dots), so the white-panel ruling holds and lanes wear `--home-panel`, *"the same gray that appears on the panel holding the tab switcher"* | `docs/INVARIANTS.md:313`; `docs/DESIGN-SYSTEM.md:270-271` | both | yes | CARRY. |
| 2026-09-12 | *"no more indented stuff … no need to show the ID in the UI … at the top, it shouldnt be a pill, just have it be the name of the object … for the trash and X buttons, just have it be naked icons, no more button UI"* | `docs/INVARIANTS.md:316`; `docs/DESIGN-SYSTEM.md:308` | both | yes | CARRY. Pinned by a test that asserts the **ABSENCES**. |
| 2026-09-13 | Object-panel rows: *"each of those items should have the gray background where it sits, kind of like the overview you see"*, then *"you're adding this extra border line around the gray"* | `docs/INVARIANTS.md:316` | both | yes | CARRY. |
| 2026-09-09 | **AN AGENT'S ONTOLOGY REACH IS ITS OPERATOR'S, RESOLVED SERVER-SIDE**; every agent cell is a `min` against its operator's cell; **reach bounds FUTURE reads, never context already in the window** | `docs/INVARIANTS.md:652`; `docs/specs/home-ontology.md:63` | both | yes | CARRY. |
| 2026-09-09 | Samuel ruled **both halves YES** — six ontology floors go to `minRole:"guest"`, `GUEST_ALLOWED` 19→27 (F-685/F-681 RESOLVED). This **reverses** the in-file *"Do not floor one to guest"* argument, which is left standing so the losing argument stays readable | `docs/INVARIANTS.md:282, 654`; `docs/specs/home-ontology.md:28,124` | both | yes | CARRY — but see §D: a grep hits the losing side first. |
| 2026-09-13 | *"so wherever the user is, if they click on a different channel in the picker, it needs to go to the channel page of that"* (reported from the Ontology face) — **the picker names a CHANNEL and naming one lands on its page**; re-pointing a face at another channel is the header selector's job | `docs/INVARIANTS.md:321` | both | yes | CARRY. |

### A.7 — Credits and billing: the one place home vs workspace is ruled as a *deliberate* split

| Date | Ruling | Source | Scope as ruled | In force? | Implication for parity |
|---|---|---|---|---|---|
| 2026-09-07 | **Credit model v2, verbatim:** *"in the home space, an individual user gets charged credits according to what their own agent spent … separate billing for workspaces … based off of seats … a fixed credit allocation, so I don't think it should be pooled … Free: each person gets 100 credits. Paid: each person gets 5,000 credits for an $8-per-seat kind of tier."* | `docs/ENGINEERING.md:6442-6444`; `docs/specs/credit-model-v2.md:17-24` | **both, explicitly split by surface** | yes (numbers moved 09-08) | **DO NOT CONVERGE.** Two wallets is the ruling, not an accident. This supersedes the pooled per-workspace model. |
| 2026-09-08 | **v2.1, verbatim:** *"Team seats are 799, and normal pro seats are also 799 … I think we should make it 899 … Personal free is 500, seat free is 100, pro individual is 5,000, and team individual is also 5,000."* | `docs/ENGINEERING.md:6534-6536`; `docs/specs/credit-model-v2.md:419-428` | both | yes | CARRY the figures. Personal-free 500 was an **assumption until this date**, not a ruling. |
| 2026-09-08 | The plan × container-kind fence lives in **checkout** (`pro` requires `kind='personal'`, `team` requires `isStandardWorkspace`); the webhook only REPORTS | `docs/ENGINEERING.md:6566` | **both — the explicit home/workspace split in billing** | yes | CARRY. |
| 2026-09-13 (rule B) | **THE CALLING CHANNEL'S CONTAINER PAYS; WITH NO CALLING CHANNEL, THE RESOURCE'S DOES.** *"the wallet needs to match the histogram — that's the whole point"* | `docs/INVARIANTS.md:294, 330` | both | yes | CARRY. |
| 2026-09-13 | **THE HISTOGRAM MUST EQUAL THE WALLET, ALWAYS** — *"there's a disconnect between the two charts"* | `docs/REFACTOR-FINDINGS.md:8745`; `docs/INVARIANTS.md:1256` | home-only as reported | yes | CARRY as an invariant wherever a figure is drawn. |
| 2026-08-26 | *"charge MCP calls from a guest to the user"* | `docs/INVARIANTS.md:294`; `docs/ENGINEERING.md:3931` | home-only (containers) | yes — survived unedited into v2 | DO NOT CARRY to workspaces (seats answer it there). |
| 2026-09-06 | Ruling (b): **a spend record OUTLIVES the room it was spent in** — *"deleting a room must not destroy the record that tokens were spent"* | `docs/INVARIANTS.md:490`; `docs/REFACTOR-FINDINGS.md:8618` | both | yes | **CARRY — and note it is an explicit carve-out of the permanent-delete ruling** (`credit_usage_events.channel_id` is `CASCADE_EXEMPT`). |
| 2026-09-07 | **Departure = removal** (it frees the allowance) | `docs/REFACTOR-FINDINGS.md:8498`; `docs/specs/credit-model-v2.md:32` | both | yes | CARRY. |
| 2026-09-13 | *"I want the credits bar and the bar graph to be split into two different white panels with some spacing between them"*; *"where you see 'Credits used', I want you to put a dropdown where the user can select: all channels / specific channels / just desktop agent usage"* | `docs/INVARIANTS.md:325, 329` | home-only (Overview) | yes | RE-ASK for the workspace billing page. |
| 2026-09-13 | *"for the usage credits, remove the credits and the 'Credits used' text"* — **the /home bar passes no `label`; exactly one caller omits it** | `docs/DESIGN-SYSTEM.md:312-313` | **home-only, deliberately** | yes | **DO NOT CARRY.** A named per-host difference on a shared recipe — the model for how asymmetry should be expressed. |
| 2026-09-01 | The /home credit bar is **NOT a new recipe** — it is `UsageMeter` cloned from the billing surface (issued as a CORRECTION) | `docs/DESIGN-SYSTEM.md:312` | home-only reusing a workspace recipe | yes | **Precedent in the reverse direction**: /home took the workspace's recipe. |
| 2026-09-07 | **Solo is retired from SALE, not from the BOOKS** — `PLAN_RETIRED` 400; live `solo` rows keep billing | `docs/ENGINEERING.md:6490` | workspace-only | yes | DO NOT resurrect. |

### A.8 — Members, roles, visibility

| Date | Ruling | Source | Scope as ruled | In force? | Implication for parity |
|---|---|---|---|---|---|
| 2026-08-10 | *"`role` and roster basics stay public to the workspace; per-member **settings** do not"* — enforced by **column privilege**, not RLS, not the DTO | `docs/ENGINEERING.md:459`; `docs/REFACTOR-FINDINGS.md:1209` | both | yes | CARRY. |
| 2026-08-10 | *"fully and cleanly removed"* — a departed member's channel rows are **removed, not filtered** | `docs/ENGINEERING.md:667`; `docs/REFACTOR-FINDINGS.md:1229` | both | yes | CARRY (an instance of **delete, don't disarm**). |
| — | **The MCP surface is deliberately TIGHTER than web. Do not "restore parity" by loosening MCP** — close the gap by applying the same admin-or-self scrub to the web `/members` DTO | `docs/INVARIANTS.md:1141` (F-100) | both | yes | **CARRY — this is the parity method itself.** Close a gap by raising the weaker side, never by relaxing the stricter one. |
| 2026-08-25 (R2/R3) | `memberManagement: false` + `selfManagement: false` as **one flag-pair story**; a guest runs no agent, and leaving is a one-way exit from the only surface they have | `docs/INVARIANTS.md:563` | guest lane only | yes | DO NOT CARRY to a workspace host. |
| 2026-08-25 | *"I don't know why you're making it different"* — the roster row **and** its online/offline partition are **exported and shared**, not re-implemented per surface | `docs/INVARIANTS.md:566`; `docs/ENGINEERING.md:3650-3656` | **both** | yes | **ALREADY BOTH — and it is Samuel objecting to exactly the divergence this uplift exists to remove.** |
| 2026-08-25 | Dead controls (`Add member`, `Filter members` with no `onClick`) were **deliberately NOT copied** from the channels page to /home | `docs/ENGINEERING.md:3662` | home-only | yes | **DO NOT CARRY dead controls in either direction.** A port is not a transcription. |
| 2026-08-30 | **ASK-1 RULED (a) — not the recommendation:** the v1 members console **and** the settings modal's members pane are deleted, so `/members` is the ONE console. *"delete, don't disarm: there is no nav stub."* | `docs/DRIFT-LEDGER-2026-08-30.md:694-712` | workspace-only | yes (DONE) | **DO NOT reintroduce a second console.** |
| 2026-08-30 | **ASK-2 RULED (b):** a guest at a workspace URL is **redirected to their channel**, at the SHELL layer, not the floor. ⚠ *"The shell CHROME question is untouched"* — a guest lands somewhere that works, **still wearing a nav they cannot use** | `docs/DRIFT-LEDGER-2026-08-30.md:717-748` | workspace-only | yes (DONE, with a named residual) | **CARRY the residual into the uplift** — the chrome port is still owed. |
| 2026-09-02 | **RULED: "Shared" is ANY channel with more than one member, whatever kind of container** — the channel's member count, not the container's kind (F-513) | `docs/INVARIANTS.md:1449`; `docs/REFACTOR-FINDINGS.md:7511` | **both** | yes — **Desktop Agent default; *Samuel may reverse with one line*** | **CONFIRM BEFORE BUILDING ON IT.** It is precisely a home↔workspace equivalence claim, and it is reversible in one predicate. |
| 2026-08-25 | `guest` sits BELOW `viewer` at the floor; **the LINK carries the grant** (`granted_role` on `channel_links`), CHECK-limited to `(guest, viewer, member)` | `docs/ENGINEERING.md:3738-3780` | both | yes | CARRY. |
| 2026-09-06 | The personal container **is "Home"** — not `"<First>'s Workspace"`; the directory renders it *"home space (your default; a personal container, not a workspace)"* | `commit 3171593b` | home-only | yes | CARRY the naming. |
| 2026-09-08 | *"remove the team option, if it's in the home space"* — visibility by **container kind**: standard offers Private/Team/Public; **personal and link containers offer no Team**. A stored `team` row keeps its pill with a "workspace only" hint and cannot be saved until changed | `commit 500bb38d` | **home-only carve-out of a both-surfaces editor** | yes | **CARRY the shape.** This is the canonical example of a host difference expressed as a *server-fenced, container-kind-derived* narrowing rather than a fork. |

### A.9 — Deletion, retirement, and the shape of a removal

| Date | Ruling | Source | Scope as ruled | In force? | Implication for parity |
|---|---|---|---|---|---|
| 2026-08-07 (D6/§2b) | **DELETES ARE PERMANENT.** Soft-delete is gone as product behaviour; **every** destructive action app-wide carries an "are you sure" confirm; the trash feature surfaces are retired; `purge-trash` cron obsolete | `docs/ENGINEERING.md:440`; `docs/RETIREMENT-UNWIRING-PLAN.md:130,136` | **both, app-wide** | yes | **CARRY — app-wide by construction.** Any new destructive control in the uplift needs a confirm. |
| 2026-08-07 | **MCP deletes are BLOCKED ENTIRELY** — every delete-shaped op returns a standard refusal naming the app, implemented at **one choke point** so future tools inherit it | `docs/RETIREMENT-UNWIRING-PLAN.md:142`; `docs/specs/mcp-surface-v2.plan.md:847` (Q9) | both | yes | **CARRY.** *"deletes stay app-only, and the tool NAMES the app."* `dopl_ontology` has no delete op and **must not gain one**. |
| 2026-08-08 | `channels.deleted_at` is a **DM-ONLY** mechanic — DMs soft-delete (close/reopen), every other channel hard-deletes, owner/workspace-admin only. **A tombstoned DM is LIVE PRODUCT STATE**: never hard-delete one, never add `channels` to a tombstone-cleanup migration | `docs/ENGINEERING.md:451`; `docs/INVARIANTS.md:488` | both | yes | CARRY as a carve-out, not an exception to be tidied. |
| 2026-08-22 | *"remove all the stuff about declining and approving of threads"* — inbound consent retired. **"The retirement is a DELETE, not a disarm"** (union arm, trust service, both `/trust` routes, `agent_trust_rules` table) | `docs/ENGINEERING.md:3166-3172`; `docs/INVARIANTS.md:792` | both | yes | **DO NOT reintroduce.** |
| 2026-08-20 | The SESSION WINDOW is retired on Samuel's live-test ruling and **deleted the same day** (F-228) — *"never reintroduce"* | `docs/ENGINEERING.md:3050-3055`; `commit db901c39` | both (desktop) | yes | **DO NOT reintroduce.** |
| 2026-09-02 (B8) | `channel_pings` **was written, never applied, and its migration is DELETED.** *"A directed `send` IS the delivery record."* The three ping kinds are **REFUSED as message kinds** — *"a value with no distinct behaviour is prose wearing a schema"* | `docs/INVARIANTS.md:2068`; `docs/ENGINEERING.md:6183-6194`; `commit 68fbfabe, ec99baa5` | both | yes | DO NOT reintroduce. |
| 2026-09-02 (B6) | The **LLM triage wake tier** (tiers 2 & 3) and the `triage` runtime capability are deleted across all three adapters — *"a capability nothing calls is worse than an absent one"* | `commit 45f92c7e`; `docs/ENGINEERING.md:6139-6142` | both | yes | DO NOT reintroduce. |
| 2026-08-24 | `maxUses` is **DELETED, not defaulted** — *"when a constraint moves into the data model, the option that used to express it should be DELETED, not defaulted"* | `docs/ENGINEERING.md:3399-3415` | home-only | yes | **CARRY the rule shape.** |
| 2026-09-06 | `useChannelAutoSend`, `main/channel-prefs.js › getAutoSend` and the `channels.get/setAutoSend` bridge ops are **all deleted** | `docs/INVARIANTS.md:1542, 1753, 821` | both | yes | DO NOT reintroduce. |
| 2026-09-16 | *"sure delete it"* — the kit's `.selected-ring` recipe, *"it had no renderer left in either tree"*; tokens kept | `commit 85d40b87` | both trees | yes | Precedent: **delete the recipe, keep the tokens.** |
| 2026-09-16 | Inline **approve/deny UI for agent tool-permission gates: DROPPED off board** — the gate never reaches the web (no requestId, no decide IPC, no preload member), three files are at the 500-line cap, and the web-only Deny alternative *"overturns the 2026-08-25 one-button ruling"* | Dopl KB `Dopl Development › tech-debt/channel-permission-approve-deny-ui.md` | both | yes (dropped) | **DO NOT absorb into the uplift** without a fresh ruling — it was taken off the board deliberately. |

### A.10 — MCP / server-side rulings that bind both surfaces

| Date | Ruling | Source | Scope | In force? | Implication for parity |
|---|---|---|---|---|---|
| standing | *"any prompt/tool defs that tell agents that they are barred from accessing things … there should be a **dopl actual guardrail in the code**"* | `docs/INVARIANTS.md:1190`; `docs/specs/mcp-v2-architecture.md:168` | both | yes | **CARRY.** A rule an agent is TOLD must have a fence in the code. Two prose-only residuals remain (§D). |
| 2026-09-03 | **HOLD, NEVER POLL.** An external client waits with a persistent background hold, never a timed poll; server-side `POLL_STRIKE_LIMIT` withholds the empty page, never the cursor; a hold RESETS the count | `docs/INVARIANTS.md:1190`; `commit 84a02f6c, ac24f1b4`; `docs/ENGINEERING.md:6280-6328` | both / global | yes | CARRY. |
| 2026-09-03 | The UNSECTIONED nudge on a long KB write is **a nudge and may never become a refusal** | `docs/ENGINEERING.md:6407` | both | yes | CARRY. |
| 2026-09-02 (B1) | Fan-out **narrowed to the addressed recipient** (reverses ruling 4 of 2026-08-21), with the remedy attached: ***"a forgotten `@` must never stall a conversation"*** — server-side repair as a third verdict VALUE, not a flag | `docs/INVARIANTS.md:586`; `docs/ENGINEERING.md:6097-6116` | both | yes | CARRY. |
| 2026-09-02 (A9) | **THE DELIVERY KEYSTONE** — the server resolves the recipient, the desktop executes it. **An unresolved `to=` is REFUSED** (400 `CHANNEL_RECIPIENT_UNRESOLVED`, listing live handles and the roster) — **never a silent `delivery=none`** | `docs/INVARIANTS.md:578, 584` | both | yes | CARRY — **no silent failure**. |
| 2026-09-07 | **WHO ANSWERS AN UNADDRESSED MESSAGE IS A PER-MEMBER SETTING, NOT A CHANNEL ONE** — and this bullet said the opposite until then | `docs/INVARIANTS.md:604`; `commit 9da20c5b` | both | yes | CARRY. |
| 2026-08-31 | **THE SAME-ACCOUNT CARVE** — an agent-authored message under the operator's own user id may @-wake that operator's dormant agents. Supersedes the 2026-08-28 agent-authored blanket for the own-account case; **the 2026-08-28 reversal still stands for a PEER's agent** | `docs/INVARIANTS.md:1720, 1721`; `docs/ENGINEERING.md:5505` | both | yes | CARRY both halves. |
| 2026-08-31 | **THE PRIVATE DIRECT LANE** — an operator's external agent may steer their own running one; **a peer's never may** | `docs/INVARIANTS.md:1498, 1502` | both | yes | CARRY. |
| 2026-08-31 | Agents escalate as **STRUCTURE** — issue, bounded context, 2–6 options each with a one-line consequence, a recommendation; rendered as a card with option buttons routed back as the asking agent's answer | `docs/ENGINEERING.md:5544-5546`; `docs/specs/agent-direct-lane-and-escalations.plan.md:33-37` | both | yes | CARRY. |
| 2026-09-02 (B7) | **THE FOURTH PROFILE — `channel_agent` = `full` MINUS THE SHELL**; `Bash` removed from the channel profile only, `WebFetch`/`WebSearch` stay | `docs/INVARIANTS.md:1361, 1444`; `docs/specs/mcp-v2-wave-b.md:270-271` | both | yes | CARRY. |
| 2026-08-28 (Q5) | An agent may **not** share an existing KB into a channel; the refusal stays VERBATIM | `docs/specs/mcp-surface-v2.plan.md:783` | both | yes | CARRY. |
| 2026-09-02 (A8) | The MCP surface **must not teach an axis with zero live rows** — `team` exists in `resource_grants` but is not offered | `commit 80d3eda4`; `docs/INVARIANTS.md:1041` | both | yes | CARRY. |
| 2026-08-22 | **FOUR NARRATION DEFECTS FIXED** (post-incident rulings) — *"each one a line that told an agent something the code does not do"* | `docs/INVARIANTS.md:1165` | both | yes | CARRY the class: **copy that misdescribes behaviour is a defect, not a wording nit.** |
| 2026-09-15 | *"a lost launch name is SAID, not echoed"*; a denial post names the gate REASON | `commit 807a9492, 4782677b, 997e84aa` | both | yes | CARRY — honest states. |

### A.11 — Design-system recipe rulings that the uplift will touch

| Date | Ruling | Source | Scope | In force? | Implication for parity |
|---|---|---|---|---|---|
| 2026-08-19 (third ruling that day) | **"WE SHOULD NOT BE EXPLAINING EVERYTHING TO THE USER."** A row is a **NAME + a CONTROL**, plus at most a few-word secondary line. **No paragraph-style explainer block anywhere.** Each tool profile's sentence became a **≤5-word** line | `docs/INVARIANTS.md:377`; `docs/ENGINEERING.md:2007` | **both** | yes — reaffirmed 2026-09-17 | **CARRY.** Pinned as a MEASUREMENT: `settings-tab.test.tsx › minimal copy` bounds every caption at 8 words and refuses a mid-string sentence break. |
| 2026-08-27 | `StandardDialog` — ONE width, ONE heading (centered + uppercase), ONE footer row. **WIDTH IS NOT A PROP** | `docs/DESIGN-SYSTEM.md:324`; `docs/ENGINEERING.md:4537-4550` | both | yes | CARRY (ASK-32 is the one live tension — a diff at 640px is not a diff). |
| 2026-09-08 | **FormDialog kit** — *"i want to start conforming all pop ups to the UI of the one we just made, we should make a design system for this"* | `docs/DESIGN-SYSTEM.md:325, 335` | both | yes | **CARRY — a direct mandate for the uplift.** |
| 2026-09-08 | `--action-h-sm` = **30px** small-action scale (Open / Launch / Discard); New agent and New channel **stay 36px**; the composer's toolbar glyphs went 30px for one hour and back to 24 — only the Discard · Dictate · Send **order** survived | `docs/DESIGN-SYSTEM.md:299`; `commit f6f774dd` | both | yes | CARRY. Do not re-derive the 30px toolbar glyph. |
| 2026-08-24 | The 36px `CARD_BUTTON` / `TAB_ACTION` pair is a **deliberate decision**: *"there is no smaller 'card-sized' variant to drift back to"* | `docs/DRIFT-LEDGER-2026-08-30.md:544` | both | yes | **DO NOT "fix" the geometry.** |
| 2026-09-08 | `--home-panel-line` → `--border-default`, *"the same divider the workspace channels page uses"* | `commit f6f774dd` | **both — an explicit convergence toward the workspace page** | yes | Precedent in the reverse direction. |
| 2026-09-08 | Histogram bars are **SOLID**, 80% of slot, slanted dates, black label ink — *"the four rulings are ONE picture, not a menu"* | `docs/DESIGN-SYSTEM.md:85, 314` | both (shared `BarSeries`) | yes | CARRY as a set. |
| 2026-09-08 | A long-prose field is **ONE ROW tall and grows with its own text** — *"don't make it like multiple lines as the default height"* | `docs/DESIGN-SYSTEM.md:363` | both | yes | CARRY (repeated 2026-09-13). |
| 2026-09-08 | *"i dont think a dropdown is the best way to do it"* → `KnowledgeScopePicker` checkable tree | `docs/DESIGN-SYSTEM.md:326` | both | yes | CARRY. |
| 2026-09-13 | Popup titles wear the section-heading type in **Title Case, not uppercase**; the channel header name + view dropdown take the section-heading face | `docs/DESIGN-SYSTEM.md:56-61`; `commit db36f379` | both | yes | CARRY. |
| 2026-09-13 | *"in between each setting, add a horizontal line, like how we have in the channel info area"* — the line is `MetaRowDivider` **by import**, never a hand-cut `border-t` | `docs/DESIGN-SYSTEM.md:298` | both | yes | CARRY. |
| 2026-09-13 | *"I want the drop-downs collapsing and expanding to be a smooth animation"* → `.collapse-grid` (`0fr→1fr`, no measured pixel) | `docs/DESIGN-SYSTEM.md:277` | both | yes | CARRY. |
| 2026-09-13 | The info column width is the **operator's** (drag handle: *"a vertical black line … a little thick, rounded at the edges, and centered"*); **380px becomes FALLBACK and FLOOR** | `docs/DESIGN-SYSTEM.md:276, 307` | both | yes | CARRY — and it partly relieves the tab-row width budget (§B, §E). |
| 2026-09-13 | **/home channel-row unread marks** — `@ N` pill + 6px dot, **exclusive**; a numeric badge is legitimate ONLY because a real count backs it — **the channels sidebar deliberately has none**, because `Channel.unread` is a BOOLEAN | `docs/DESIGN-SYSTEM.md:305` | **home-only, and deliberately asymmetric** | yes | **DO NOT CARRY the badge without carrying the count.** The asymmetry is reasoned, not lag. |
| 2026-09-15 | **/home's selected channel row IS the page's black button**, no ring, no shadow — *"can we have it turn into like the black button UI? And drop the shadow"*; the two faces are **alternatives, never layers** | `docs/DESIGN-SYSTEM.md:304`; `commit dce0030a` | **home-only** | yes | **RE-ASK** — the reasoning is not obviously home-shaped. |
| 2026-09-15 | /home's New channel **LEFT** the `StandardDialog` recipe — *"match it to the other pop up[s]"* (the FormDialog kit) | `docs/DESIGN-SYSTEM.md:324`; `commit cfda06d2` | home-only | yes | CARRY — the FormDialog kit is the destination for all popups. |
| 2026-09-15 | **No "AGENTS" heading** in the expanded rail — *"remove the line that says the word 'agents.' … It's obvious to the user."* | `docs/DESIGN-SYSTEM.md:188` | both | yes | CARRY (minimal copy applied). |
| 2026-09-15 | A tab label is **BOLD**; a tab **HUGS** its label and caps at 200px | `docs/DESIGN-SYSTEM.md:158-175` | both | yes | Supersedes the `w-[180px]` reading of 2026-09-13's *"It's a fixed size"*. ⚠ `agent-window-tabs.md:32` still says `w-[180px]`. |
| 2026-09-16 | Accent-pill hover = the black button's — *"when I hover over like one of the black buttons, it translates up, and the shadow gets darker/larger… Can we add the same functionality"* → `--shadow-raised-hover` **extracted, not copied** | `docs/DESIGN-SYSTEM.md:268, 506` | both | yes | CARRY the *extracted, not copied* method. |
| 2026-09-10 | Option hover = `--menu-item-hover-bg`, **never an elevated face** | `docs/DESIGN-SYSTEM.md:269` | both | yes | CARRY. |
| 2026-08-30 | *"the grayed resting backgrounds one step lighter"*; a dark-ground rebind of `.nav-chip` was **deleted** — *"do not re-add one"* | `docs/DESIGN-SYSTEM.md:266` | both | yes | CARRY. |
| 2026-08-28 (over a screenshot) | **Loading skeletons must look like the real UI.** *"way off"* (2026-08-28), re-stated 2026-09-10 — *"the loading skeleton for when i first open the app/when i switch workspaces doesnt look at all like the actual UI"* — and again 2026-09-13 — *"this is the skeleton for the channel, it doesn't look accurate at all needs to be fixed"* | `docs/INVARIANTS.md:79-82`; `commit ab233e2b` | **both** | yes | **CARRY — and it is a named workspace defect.** The 2026-09-10 complaint is explicitly about **switching workspaces**. |
| 2026-09-13 | Agent template cards: **a fixed four-column grid, not auto-fill** — *"I said 4 on a row"* | `docs/INVARIANTS.md:88`; `commit cf8fe7f3` | both | yes | CARRY (the module is **IMPORTED, not copied**). |

---

## B. Tabled / parked items, and whether this uplift trips them

**"Does the parity uplift trigger it?"** is the only column that matters here. **YES** means the item's own
revive condition is the thing the uplift is about to do.

### B.1 — Items the uplift TRIGGERS

| Item | Where tabled | Revive trigger as written | Why the uplift trips it |
|---|---|---|---|
| **F-334 — grant widening for a MULTI-CHANNEL STANDARD WORKSPACE** ("this channel's people only"). Filed with all five parts enumerated *"precisely so nobody re-derives them under time pressure and ships three of them"*; **not built** | `docs/REFACTOR-FINDINGS.md:4058`; `docs/specs/home-agents-tab.plan.md:65`; `docs/ENGINEERING.md:4323` | *"build it when a standard workspace needs per-channel template sharing"* | **YES — squarely.** Home shares templates and bases by container grant; the workspace side has **no equivalent**. This is the single largest unbuilt mechanism the uplift needs. |
| **Ontology Q5 — a home ontology shared into a `kind='standard'` workspace channel is OUT OF SCOPE**, refused with a 400 | `docs/specs/home-ontology.md:159` | reopening it | **YES.** Any attempt to give workspace channels the /home ontology-sharing matrix reopens an explicitly-refused case. **This is a ruling, not an edit.** |
| **F-340 / the FIFTH TAB — "A RULING IS OWED"**: the info-panel tab row's width budget was measured for **four** tabs at 380px | `docs/REFACTOR-FINDINGS.md:4364`; `docs/specs/home-knowledge-panels.plan.md:175`; `commit 975747ff` | *"adding a sixth tab, or any info-column width change"* | **YES.** Any face the uplift adds to the workspace info column hits this. (Artifacts had to share the Threads slot for exactly this reason — `commit 8aa774d7`.) The 2026-09-13 drag handle partly relieves it but does not settle it. |
| **F-666 — the channel Knowledge tab has ZERO hosts.** Component, hook and four routes are live with no caller. *"Re-adding the face needs Samuel's word"* | `docs/REFACTOR-FINDINGS.md:8124`; `docs/INVARIANTS.md:563` | Samuel's word | **YES.** The uplift must decide whether the tab returns or the shelf becomes the only model — it cannot quietly re-pass the capability. |
| **F-341 — the live-agent posture strip has no equivalent of M6's warning.** *"Filed, not built — Samuel may want the warning there too"* | `docs/REFACTOR-FINDINGS.md:4388`; `docs/specs/home-knowledge-panels.plan.md:181` | Samuel's word | **YES** if the uplift touches the Settings/posture surfaces. |
| **F-333 — does the knowledge audience ceiling extend to agent TEMPLATES?** *"the trade and the two options are F-333, for Samuel"* | `docs/REFACTOR-FINDINGS.md`/`docs/specs/home-agents-tab.plan.md:59,65`; `docs/ENGINEERING.md:4339-4342` | Samuel picking one of the two options | **YES** — it pairs with F-334; template sharing is the same mechanism. |
| **Q4 / Q5 / Q6 on the /home Agents face** (visual parity across faces; owner-flooring container writes; renaming one "Agents"). *"Samuel's-taste reversals he may make on review; defaults ship as specced"* | `docs/specs/home-agents-tab.plan.md:81-82` | review | **YES — Q4 IS a parity question**, and the doc says a reversal for visual parity is *"an ENGINEERING.md entry, not a styling choice."* |
| **No container→home COPY** — *"symmetric mechanism, asymmetric argument — ask if wanted"* | `docs/specs/home-agents-tab.plan.md:59` | Samuel asks | **YES** if the uplift wants symmetric movement between shelves. |
| **F-330 — `canEdit` FALLS OPEN wherever `MyAccessProvider` is absent**, and no host outside the knowledge page mounts one. Fix shape prescribed: report PROVIDERLESS distinctly from PENDING, **do NOT flip the default closed** | `docs/REFACTOR-FINDINGS.md:3838`; `docs/specs/home-knowledge-panels.plan.md:178` | *"a third host mounting the knowledge tree"* | **YES** — the uplift is a third host by definition. |
| **Ontology R9 — whose ANCHOR a peer resolves inside a shared container is UNDECIDED** | `docs/specs/home-ontology.md:25,176` | a peer resolving an anchor in a shared container | **YES** if ontology reaches multi-member workspace channels. |
| **Ontology R7 — `useOntologyRealtime` still subscribes per WORKSPACE**; client-side narrowing not built | `docs/specs/home-ontology.md:26` | a peer mounted on an owner's container seeing unshared frames | **YES**, same condition. |
| **Ontology R11 — a peer creating inside a lent ontology bills the container's owner.** *"Stated, not fixed"* | `docs/specs/home-ontology.md:27` | a billing change touching lent ontologies | **LIKELY** — workspaces bill by seat, so a lent ontology crossing into one changes the payer. |
| **Ontology Q9 — an object in two clusters, one shared.** *"The sharpest consequence of R5, and it needs Samuel's word"* | `docs/specs/home-ontology.md:164` | any per-ontology write path | **YES** if ontology crosses surfaces. |
| **F-343 — `/home` cannot tell a MEMBER from a GUEST inside a container**; `containerTarget.role` is hardcoded `"owner"`, and two live buttons 403 | `docs/REFACTOR-FINDINGS.md:4492` | — (open) | **YES — and it is a prerequisite.** Every role-shaped affordance on /home is currently a guess; nothing on /home can be made correct for a multi-member surface until this lands. |
| **F-342 — three base-list readers stayed UNFILTERED across the home/workspace shelf split**; workspace SEARCH leaks home-shelf bases | `docs/REFACTOR-FINDINGS.md:4426` | *"item 2 is the one worth a ruling"* | **YES** — `?shelf=` is the parity seam itself. |
| **F-710 — a quiet account opens `/home` to three collapsed boxes and no sentence.** *"OPEN — needs a ruling from Samuel, not a fix"*; the `Earlier`-closed default is *"the one part of this Samuel did not state"* | `docs/REFACTOR-FINDINGS.md:9404, 9418` | Samuel's word | **YES** if wells come to the workspace list. |
| **#33 — `window.prompt` rename UI** on the workspace knowledge tree | `docs/TRACKED-DEBT.md` §#33 | a dedicated PR | **YES** — /home now edits names in place everywhere; a native `prompt()` on the workspace side is the same gap one surface over. |
| **G20 / F-450 — "channel work is answered into the channel" is still a SENTENCE, not code.** *"Needs Samuel: land the field in batch 3, or retire the guardrail"* | `docs/specs/mcp-v2-wave-b.md:272,552`; `docs/REFACTOR-FINDINGS.md:7239` | Samuel | **YES** — it violates the standing *"a rule an agent is TOLD must have a fence in the code"* ruling, and the uplift touches channel behaviour. |
| **F-513 — "shared" = any channel with >1 member, whatever container kind.** *"Desktop Agent default, Samuel may reverse"*, reversible in one predicate | `docs/REFACTOR-FINDINGS.md:7503`; `docs/specs/mcp-v2-wave-b.md:351-362` | Samuel's review | **YES — confirm before building on it.** It is a home↔workspace equivalence claim. |

### B.2 — Items the uplift does NOT trigger (recorded so they are not swept in)

| Item | Where tabled | Revive trigger | Verdict |
|---|---|---|---|
| **F-650 — the five `canSee*` TS predicates are NOT deleted; DEFERRED BY RULING to RLS phase 3.** *"A conditional row whose condition is unmet is not a row you execute carefully; it is a row you do not execute"* | `docs/INVARIANTS.md:104`; `docs/ENGINEERING.md:6200-6206` | `RLS_PHASE_2` default-ON for one release **AND** `rls-redteam` green per predicate | **NO** — two named preconditions, neither met. |
| **`sections=N` on `get_tree`/`list_dir`** — measured (~1 MB of bodies for ~12 rendered chars) and **not built** | `docs/INVARIANTS.md:1290`; `docs/ENGINEERING.md:6424` | a stored `section_count` worth a schema change | NO. |
| **Deny-on-unclassified (R3b)** — considered and DEFERRED; *"turning an allow-list into a deny-list is a change to make deliberately, not as a side effect"* | `docs/INVARIANTS.md:1468` | a deliberate posture change | NO. |
| **Channel-wide answerability** — *"FLAGGED, NOT BUILT… it lets a bystander steer somebody else's agent with one click"* | `docs/INVARIANTS.md:465` | a deliberate widening | NO — but note it is the kind of thing a multi-member workspace makes tempting. |
| **The $7.99 legacy seat subscription is not migrated** — *"Samuel's decision and not a deploy step"* | `docs/ENGINEERING.md:6626-6628`; `docs/specs/credit-model-v2.md:436` | Samuel deciding to raise that customer's price | NO. |
| **F-322 — launch depth cannot cross the wire**; **F-374 — the cross-machine direction loop is an accepted unbounded lane** | `docs/REFACTOR-FINDINGS.md:3502, 5426` | a depth column able to cross the wire | NO. |
| **F-344 — applying triage to RUNNING sessions.** *"Recorded as F-344 rather than decided quietly in a filter predicate"* | `docs/REFACTOR-FINDINGS.md:4527`; `docs/ENGINEERING.md:4766` | someone asking to reverse ruling 4's fan-out | NO (and the triage module itself was deleted 2026-09-02). |
| **`Agent` and `Skill` off the `full` profile** — *"the one Wave A default that is really a ruling… One line reverses it"* | `docs/specs/mcp-v2-architecture.md:312-317`; `docs/INVARIANTS.md:1470` | Samuel loosens it | NO. |
| **`direct_agent` gets NO own-channel lane** — *"filed as a finding, deliberately not built"* | `docs/specs/agent-direct-lane-and-escalations.plan.md:412` | agent→agent direction is asked for | NO. |
| **X0 — Cursor registers and does not ship** (`session.interrupt: 'unverified'`); *"Dopl may not own a session it cannot stop."* Clearing X0 *"remains Samuel's call"* | `commit 0f19c938, 0f7fe1d1`; `docs/INVARIANTS.md:1328` | Samuel | NO — still owed, unrelated to parity. |
| **Ontology typed fields — ELEVEN decisions Samuel must rule on**; *"Nothing below is built yet"* | `docs/specs/ontology-typed-fields.md:141-157` | Samuel rules the eleven | NO, **unless** the uplift touches ontology fields. ⚠ §2 of that doc calls its principles *"non-negotiable unless Samuel overrules"* while §8 says eleven of the same decisions are still his — **it is a DRAFT asserting settledness it does not have.** |
| **Inline approve/deny UI for tool-permission gates — DROPPED off board** by Samuel 2026-09-16 | Dopl KB `Dopl Development › tech-debt/channel-permission-approve-deny-ui.md` | a fresh ruling | NO — taken off the board deliberately, and three of its files are at the 500-line cap. |
| **Artifacts design v1 — RULED, ACCEPTED WHOLESALE 2026-09-05, NOT BUILT.** All five decisions ruled as recommended; implementation scheduled after the verification pass, and task 10 must land first | Dopl KB `Dopl Development › Artifacts design v1` (Mobile Command Center #1220/#1222) | task 10 landing + the verification pass | **PARTIALLY.** The *face* shipped on /home only (`commit 8aa774d7`); the KB entry explicitly lists **"web renderer"** among the things *deliberately not designed*. Whoever ports Artifacts to the workspace surface is building the undesigned half. |
| **Guest-role open questions 1–5**; **guest-web R1–R8** (R4 and R7 accepted *for MVP only*); the **guest web route go-live** ("a separate go-live decision") | `docs/specs/guest-role.plan.md:76-81, 74`; `docs/specs/guest-web-channel.plan.md:130-157` | guest work / a go-live decision | NO unless the uplift touches the guest lane. ⚠ R4's blast radius was measured against the **two-member cap Samuel retired the next day** — *"Re-rule or re-measure… before quoting this paragraph."* |
| **F-296 / F-297 / F-298 / F-299** — deleting a container blocks nobody; the public claim surface is unthrottled; no per-user mint quota; a claim reveals both parties' emails with no accept step. **"FOUR PRODUCT QUESTIONS… DEFERRED TO SAMUEL, NOT SETTLED"** | `docs/INVARIANTS.md:355`; `docs/REFACTOR-FINDINGS.md:2547, 2567, 2593` | Samuel | NO for UI parity — but F-299 is flagged *"re-ask Samuel"* and is a live privacy item. |
| **F-337 — `check-doc-refs` ships as a RATCHET** with a dated baseline over 613 dead references, not a red gate | `docs/ENGINEERING.md:4274-4277` | working the baseline down | NO. |
| **S-4 / S-7 / S-17 / #19 / #20** (globally-unique slugs, slug-generator consolidation, `Database` generic, file-size splits, `mcp-server.ts` split) | `docs/TRACKED-DEBT.md` | a dedicated PR each | NO — but **#19/#20 overlap F-688**, which is a gate (§C). |
| **The whole `docs/DRIFT-LEDGER-2026-08-30.md` wave sequencing** (Wave 0 gates → Wave 5 realtime) with its **blocking-ASK order** | `docs/DRIFT-LEDGER-2026-08-30.md:1199-1262` | the wave being scheduled | **NO as a tabled item — YES as an input.** It is a ready-made plan for most of this uplift. Its own advice: ***"Gates first… without them §4 is re-audited in six weeks."*** |

---

## C. Open findings that touch either surface

Measured against `docs/REFACTOR-FINDINGS.md` at HEAD. ⚠ **Status is not greppable from the heading**: the file
has two heading forms, and status lives in the heading, a `Status:` line, or nowhere at all (the newer
`## F-NNN —` form dropped the field, so the body *is* the status). Raw header count: **463**; 337 carry no
resolved marker in the heading, of which ~60 are in fact resolved on a `Status:` line. Every row below was
resolved against its own body.

### C.0 — Gate before anything starts

| F | Line | Note |
|---|---|---|
| **F-688** — sixteen unexempted files over the 500-line cap; **the root lint is RED at HEAD** | `:8401` | **Treat as a gate.** Any parity branch starts non-green. Per Samuel's standing rule, red CI is a P0. Overlaps `docs/TRACKED-DEBT.md` #19/#20. |

### C.1 — The spine: open findings that ARE the parity problem

| F | Title | Line | Status as written | Surface | Should the uplift absorb it? |
|---|---|---|---|---|---|
| **F-343** | `/home` cannot tell a MEMBER from a GUEST inside a container, so two of its affordances guess | `:4492` | `Status: **open**` | home | **BLOCKS — prerequisite.** `GET /api/home/channels` carries no caller role; `containerTarget.role` is hardcoded `"owner"`; two live buttons 403. |
| **F-342** | Three base-list readers stayed UNFILTERED across the home/workspace shelf split | `:4426` | `open — item 2 is the one worth a ruling` | both | **ABSORB.** `?shelf=home\|workspace` *is* the parity seam; workspace SEARCH leaks home-shelf bases. |
| **F-666** | Channel Knowledge tab has ZERO hosts (component + hook + 4 routes, no live caller) | `:8124` | `OPEN (ruled absence, not debt)` | both | **BLOCKS — needs Samuel.** See §B.1. |
| **F-402** + **F-551** | A home container's channel can still carry `is_direct = true`, and a THIRD surface named it after its peer / the thread's "other party" is derived in two places from two sources | `:6298`, `:7598` | `✅ MASKED, the DATA is still open` / `**OPEN**` | both | **ABSORB.** The 2026-09-01 ruling *"a channel's identity is its own name, never its roster's"* is applied in `home-rows.ts › channelTitle` and **masked, not fixed**, in `channel-display.ts › channelDisplayName`. Two derivations of one name is exactly the drift class the uplift exists to remove. F-551's fold is a one-import fix. |
| **F-513** | "Shared container" is `kind='link'` only, so a multi-member `standard` workspace reads as "solo" | `:7503` | `RULED 2026-09-02 (Desktop Agent default; Samuel may reverse)` | both | **ABSORB — confirm the ruling first.** |
| **F-334** | Sharing a template BEYOND one channel has no mechanism | `:4058` | `**open**` | both | **BLOCKS.** Home shares by container; workspace has no equivalent. |
| **F-330** | `canEdit` FALLS OPEN wherever `MyAccessProvider` is absent | `:3838` | `**open**` | home | **BLOCKS.** Every /home knowledge CRUD affordance is enabled by default. Fix shape is prescribed — do **not** flip the default closed. |
| **F-678** | `/billing/[segment]` renders workspace plans for a `kind='link'` container; Team checkout 400s | `:8563` | `OPEN` | both | ABSORB — same container-kind-branching class as F-564. |
| **F-652** | "Needs you" reads an ACCOUNT-wide endpoint and throws most of it away | `:8046` | `**OPEN.** Correct today, wasteful today` | ws (home data) | ABSORB. |
| **F-710** | A quiet account opens `/home` to three collapsed boxes and no sentence | `:9404` | `OPEN — needs a ruling from Samuel, not a fix` | home | ABSORB (needs Samuel). |
| **F-709** | A failed optimistic write rolls back every CONCURRENT optimistic write on the same cache key | `:9383` | `OPEN. Pre-existing and generic` | both | ABSORB — `use-api-mutation.ts` whole-payload snapshot; bites the /home Pinned well. |
| **F-471** | `/home`'s scope-C caption still describes a restriction ruling #18 removed | `:7383` | open | home | ABSORB — stale copy. |
| **F-687** | The base page's inline description editor lost its only mount when Changelog replaced Contents | `:8371` | open (no Status line) | home | ABSORB — two orphaned modules. |
| **F-345** | The 28px icon-button recipe is hand-written in FIVE more places | `:4558` | `⚠ REWRITTEN 2026-08-30 … still OPEN` | both | ABSORB — visual-parity debt across /home and the channel panes. |

### C.2 — Channels surface, members, visibility

| F | Title | Line | Surface | Absorb? |
|---|---|---|---|---|
| F-058 | No unread / notification surface for Channels outside the Channels page | `:382` | both | **ABSORB — the canonical parity gap.** |
| F-211 + F-213 | Mentions are per-channel and unbackfilled; the mention gate is live before the surfaces that make an untagged message findable | `:1435`, `:1467` | both | **BLOCKS** — pairs directly with the 2026-09-15 Mentions rulings. |
| F-219 | A non-member public channel is listed with a live composer and no join affordance | `:1535` | ws | **ABSORB** — pure UI parity defect. |
| F-220 | `channels-skeleton.tsx` draws a two-pane page the product no longer has | `:1544` | ws | **ABSORB** — the skeleton-mirrors-the-frame ruling (A.11) names this exact defect. |
| F-318 | Three skeleton composites announce NOTHING | `:3370` | both | ABSORB (a11y). |
| F-222 | ui-sync watches ONE workspace, last-writer-wins, now >1 window can ask | `:1578` | both | **BLOCKS** — multi-window / multi-container. |
| F-061 | Workspace admins have no visibility into private channels | `:410` | ws | ABSORB — product call the uplift should settle. |
| F-063 | `onlineMemberCount` costs 2 extra queries per channel LIST and renders nowhere | `:418` | ws | ABSORB (cheap). |
| F-023 | Effective-access rules encoded twice (pure display fn vs server enforcement) | `:250` | both | ABSORB. |
| F-100 | The WEB roster still shows every member's EMAIL to every member; the MCP half is closed | `:644` | ws | **ABSORB — and only in the raising direction** (see A.8). |
| F-326 / F-327 | The mentions service is the one guest-floored write with no channel-membership fence / nothing enforces "a link container holds exactly ONE channel" nor that it is private | `:3679`, `:3702` | server | **BLOCKS** — the home-container invariant is unenforced. |
| F-604 / F-662 | A grant is RECORDED but the lent row does not appear in the target's list | `:7919`, `:8070` | both | **ABSORB** — `listBases`/`listTemplates` still do not SURFACE a lent row. Directly downstream of B11. |
| F-620 | Two MCP ref resolvers narrow to the CURRENT container, so B2's id door is unreachable | `:7941` | server | **BLOCKS — needs Samuel on the roster question.** |
| F-602 / F-603 | `PUT /api/resource-grants` is not `sessionOnly` while the channel-grants route is / `resource_grants` has three TS writers and no shared repository | `:7896`, `:7910` | server | ABSORB (F-602 wants Samuel's word to stand or flip). |
| F-181 | The mutation layer cannot express a PREDICATE invalidation | `:1114` | both | ABSORB. |
| F-673 / F-674 | A `kind='personal'` container is assumed single-member with nothing enforcing it / `PERSONAL_SINGLE_MEMBER` is a 402 no UI knows | `:8514`, `:8524` | both | ABSORB. |
| F-190 / F-191 | `channel_members` CDC may have gone dark for `authenticated` / the C-20 sweep leaves SESSION and THREAD-PARTICIPANT rows | `:1202`, `:1221` | server | ABSORB if roster changes must propagate live. |
| F-073 / F-105 | No delivery/read acknowledgment signal / nothing ever closes a thread | `:473`, `:685` | both | ABSORB. |
| F-550 | The composer offers agent handles the transcript cannot tint | `:7589` | both | ABSORB. |
| F-712 | `artifactSpans` counts a busy room's artifacts off a PostgREST-capped page | `:9445` | ws | ABSORB (pairs with the Artifacts port). |
| F-708 / F-711 | The agent window's tab strip and collapsed rail are not reachable as the widgets they claim / `bits.tsx › agentAccent` has no call site left | `:9364`, `:9420` | both | ABSORB (a11y; dead kit). |
| F-403 | Five whole-workspace list reads still unbounded; PostgREST already clipping | `:6327` | server | **BLOCKS at scale.** |
| F-232 / F-238 | The deferred doorbell / the SPA bridge mirror | `:1681`, `:1758` | both | ABSORB — both are surface-drift classes. |

### C.3 — Agents, knowledge, ontology

| F | Title | Line | Absorb? |
|---|---|---|---|
| F-341 | Live-agent posture strip lacks M6's warning; *"Samuel may want the warning there too"* | `:4388` | ABSORB (needs Samuel) |
| F-344 | Tiered wake governs DORMANT sessions only | `:4527` | BLOCKS in multi-agent rooms |
| F-333 | Container template copies are invisible to agents in that channel under B1 | `:4020` | ABSORB with F-334 |
| F-335 | Workspace list-item type hand-mirrored across server + SDK; `iconUrl` drifted | `:4098` | ABSORB |
| F-278 | The KB-attach fence is a HAND COPY of `canSeeBase` | `:2165` | **BLOCKS** — the copy will not notice a widening |
| F-277 | Agent-template team sharing is a SECOND grant table beside `team_resource_access` | `:2151` | ABSORB |
| F-311 / F-312 | The Sent lane cannot see a THREADLESS post / an outbound decision has no doorbell | `:3110`, `:3140` | ABSORB — visible in **both** agent panels |
| F-351 / F-368 | A threadless agent post never gated renders nowhere / `agent-panel.tsx`'s header contradicts what it renders | `:4848`, `:5317` | ABSORB |
| F-376 | A direction says nothing about WHO sent it; *"the NAME is still open"* | `:5458` | ABSORB — identity is a surface fact |
| F-393 | `DesktopSessionSummary` carries no runtime; a per-spawn override is invisible to Stop | `:6076` | ABSORB |
| F-448 / F-450 | The web agent-handle INDEX misses bare `@<id>` / G20 never shipped | `:7217`, `:7239` | ABSORB — both are channel-surface behaviour |
| F-703 | `read_sessions` publishes a handle and no NAME | `:9081` | ABSORB — directly downstream of the 2026-09-15 display-name ruling |
| F-680 | The knowledge READ CEILING is base-keyed, so a FOLDER attachment re-points rather than narrows | `:8108` | **BLOCKS — needs Samuel's word** |
| F-574 | The Skills KB picker lists every base in the workspace, private ones included (mitigated only with a flag that is **off by default**) | `:7685` | **BLOCKS** — a visibility leak on the workspace surface |
| F-682 | A lent reader's snapshot shares the LENDER's whole membership budget | `:8186` | ABSORB |
| F-026 / F-165 / F-017 | Web + SPA pull the whole ontology graph per visit / `getSnapshot` reports nothing about its ceilings / PublicId rollout skipped for clusters | `:258`, `:995`, `:241` | ABSORB (perf / consistency parity) |
| F-417 | The four review rulings R1–R4 of 2026-09-02, as **Desktop Agent DEFAULTS** | `:6883` | **ABSORB AS INPUT** — *"decisions recorded, code shipped. Not debt; a standing question."* |
| F-697 / F-699 / F-707 | 2026-09-14 review residue / a verdict-bearing row with `recipientAgentIds: null` feeds NOBODY / the launch-name CHECK does not forbid control characters | `:8896`, `:8960`, `:9340` | ABSORB (F-699 blocks the wake path) |
| F-093 / F-159 / F-275 / F-300 / F-304 / F-329 / F-421 | File-size backlog · write-layer gaps · cross-feature imports · presence fan-out linear in relationship count · migrations applied under non-filename versions · B1 is a tripwire not a fence · the home-channel rule restated per call | `:584`, `:958`, `:2123`, `:2636`, `:2782`, `:3783`, `:6987` | Infra that gates the work rather than parity items in themselves |

### C.4 — Live defects from the 2026-08-30 drift audit that are still the workspace side's

From `docs/DRIFT-LEDGER-2026-08-30.md` §2, measured against `v1.22.0`. **Re-measure before acting** — the
audit is 18 days old. D8 was closed by ASK-1; the rest were open at capture.

`D1` refused `/api/billing/status` paints fabricated numbers · `D2` five overview reads + ten entitlement keys
throw on a key-absent cached entry · `D3` `useToggleBaseStar` throws on a stale cache entry · `D4` a workspace
VIEWER sees live Delete + Settings on every knowledge base · `D5` the landing nav's closing menu card swallows
the next click · `D6` `dopl://open?target=/link/tok` parses as a workspace slug · `D7` two undialogged modals
mounted on every workspace page · `D9` every confirmation dialog wears a drifted white face · `D10`
`.lightScope` silently reverts the 2026-08-19 secondary-ink darkening · `D11` the channels page paints two
different skeletons in sequence · `D12` the guest lane shows fixture data and dead buttons to an external
person · `D13` `GET /api/workspaces/me` is a third unlocked door on `resolveActiveWorkspace` · `D14`
`smoke-billing.mts` prints a cap it does not assert.

**D4, D7, D9, D11 and D12 are straightforward parity items** — each is a place where the workspace surface
does something /home does not.

---

## D. Contradictions

Each is given with the **later-wins reading** the archive supports. 🚩 marks the ones **only Samuel can settle** —
where later-wins does not resolve it because the two rulings are about different things, or the later one was
never aimed at this question.

### D.1 — 🚩 "The two surfaces must match" vs. a run of deliberate home-only rulings

**The conflict.** 2026-08-30 is unambiguous: *"the workspace pages adopt /home's frame model and palette —
**the two surfaces must match**"* (`docs/DESIGN-SYSTEM.md:94`). But at least six rulings **after** it are
deliberately one-surface, and none was framed as an exception to it:

| Home-only ruling | Source | Is the asymmetry reasoned? |
|---|---|---|
| The `@ N` mention pill exists on /home and is **forbidden** in the channels sidebar | `docs/DESIGN-SYSTEM.md:305` | **Yes** — `Channel.unread` is a BOOLEAN there; a numeric badge with no count behind it would be a lie |
| `AvatarStack`'s `2xs` *"HAS NO `Avatar` TWIN ON PURPOSE"* | `docs/DESIGN-SYSTEM.md:303` | **Yes** — stated in the doc |
| The credit bar drops its `label` only on /home | `docs/DESIGN-SYSTEM.md:312-313` | **No reason recorded** — just *"exactly one caller omits it"* |
| `HOME_CARD_FACE_SELECTED` (the black selected row) is /home's alone | `docs/DESIGN-SYSTEM.md:304` | **No** |
| The workspace Agents page is *"pixel-unchanged"* while /home went flat | `docs/ENGINEERING.md:4599` | **Partly** — and Q4 is explicitly flagged for review |
| The Mentions category is top-level on /home; the workspace panel keeps the collapsed disclosure | `commit 19e83461` | **Yes** — *"a `defaultOpen` flag would make one component mean two layouts"* |

**Later-wins reading:** the 2026-08-30 ruling is about the **frame model and the palette**, and those two
things really did converge. It is **not** a blanket instruction that every /home affordance must appear on the
workspace page. **But it is quoted as though it were**, and the uplift will be tempted to read it that way.

🚩 **Only Samuel can say which of the unreasoned three (credit-bar label, selected-row face, Agents-page
flatness) are asymmetries *by ruling* and which are simply not-yet-ported.**

### D.2 — 🚩 "Keep the picture and make it true" vs. "an empty heatmap is itself a claim"

- `docs/ENGINEERING.md:582` (2026-08-18): Samuel ruled four pieces **stay as hardcoded UI** — the activity
  heatmap among them — *"because an empty heatmap is itself a claim."*
- `docs/ENGINEERING.md:3617` (2026-08-25): Samuel sent the honest-but-plain replacement back the same day —
  *"The ruling was never 'pick the honest one of the two things on screen'; it was **keep the PICTURE and make
  it true**."*

**Later-wins reading:** keep the picture, wire it. **/home was wired (2026-08-25) and the channels page was
wired (2026-09-05, F-316 CLOSED)** — so on the face of it this is resolved. **But** `docs/ENGINEERING.md:3643`
still records the workspace page mapping the **fixture**, and F-316's wiring was gated on *"a cost decision for
Samuel"* (31 counted bins per channel selection). 🚩 **Verify against code which of `:3643` and
`docs/INVARIANTS.md:575` is current** — this is exactly the code-vs-doc disagreement CLAUDE.md says to file as
a finding rather than silently pick a side.

### D.3 — The guest Knowledge tab was ruled both ways, five weeks apart

- 2026-08-27 (F-340, option E): *"the DESKTOP host stops passing the Knowledge capability; the **GUEST lane
  keeps its tab**"* — recorded as settled and **pinned in both directions** by a test
  (`docs/DRIFT-LEDGER-2026-08-30.md:576`).
- 2026-09-04 (F-666): *"There should be **no Knowledge tab at all for the web**: just Info, Threads, and
  Agents"* — since then **no host passes it**.

**Later-wins:** 2026-09-04 wins; the guest lane lost its tab too. **The drift ledger's §5 row is therefore
stale** — anyone reading *"Guest keeps the 5-tab info panel including Knowledge"* as a live ruling is reading a
superseded one. **Re-adding the face needs Samuel's word** (`docs/INVARIANTS.md:563`).

### D.4 — "Signup still seeds a standard workspace" vs. "a new user gets ONE personal container and no standard workspace"

Both sentences are in **one document**: `docs/specs/mcp-v2-wave-b.md:213` vs `:456` (which flags itself —
*"THE PARENTHESIS IS THE ONE PLACE THIS SLICE CONTRADICTS THE SPEC"*) and `:584`.

🚩 **This decides whether a new user even HAS a workspace to reach parity with.** Later-wins cannot settle it:
the two statements are a shipped behaviour and a spec, in the same wave. **Measure the code, then ask.**

✅ **RESOLVED 2026-09-17 — MEASURED, THEN RULED. `:456` WAS RIGHT AND `:213`/`:584` WERE THE DRIFT.**
The measurement: the ONLY two provisioning call sites are `src/app/auth/callback/route.ts` and
`workspaces/server/segment.ts › getBootState`'s no-segment branch, and both call
`workspaces/server/service.ts › ensurePersonalContainer`. `service.ts › createWorkspaceForUser` is
the only remaining workspace INSERT and no signup path reaches it. **So a new user gets ONE
`kind='personal'` container and no standard workspace, and has since wave B B14 shipped** — the
sentence at `:213` described a plan the slice that implemented it deliberately did not follow, and
`:456` recorded the contradiction rather than glossing it, which is the only reason this was
answerable without a database.
Samuel's ruling **R-35** (2026-09-17) makes it the rule: *"New users should not be getting a
workspace. It should be the home space. Home spaces are the only thing new users get."* ⚠ **The
ruling asked to "remove any code that mints one" and the answer is that there is none** — what it
actually bought is **R-34's other half, PERMANENCE**, which nothing enforced: an owner could
`DELETE /api/workspaces/{segment}` their own home space. See `docs/INVARIANTS.md` §4A.
⚠ **THE TRANSITION IS NOT A DELETION ORDER:** existing standard workspaces stay, untouched; only the
default-minting stops (and it had already stopped).

### D.5 — The home shelf as a PLACE vs. the personal container

- 2026-08-26: `home_scoped` is a **noun and a place**, with a reciprocal workspace exclusion
  (`docs/ENGINEERING.md:4402-4404`).
- 2026-09-02 (B10/#18): **one personal container per user**; `home_scoped` **retires**; the shelf is an
  ordinary row in a container (`docs/ENGINEERING.md:6213`; `commit 2de69cf6`).

**Later-wins:** B10. ⚠ The *effect* (two places over one table) survives; the *mechanism* does not. Anything in
the uplift reasoning from `home_scoped` is reasoning from a dropped column. Note also that
`commit 2de69cf6` says **the REST `?shelf=` parameter is deliberately kept** and that this is *"not a
contradiction: /home and the workspace pages are two surfaces that must each name ONE container and cannot rely
on an ambient default."*

### D.6 — Immutability, and three other 24-hour reversals

| Rule | Reversed by | Later-wins |
|---|---|---|
| A link container's roster is *"exactly the pair the claim minted, forever"* (2026-08-23, `LINK_CONTAINER_IMMUTABLE`) | 2026-08-24/25 channel-first inversion, then 2026-08-26 cap retirement | **Reversal wins; "do not reinstate"** (`docs/INVARIANTS.md:259`) |
| `containerCopyDraft` forces `visibility: 'private'` (2026-08-27) | forced `'workspace'` with an audience confirm (`docs/ENGINEERING.md:4516`) | later wins |
| No-modal-in-modal (2026-08-27) | reversed the same wave (`docs/ENGINEERING.md:4565`) | later wins |
| Every containment option gets an INLINE description (2026-08-19, `:2005`) | **the same day's third ruling** — minimal copy (`:2007`) | later wins; ⚠ a reader landing on `:2005` first gets the reversed rule |
| The `channels-v2` directory name is *"a choice rather than an oversight"* (2026-08-18) | *"nothing should be named channels v2"* (2026-09-14) | later wins |
| Minted handle suffixes are **positional over the live set** (2026-09-07) | **durable, decided once at commit time** (2026-09-15) | later wins — the positional rule re-pointed live addresses |
| *"An empty well is not rendered"* (2026-09-13) | *"keep the gray boxes even if there's nothing in them"* (2026-09-15, generalised 2026-09-17) | later wins |
| The flat agent message row (2026-09-13) | **reverted the same day** — the *"more modern UI"* instruction was *"a voice-to-text accident"* (`commit 6ddd3f89`) | reversal wins |
| Agent cap *"the number does not go up"* (F-272) | 6 → 15 (2026-09-01) | later wins; the older quote is dead |
| Three-tier wake (2026-08-28) | tiers 2/3 and the triage loop **deleted** (2026-09-02, B6) | later wins |
| *"There is no `op="share"`, deliberately"* (2026-08-27) | `op="grant"` shipped (B11, 2026-09-02) | later wins |
| A tab is *"a fixed size"* → `w-[180px]` (2026-09-13) | a tab **HUGS** its label, caps at 200px (2026-09-15) | later wins; ⚠ `docs/specs/agent-window-tabs.md:32` still says `w-[180px]` |

**All of these follow one house convention, which the uplift must expect:** *"the losing argument stays
readable."* Superseded text is **kept in place**, so a grep frequently hits the dead side first. See
`docs/specs/agent-colors.md:59`, `docs/specs/home-ontology.md:28`, `docs/specs/mcp-surface-v2.plan.md:722`.

### D.7 — The ontology guest floor contradicts itself in place

`docs/specs/home-ontology.md:124` says *"⚠ Do not floor one to `minRole: "guest"`"* and then, two clauses
later, *"✅ **REVERSED 2026-09-09 BY SAMUEL'S RULING (F-685).** Six floors ARE `guest` now."* Same shape at
`:29` vs `:28`. **Later-wins: the floors are `guest`, `GUEST_ALLOWED` is 27.**

### D.8 — Two guardrails are still prose, against the standing rule that prose is not a guardrail

The standing rule is `docs/specs/mcp-v2-architecture.md:168`: a prohibition told to an agent **must have a
fence in the code**. `docs/specs/mcp-v2-wave-b.md:552` measures **two** residuals, not one: G18's web residual
(kept by ruling — fine) and **G20/F-450 by default** (not fine — it read as an eighth session-health field
still owed). `:272` corrects a claim made earlier in the same document. 🚩 *"Needs Samuel: land the field in
batch 3, or retire the guardrail."*

→ ✅ **RULED 2026-09-17 (R-36): NEITHER.** No eighth field is landed, and the sentence is **corrected to
SEVEN** rather than deleted — the set is seven, `scripts/check-session-health-drift.ts` holds that number,
and both wave-b rows now say so. G20 stays prose, recorded as a residual rather than glossed.

### D.9 — Rulings made by an orchestrator while Samuel slept, labelled as rulings

`docs/specs/home-agents-tab.plan.md:25` opens: *"SAMUEL'S RULINGS (2026-08-26, **ruled by the orchestrator
while Samuel slept**; all conservative, all for morning review)."* Q4, Q5 and Q6 are still flagged at `:82` as
reversals he *"may make on review"*, and there is no record of that review happening.

🚩 **Treat Q1–Q6 there as defaults that shipped, not as settled decisions** — and Q4 is a parity question.

### D.10 — `ontology-typed-fields.md` asserts settledness it does not have

§2 calls its principles *"non-negotiable unless Samuel overrules"* (`:24`); §8 (`:141`) lists **eleven**
decisions still his to make. The document is a **DRAFT**. Do not cite §2 as a ruling.

### D.11 — Guest-web R4's blast radius was measured against a cap Samuel retired the next day

`docs/specs/guest-web-channel.plan.md:232-246`: R4 was accepted on 2026-08-25 against a two-member cap; the cap
was retired 2026-08-26, so *"minting a further link IS reachable with the relationship intact."* The doc says
so itself: ***"Re-rule or re-measure the blast radius… before quoting this paragraph."*** It also notes the
ruling's wording said *"rename/archive"* when the real set includes **hard channel delete and cascading thread
delete**.

### D.12 — A doc-vs-doc disagreement the drift ledger itself recorded rather than resolved

`docs/DRIFT-LEDGER-2026-08-30.md` §9 records three auditor disagreements, of which one matters here:
**is `src/features/playground/**` a mock tree?** The cross-cutting audit LEAVEs its drift on that basis and
**F-345's own disposition note agrees** — but the legacy audit shows it is **public, linked and live-polling**
(`/playground` in `PUBLIC_ROUTES`, a landing-hero link, a guest-bearer endpoint, four `-live` polling modules,
a reaper cron). **"The legacy reading has the receipts; the exemption people assume it has does not exist."**
F-345's note still needs the correction.

---

## E. Items that need Samuel's ruling, arising purely from this archive

These are **not** engineering questions. Each is a place where a ruling exists for one surface and its
reasoning does not obviously survive the move to a multi-member workspace, or where the archive contains a
question nobody has answered.

| # | Question | Why the archive cannot answer it | Source |
|---|---|---|---|
| **E1** | **Does an ontology reach a WORKSPACE channel?** The whole 2026-09-09 sharing matrix (per-channel none/view/edit, guests, agents inherit, solo toggle) is ruled **home channels only**, and a `kind='standard'` target is refused with a 400. | Q5 is an explicit out-of-scope ruling, not an omission. Reopening it is a ruling. And R9 (whose anchor a peer resolves), R7 (per-workspace realtime) and R11 (who pays) are all **undecided even inside home**. | `docs/specs/home-ontology.md:32-36, 159, 25, 26, 27` |
| **E2** | **Does the workspace surface get the Pinned/Recent/Earlier wells on its channel list?** The pin already is the same server-backed favourite on both surfaces; only the grouping is home's. | Nothing rules against it, and the machinery is shared — but the 24h Recent span and the Earlier-closed default are `/home`-shaped, and **the Earlier default is explicitly *"the one part Samuel did not state"* (F-710).** | `docs/INVARIANTS.md:312`; `docs/REFACTOR-FINDINGS.md:9404, 9418` |
| **E3** | **Does the workspace channel row get the `@ N` mention badge?** | **Ruled against, for a stated reason**: `Channel.unread` is a BOOLEAN there, so a numeric badge would have no count behind it. Carrying the badge means carrying the count — a data change, not a UI port. | `docs/DESIGN-SYSTEM.md:305` |
| **E4** | **Does the Artifacts face come to the workspace channel page?** It is capability-gated to /home, default false, and the workspace page is *"unchanged byte for byte."* | The design was **ruled and accepted wholesale** — but its own doc lists the **web renderer** among the things *deliberately not designed*, and the face only exists because it could share the Threads slot (the tab row is full). | `commit 8aa774d7`; Dopl KB `Dopl Development › Artifacts design v1` |
| **E5** | **Does the channel Knowledge tab come back — on either surface?** Two separate rulings removed it (2026-08-27 desktop, 2026-09-04 web); the component, hook and four routes are live with no caller. | F-666 states it: *"Re-adding the face needs Samuel's word."* The alternative is to make the shelf the only model and delete the lane. | `docs/REFACTOR-FINDINGS.md:8124`; `docs/INVARIANTS.md:563` |
| **E6** | **Is the info-panel tab row allowed a fifth tab, or does the drag handle settle it?** *"A RULING IS OWED."* | The 380px budget was a measurement for four tabs; 2026-09-13 made the width the operator's with 380px as **fallback and floor**. Whether that discharges the budget is a judgment, not a measurement. | `commit 975747ff`; `docs/DESIGN-SYSTEM.md:276, 307` |
| **E7** | **Does the workspace Agents page adopt /home's flat section face?** | The spec that authorised /home's flat face says a reversal for visual parity *"is an ENGINEERING.md entry, not a styling choice"*, and the workspace page was left *"pixel-unchanged"* deliberately. **Q4 was never reviewed.** | `docs/ENGINEERING.md:4584-4599`; `docs/specs/home-agents-tab.plan.md:29, 81-82` |
| **E8** | **Do the three unreasoned home-only design asymmetries port?** The credit bar's missing label, `HOME_CARD_FACE_SELECTED`, and the Agents-page flatness. | Three of the six post-parity-ruling asymmetries carry **no recorded reason**, and the 2026-08-30 ruling says the surfaces must match. | §D.1 |
| **E9** | **Does the workspace Knowledge page keep its audience picker?** | **Ruled YES, for a stated reason** — *"that page's create button names no audience, so it is the one place the question is still worth asking."* Confirm the reason still holds after B10 collapsed the shelf axis. | `docs/INVARIANTS.md:348`; `docs/ENGINEERING.md:4575-4581` |
| **E10** | **Does "Agents" get disambiguated?** /home Agents = template identities; the channel info column's Agents tab = live sessions. *"Renaming needs Samuel's word — record the collision… don't rename."* | The collision was **recorded, not resolved**, on the argument that the two names live on different surfaces. **The uplift puts them on one.** | `docs/INVARIANTS.md:313, 765`; `docs/specs/home-agents-tab.plan.md:31` |
| **E11** | **Is F-513's "shared = any channel with >1 member, whatever container kind" confirmed?** | It is a **Desktop Agent default Samuel may reverse in one predicate**, and it is precisely a home↔workspace equivalence claim the uplift will build on. | `docs/INVARIANTS.md:1449`; `docs/REFACTOR-FINDINGS.md:7503` |
| **E12** | **Does a pre-2026-08-24 home container's `is_direct = true` get lifted?** Those containers' Info cards stay display-only. | *"Lifting that is a one-word ruling, not a code question."* | `commit 43c40598`; `docs/INVARIANTS.md:151` |
| **E13** | **Does a new user get a standard workspace at all?** Two statements in one wave document disagree. | If signup mints only a personal container, "workspace parity" describes a surface most users never reach — which changes the uplift's priority, not just its scope. | `docs/specs/mcp-v2-wave-b.md:213` vs `:456`/`:584` |
| **E14** | **Does a folder-scoped knowledge attachment NARROW an agent's reach, or only re-point it?** | F-680: *"Needs Samuel's word."* The 2026-09-08 ruling asked for folder/entry selection and did not say what it means for reach. | `docs/REFACTOR-FINDINGS.md:8108` |
| **E15** | **G20: land the eighth session-health field, or retire the guardrail?** | A prose-only prohibition stands against Samuel's own standing rule that a rule an agent is told must have a code fence. | `docs/specs/mcp-v2-wave-b.md:272, 552` |
| **E16** | **Do the 31 unruled ASKs from the 2026-08-30 drift audit get answered as a batch?** Only 5 of 36 were ever ruled. Several are literally *"is this /home's or the app's?"* — **ASK-11** (is `CACHE-SHAPE FALLBACK` the house marker or /home-local), **ASK-12** (should `.search-expand` be app-wide or /home's), ASK-9, ASK-13, ASK-24, ASK-25, ASK-26, ASK-27, ASK-35. | The audit's own sequencing says four ASKs **block** work: ASK-9 → P6/P7, ASK-32 → the DiffModal port, ASK-24 → the icon-button batch, ASK-13 → `base-settings-form`, ASK-10 → Wave 5. | `docs/DRIFT-LEDGER-2026-08-30.md:676-1008, 1256-1262` |
| **E17** | **Do the four §4A product questions deferred to Samuel get answered?** F-296 (deleting a container blocks nobody), F-297 (unthrottled public claim surface), F-298 (no mint quota), F-299 (a claim reveals both parties' emails with no accept step). | *"DEFERRED TO SAMUEL, NOT SETTLED."* F-299 is flagged *"re-ask Samuel"* and is a live privacy item that a multi-member workspace makes worse, not better. | `docs/INVARIANTS.md:355`; `docs/REFACTOR-FINDINGS.md:2547, 2567, 2593` |
| **E18** | **Does the guest's workspace CHROME get ported?** ASK-2 redirected the guest somewhere that works but left them *"still wearing a nav they cannot use."* | The ruling explicitly closed the destination question and left the chrome question open. | `docs/DRIFT-LEDGER-2026-08-30.md:748` |

---

## F. Principles — the rules Samuel applies, distilled

These recur across dozens of individual rulings. **A synthesizer should apply these to items the ledger does
not cover**, rather than asking for a new ruling on every one.

| # | Principle | Representative sources |
|---|---|---|
| **P1** | **One implementation per feature; the host NARROWS it, never forks it.** *"as little code as possible, no repeat code."* The mechanism is `ChannelSurfaceCapabilities` — flags that narrow or add, one flag per *story* (*"ONE FLAG, TWO CONTROLS, ON PURPOSE: two would let a future host turn one half off and ship the other half's dead control with nothing saying so"*). A face two trees render is **declared in `src/` and re-exported**, never duplicated; *"A SECOND DECLARATION OF ANY OF THESE IS THE BUG."* | `docs/INVARIANTS.md:44, 563`; `commit c863acf9` |
| **P2** | **Delete, don't disarm.** A retired control is removed, not blanked, and its nav stub goes with it. *"The retirement is a DELETE, not a disarm."* *"delete, don't disarm: there is no nav stub."* The chrome's `status` prop is **DELETED rather than passed empty**; `showNameRow` removed *"rather than left as a dead prop"*; `maxUses` **deleted, not defaulted**. | `docs/ENGINEERING.md:3172`; `docs/DRIFT-LEDGER-2026-08-30.md:701`; `docs/DESIGN-SYSTEM.md:191`; `commit 905e5030`; `docs/ENGINEERING.md:3399` |
| **P3** | **One lane, one surface, one click.** *"a second launch surface fights `resolve`'s singularity."* The launch sheet was **deleted rather than conformed**; one LANE, one FORM. *"Do not mint a second pin store."* | `docs/specs/home-agents-tab.plan.md:57`; `docs/DESIGN-SYSTEM.md:435`; `docs/INVARIANTS.md:312` |
| **P4** | **Minimal UI copy — label + control, no explainer paragraph.** *"WE SHOULD NOT BE EXPLAINING EVERYTHING TO THE USER."* A row is a NAME + a CONTROL plus at most a few-word secondary line. An empty well carries **no placeholder sentence**. A one-off warning is a `ConfirmDialog` on the transition, *"never a standing banner"*. *"remove the line that says the word 'agents.' … It's obvious to the user."* **Pinned as a MEASUREMENT** — `settings-tab.test.tsx › minimal copy` bounds every caption at 8 words. | `docs/INVARIANTS.md:377, 380, 381, 312`; `docs/ENGINEERING.md:2007`; `docs/DESIGN-SYSTEM.md:188` |
| **P5** | **Honest states — a control that can only fail is worse than no control.** *"Never a silent `delivery=none."`* *"a button that reports success over an answer that reached nobody is the failure mode this whole feature exists to remove"* — 403, never a silent strip. *"UNKNOWN is not EMPTY"*: a read in flight and a missing desktop do **not** render as empty. A lost launch name *"is SAID, not echoed"*. A refusal is a **teaching refusal**, not silence. A parked agent *"survives a restart as Idle, or ends VISIBLY. Never as nothing."* | `docs/INVARIANTS.md:584, 1670`; `docs/specs/agent-direct-lane-and-escalations.plan.md:525`; `commit a118614b, 807a9492` |
| **P6** | **Copy that misdescribes behaviour is a defect, not a wording nit.** *"FOUR NARRATION DEFECTS FIXED — each one a line that told an agent something the code does not do."* *"a footgun wrapped in prose is still a footgun."* | `docs/INVARIANTS.md:1165`; `docs/ENGINEERING.md:2700` |
| **P7** | **Prose is not a guardrail — the fence is in the code, server-side.** *"there should be a Dopl actual guardrail in the code."* *"An agent holds its operator's credential and has Bash, so a hidden control is not a fence."* A client-side gate is a **mirror of the server's**, so a reader is not shown an affordance that always 403s — never a permission in itself. | `docs/INVARIANTS.md:151, 1190, 776`; `docs/specs/mcp-v2-architecture.md:168`; `docs/specs/home-ontology.md:63` |
| **P8** | **One fact, one place — a second copy is drift waiting.** *"a grant table would be a THIRD copy of the visibility matrix."* *"the squares and the shade ramp now live in one module, rendered by both surfaces, so they cannot drift apart while only one is wired."* *"I don't know why you're making it different."* Tokens and recipes travel **by reference, never a copied value**: *"a hand-written `text-body font-medium` reads identically today and drifts the day the constant moves"*; `--shadow-raised-hover` is **extracted, not copied**. | `docs/specs/home-agents-tab.plan.md:26`; `docs/INVARIANTS.md:570, 566`; `docs/DESIGN-SYSTEM.md:61, 268` |
| **P9** | **Close a parity gap by raising the weaker side, never by relaxing the stricter one.** *"The MCP surface is deliberately TIGHTER than web. **Do not 'restore parity' by loosening MCP** — close the gap by applying the same admin-or-self scrub to the web `/members` DTO."* | `docs/INVARIANTS.md:1141` (F-100) |
| **P10** | **Keep the picture and make it true.** When a surface shows a fake, the answer is to **wire it**, not to delete the affordance and not to leave the honest-but-plain substitute. | `docs/ENGINEERING.md:3617`; `docs/INVARIANTS.md:570` |
| **P11** | **A port is not a transcription — do not carry dead controls.** The channels page's `Add member` / `Filter members` (no `onClick`) were **deliberately not copied** to /home. | `docs/ENGINEERING.md:3662` |
| **P12** | **Clone the reference exactly; swap only colours and fonts.** *"Look at the home page, that's literally what it looks like."* *"Clone the layout; swap only colours/fonts to Dopl tokens."* *"PIXEL-MIRRORED ONTO SAMUEL'S REFERENCE CHART… the four rulings are ONE picture, not a menu."* | `docs/DESIGN-SYSTEM.md:104, 314`; `docs/specs/agent-window-tabs.md:3-4` |
| **P13** | **Loading states mirror the real frame.** *"way off"* / *"doesn't look at all like the actual UI"* / *"it doesn't look accurate at all needs to be fixed"* — three separate complaints, one of them explicitly about **switching workspaces**. | `docs/INVARIANTS.md:79-82` |
| **P14** | **Deletion is permanent, confirmed, and app-only.** Every destructive action carries an "are you sure"; **MCP deletes are refused at one choke point** so future tools inherit it, and the refusal **names the app**. Carve-outs are explicit and small: a tombstoned DM is live product state; a spend record outlives its room. | `docs/RETIREMENT-UNWIRING-PLAN.md:130-142`; `docs/INVARIANTS.md:488, 490`; `docs/specs/mcp-surface-v2.plan.md:847` |
| **P15** | **Share by REFERENCE, never by copy.** *"grants replace copies"* — *"one object, and an edit reaches everyone it is lent to."* And *"you lend what you created, not what you can read."* | `docs/INVARIANTS.md:767, 1077`; `docs/specs/mcp-v2-architecture.md:333` |
| **P16** | **An agent never exceeds its human, and reach bounds FUTURE reads only.** Every agent cell is a `min` against its operator's. *"IT BOUNDS FUTURE READS, NEVER CONTEXT ALREADY IN THE WINDOW… No fence can un-read that."* Live sessions tighten at the next tool call, never retroactively. | `docs/specs/home-ontology.md:63`; `commit 8e17e059` |
| **P17** | **Fail closed, and refuse in a way that teaches.** 404-never-403 *"so the write is never a room oracle"*; defaults are `false` at every hop — *"fail-closed by default VALUE, the only way a defaulted boolean is safe"*; an unresolved recipient is refused **listing the live handles and the roster**. | `docs/INVARIANTS.md:1141, 584, 280` |
| **P18** | **File it rather than half-build it.** *"If tight, FILE rather than half-build."* F-333/F-334/F-340/F-341 are all filed with their options and blast radius stated, and **nothing was changed for them**. *"a fence is not widened overnight by the agent that found the gap."* | `docs/specs/home-knowledge-panels.plan.md:157`; `docs/ENGINEERING.md:4288` |
| **P19** | **When a constraint moves into the data model, the option that used to express it is DELETED, not defaulted.** | `docs/ENGINEERING.md:3399-3415` |
| **P20** | **A value with no distinct behaviour is prose wearing a schema.** The three ping kinds were refused as message kinds on exactly this ground; *"a capability nothing calls is worse than an absent one."* | `docs/ENGINEERING.md:6194`; `commit 45f92c7e` |
| **P21** | **The losing argument stays readable.** Superseded text is kept in place *"only so the replacement reads as a replacement"*; *"a recommendation edited to match the ruling deletes the evidence that a choice was made."* **Consequence for anyone reading these docs: a grep often hits the dead side first.** | `docs/specs/agent-colors.md:59`; `docs/specs/home-ontology.md:28`; `docs/specs/mcp-surface-v2.plan.md:722` |
| **P22** | **A number carries its measurement date, or it does not go in a doc.** *"Deploy state is a measurement, not a claim… Record the command, not the answer."* Code references are **symbol anchors**, never bare line numbers. Migrations are matched **by NAME, never by filename version**. | `CLAUDE.md` §"Standing rules for writing docs"; `docs/INVARIANTS.md:1931` |
| **P23** | **Code > INVARIANTS > ENGINEERING, applied pairwise.** When code and INVARIANTS disagree you have found a bug in one of them — **say which, in the same change; never silently pick a side.** If you cannot tell which is wrong, **that is still a finding.** | `CLAUDE.md:18-30` |
| **P24** | **Samuel reviews live — never verify by screenshot-and-declare.** *"Never guess on a ruling.* If blocked on a product decision, post `BLOCKED:` and wait." | `docs/specs/guest-web-channel.md:104, 109` |
| **P25** | **Gates before ports.** *"Every one of §3 is an existing mechanism that was not extended; each costs less than the port it protects, and without them §4 is re-audited in six weeks."* | `docs/DRIFT-LEDGER-2026-08-30.md:1199-1202` |

---

## The one hazard this archive exists to prevent

The canonical statement is in a commit body, `commit 905e5030` (2026-09-05):

> *"Every info-pane ruling from 2026-09-05 was implemented on the web channel page (`channels-v2`) and none of
> it on `apps/desktop-ui › pages/home`, which is the pane Samuel had open. **Two compositions of the same
> shared rows.**"* … *"a worker asked which view he meant and the question was never answered because it was
> neither of the two it offered."*

The mechanical cause is one-way imports: `apps/desktop-ui` **can** import root `src/`; the Next tree **cannot**
import `apps/` at all. So home-ward features land in `apps/` and strand there
(`commit c863acf9`: *"THE DIRECTION IS ONE-WAY AND THAT IS THE WHOLE PROBLEM"*).

The archive shows this failure mode firing **at least four times**, each caught one ruling late:

| Ruling | Landed | Reached the other surface |
|---|---|---|
| Info-pane rulings | web channel page, 2026-09-05 | /home, same commit, after the miss was found |
| Mentions inbox | workspace panel | a home channel's Info tab, 2026-09-15 (`commit aa2d212e`) — *"the parity gap this wave keeps finding rather than a missing feature"* |
| Click-to-edit Name/Description | workspace channels page, 2026-09-16 (`commit e937eb1b`) | /home, 2026-09-17 (`commit 43c40598`) |
| The header `Hash` glyph drop | both chromes, 2026-09-16 | /home's row, 2026-09-17 — *"the same 2026-09-16 ruling one surface late"* |

**The generalisable defect, stated in `docs/INVARIANTS.md:151`:** a host that **replaces a slot's body** silently
loses the capability the shared component was already minting. */home's card came to be display-only while
`surface-info-panel.tsx` was already minting the write for a tab it was not rendering.* **Every slot-replacing
host should be audited for this before anything new is built.**

---

## Confidence and gaps

### Confident

- **§A's frame/palette rows, §F's principles, and §D.1–D.6.** These are stated in multiple independent sources
  (INVARIANTS, DESIGN-SYSTEM, ENGINEERING, commit bodies) and several carry Samuel's verbatim words.
- **§B's tabled items.** Nearly every one carries its own revive trigger in the source text; I did not invent
  a trigger for any row.
- **The 2026-08-30 drift ledger's standing** as prior art. Its §5 ("RULED / LEAVE") and §6 ("ASK SAMUEL") are
  explicit, numbered and were built for exactly this purpose.
- **That `docs/DESIGN-SYSTEM.md:94` is the charter ruling.** It is restated at `:311` and again in
  `docs/ENGINEERING.md:2384`, and ASK-31 was settled by it.

### Less confident — verify before acting

1. **Every line number.** Measured 2026-09-17 against `03506fcd`. Per the repo's own rule (`P22`), a line
   number is wrong within a day. **Re-grep the quoted phrase.** Quotes are reliable; locations are a finding aid.
2. **Status classification in `docs/REFACTOR-FINDINGS.md`.** 463 finding headers, two heading forms, and status
   living in three different places (heading / `Status:` line / nowhere). ~60 findings are resolved on a line a
   heading-grep cannot see. Each row in §C was resolved against its own body, but **a handful of borderline
   "open" calls may be wrong in either direction.**
3. **§C.4 (the drift-ledger live defects).** Captured 2026-08-30 against `v1.22.0` — **eighteen days and ~760
   commits stale.** D8 is known closed. Re-measure the rest before scheduling any of them.
4. **Whether F-316's workspace-side heatmap is wired.** `docs/INVARIANTS.md:575` says the channels page is
   wired (2026-09-05, F-316 CLOSED); `docs/ENGINEERING.md:3643` still describes it mapping the fixture. **This
   is a live doc-vs-doc disagreement** and, per `P23`, resolving it against the code is itself a finding.
5. **The "still in force?" column generally.** The house convention is that **superseded text stays in place**
   (`P21`), so any row here could be sitting on a paragraph a later one has quietly beaten. Where I found the
   supersession I recorded it; where a ruling is only stated once, I could not prove it had not been reversed
   somewhere I did not read.

### Known gaps — things I could not reach

- **The Dopl KB base "Dopl MCP Improvement Spec" and its entry "Tech Debt and Tabled Items"** — named in the
  brief, **not reachable** from this connection. `dopl_kb(op="list_bases")` returns only *Orchestration
  Guidelines* and *Dopl Development*, and a cross-scope search was **truncated at the 6-scope cap with 8 scopes
  unsearched**. That entry may contain tabled items §B does not.
- **`docs/ENGINEERING.md` is ~1 MB and was sampled by targeted grep**, not read end to end — CLAUDE.md itself
  says *"do not load it wholesale."* Its §A rows are dense but not provably exhaustive.
- **Chat/channel history.** Several rulings are recorded as having been made *"in the Mobile Command Center
  main room"* (e.g. Artifacts design v1 at `#1220`/`#1222`). The chat archive is not searchable by
  `dopl_search`, so **any ruling made in a channel and never written into a doc, a commit body or the KB is
  invisible to this archive.** That is the most likely source of a missing row.
- **No code was read.** Every "in force?" judgment is doc-and-commit-derived. Per `P23`, code wins — the
  code-auditing researchers may contradict rows here, and where they do, **the doc is the thing to fix**.
- **The 2026-08-30 ASK list was not individually re-checked** for rulings made after that date. Five are
  annotated as ruled in place; the remaining 31 are reported as open **because the document says so**, not
  because I verified each one is still open.
