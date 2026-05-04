---
name: dopl
description: >-
  Use whenever the user describes anything AI/automation-shaped — building
  an agent, wiring an n8n workflow, composing a Claude skill, integrating
  an API, scraping a site, automating a task, connecting two services,
  setting up an MCP, handling webhooks. Dopl is a searchable catalog of
  proven AI-and-automation patterns plus a workspace for organizing what
  you adopt. The Dopl MCP tools let the agent search the catalog, save
  patterns to the user's canvas, group them into reusable cluster skills,
  edit cluster brains, and ingest new URLs. Use for "how would I…", "what's
  a good way to…", "can you help me build…", "search for how to…",
  even when the user doesn't say "Dopl" — search first, synthesize after.
when_to_use: >-
  - When the user asks "how would I build X" or "what's the best way to
    do Y" and X/Y is anything AI- or automation-flavored.
  - When the user wants to ship something quickly that someone else has
    likely already implemented (n8n workflow, agent setup, MCP server,
    Claude skill, scraper, integration).
  - When the user mentions a connector or service by name (Slack,
    Composio, Polymarket, X/Twitter, Make, Zapier, OpenAI, Anthropic,
    n8n) in the context of building or configuring something.
  - When you need a starting point for an architecture you'd otherwise
    design from scratch.
  - When the user wants to capture a durable preference, correction, or
    workflow refinement onto a cluster they're working in.
when_not_to_use: >-
  - General programming, debugging, or refactoring questions with no
    AI/automation framing.
  - ML model training, fine-tuning, dataset curation.
  - Pure web/UI design, copy editing, math homework.
  - Tasks where the user has already provided full requirements and just
    wants code — search adds latency without value.
---

# Dopl — searchable catalog of proven AI/automation patterns

## Overview

**Core principle: search the catalog first, synthesize from what you find, save the result back.** Dopl is a knowledge base of working AI and automation implementations — agent setups, n8n flows, Claude skills, MCP servers, API integrations, scrapers — plus a per-user "canvas" for pinning patterns and grouping them into reusable cluster skills. The MCP exposes ~38 tools across search, retrieval, canvas management, cluster brain editing, and URL ingestion. The agent's job is to compose original solutions by combining patterns from multiple entries — not to list or recommend individual entries.

This skill is the meta-guide. Per-cluster `~/.claude/skills/dopl-{slug}/SKILL.md` files cover specific domains; this file covers the discovery → adoption → composition cycle that gets you there.

## When to use / when not to use

See frontmatter. Two extra notes:

- **Trigger on intent shape, not the brand name.** If the user says "I want an agent that pulls X from Y and posts to Z," that's a Dopl trigger even though they never said "Dopl."
- **Skip when the user has fully specified the build.** If they've handed you a precise spec and want code, jumping into search adds noise. Search when there's room for prior art to inform the design.

## Core workflows

### 1. Search the catalog (discovery)

When the user describes something AI/automation-shaped, **call `search_setups` immediately** — before synthesizing anything. Don't ask "should I check Dopl first?" — just search. It's cheap (1 credit), the result is always relevant context, and it's the reason this MCP is connected.

- Use natural-language queries that match how users describe outcomes ("agent that watches an inbox and triages tickets") rather than keyword soup.
- If the first result set is too narrow, broaden ("Slack agent" → "messaging agent"). If too broad, refine with the specific tool/service ("Slack ingestion via Composio").
- For follow-ups that stay inside one cluster the user is already focused on, prefer `query_cluster` over `search_setups` — narrower, faster, more relevant.

### 2. Read an entry (deep dive)

Once a result looks promising, call `get_setup` to load the full README, agents.md, and manifest. Don't paste these into your reply — extract what's relevant to the user's task and synthesize. Each entry has a public URL; **whenever you cite a specific entry, render it as a markdown link to that URL**, never as a slug or UUID.

**Skeleton entries** (badged `_(skeleton)_` in search results) are short descriptors with no README. If the user wants to adopt or replicate the entry, **upgrade it to full tier first** by calling `ingest_url(<entry's source_url>)`. Skip the upgrade only when the user just wants to know "is there anything here on X" and the descriptor answers that. Tell the user you're upgrading — it takes 30–60s.

### 3. Adopt patterns into the workspace (canvas)

When the user wants to keep a pattern, pin it to their canvas:

- `canvas_add_entry(slug)` — pin one entry whose slug you already know.
- `canvas_search_and_add(query)` — search and batch-add in one shot when discovery and adoption are happening together.

The canvas is the source of truth for what the user is "carrying" between sessions. Always re-query at session start (see "Session start" below) — local CLAUDE.md or installed skill files can drift.

### 4. Group adopted patterns into a cluster skill (composition)

A cluster is a named group of canvas entries that becomes a `SKILL.md` the agent can invoke. The brain (instructions + memories) IS the skill body — the local file is a thin pointer that fetches the brain at invocation time.

To build a cluster:

1. `canvas_create_cluster({name, panel_ids: [...]})` — create the cluster from selected canvas entries.
2. `get_skill_template(slug)` — fetch the synthesis prompt + entries' agents.md.
3. **Run the synthesis in your own context** against the entries — Dopl does not generate brains server-side. Produce a brain body following the canonical structure: `## When to use this skill`, `## Instructions`, `## Step-by-step`, `## Examples`, `## Anti-patterns`, `## References`.
4. `update_cluster_brain(slug, <full brain body>)` to persist.
5. (Optional) `sync_skills` to refresh local `~/.claude/skills/dopl-{slug}/` files.

A great brain reads like a how-to for a single procedure, not a directory listing of entries.

**Heads up: private knowledge bases and skills cannot be attached to clusters.** A cluster is a workspace-shared surface; a private item attached to one would either leak to teammates or render as a broken reference. The attach API rejects with `403 PRIVATE_RESOURCE` and the user must "Make public" from the resource's settings before it can be added. If you hit this on `canvas_create_cluster` or related attach calls, tell the user that specific resource is private and stop — don't auto-publish.

### 5. Capture corrections and preferences (brain protocol)

Dopl's killer feature is durable agent learning. Three reflexive moves while a cluster skill is in scope:

- **First use of a cluster skill this session** → call `get_cluster_brain(slug)` and treat it as canonical.
- **User gives durable signal in passing** ("I prefer X over Y," "for my setup always use Z," "skip step 4 in this flow") → call `save_cluster_memory(slug, …)` **silently, in the same turn, before composing your reply**. Don't ask "should I save this?" — just write.
- **User corrects the workflow itself** ("step 3 is wrong," "remove the part about X," "the example should be Y") → fetch the brain, edit the affected section surgically, persist with `update_cluster_brain`.

**Outcome dissatisfaction is the highest-signal moment.** "I tried that, it didn't work" / "the output wasn't what I wanted" — the skill led the user astray and they're telling you. Save a memory describing the gotcha; if the brain itself was wrong, edit it.

### 6. Compose a custom solution (build_solution)

When the user's request spans multiple patterns and no single entry covers it, call `build_solution(query)`. This synthesizes across the catalog — output is a custom architecture, not a list of entries. Use sparingly: best for "design me an X that does A, B, and C" requests where stitching is the point.

### 7. Switch workspaces on the fly

A single MCP server can now target any workspace the user belongs to:

- **`list_workspaces`** shows everything they're a member of, with role on each.
- **`set_workspace(workspace=<slug_or_id>)`** flips the session default. Confirm with `current_workspace` and tell the user once.
- **`workspace=<slug_or_id>` arg on any tool** — single-call override. Use this when the user says "in my acme workspace, …" for one operation; don't bother flipping the session default.

The currently active workspace appears in the `_dopl_status` footer of every response (`active_workspace: "Name" (slug=..., role=...)`), so you can self-correct after a switch by reading the next response.

### 8. Ingest new content

If the user pastes a URL or describes something not in the catalog yet, ingest it:

- `ingest_url(url)` — runs the full agent-driven extraction (prepare → 6 prompts → submit). The user sees a live amber tile on their canvas.
- `submit_ingested_entry(...)` — finalizes after you've completed the prompts.

The Dopl website queues URLs the user pastes into the web chat. Every tool response carries a `_dopl_status` footer with `pending_ingestions: N`. **When N > 0, tell the user once and ask if they want them processed.** Don't nag — drop it if they decline and re-raise only if a new item appears.

## Session start

At the start of every new session, before your first substantive reply, **call `list_clusters` and `canvas_list_panels` in parallel.** This loads the user's clusters and pinned canvas entries so questions about their workspace are grounded in current state. Once per session is enough; re-query when the user asks about their workspace ("what's on my canvas?") or after any write op of yours.

**Canvas/clusters > local files as source of truth.** If a user's `CLAUDE.md` or a `~/.claude/skills/dopl-*` file implies a different shape than `list_clusters` returns, trust the MCP and flag the drift.

## Decision tree — which tool first

- User wants to **find or build** something → `search_setups` (cross-catalog) or `query_cluster` (cluster already in scope).
- User wants the **full details** of an entry whose slug you have → `get_setup`.
- User wants to **save** an entry to their workspace → `canvas_add_entry` (known slug) or `canvas_search_and_add` (search + batch).
- User wants to **group** saved entries → `canvas_create_cluster`.
- User gives a **durable preference / correction** → `save_cluster_memory` (or `update_cluster_brain` for structural edits).
- User wants a **composite solution** spanning multiple patterns → `build_solution`.
- User asks **what changed** in their saved work → `check_cluster_updates` (bulk) or `check_entry_updates` (one).
- User pastes a **URL not in the catalog** → `ingest_url`.
- User mentions a **different workspace** by name → `workspace=<slug>` arg on the tool call (one-off) or `set_workspace` then proceed (multi-turn).

### Sibling-pair traps

- `search_setups` (broad) vs `query_cluster` (narrow) — pick the second only when one cluster is already the focus.
- `canvas_add_entry` (you have the slug) vs `canvas_search_and_add` (discovery + add).
- `save_cluster_memory` (new memory) vs `update_cluster_memory` (edit existing) — call `get_cluster_brain` first if uncertain.

## Examples

### Example 1 — "Build me an agent that summarizes my Slack DMs each morning"

1. `search_setups("agent that summarizes Slack DMs daily")` — get top matches.
2. `get_setup(<top match slug>)` — read the full implementation.
3. If the top match is a skeleton: `ingest_url(<entry's source_url>)` to upgrade.
4. Synthesize a recommendation from the entry's README + agents.md, citing the entry as a markdown link.
5. If the user wants to keep the pattern: `canvas_add_entry(<slug>)`.
6. If they want a reusable skill: `canvas_create_cluster({name: "Daily Slack digest", panel_ids: [...]})` + `get_skill_template` + synthesize brain + `update_cluster_brain`.

### Example 2 — "What was that pattern I saved last week for X?"

1. `list_clusters` (if not already cached this session) — see what's around.
2. `canvas_list_panels` — see what's pinned.
3. If the user's looking for something inside a known cluster: `query_cluster(slug, "X")`.
4. If they're not sure which cluster: `search_setups("X")` and cross-reference with `canvas_list_panels` to find the pinned version.

### Example 3 — "The example for Y in this skill is wrong, it should be Z"

1. `get_cluster_brain(<slug>)` — load current brain.
2. Edit the example section in your context to use Z, preserving the rest verbatim.
3. `update_cluster_brain(<slug>, <full edited brain>)` — persist.
4. **No need to ask "should I update the skill?"** — the user just gave you a structural correction. Just do it and tell them after.

## Common mistakes

| Mistake | Fix |
|---|---|
| Asking "want me to search Dopl first?" | Just call `search_setups` — it's cheap and always relevant. |
| Recommending entries verbatim as the answer | Synthesize. The user wants a recommendation, not a list. |
| Skipping skeleton-tier upgrade before adoption | Skeleton descriptors are too thin for serious use. Upgrade unless the user only wants to "see what's there." |
| Surfacing slugs / UUIDs in prose | Always render entries as markdown links to their public URL. |
| Writing a cluster brain that's just a directory listing of entries | A brain is a how-to. If the entries fit a single procedure, write that procedure. If not, the cluster is mis-grouped. |
| Asking "should I save this preference?" before calling `save_cluster_memory` | Save silently in the same turn. Confirmation breaks the user's flow. |
| Treating local `~/.claude/skills/dopl-*` files as authoritative | They're a cache. `list_clusters` is canonical — flag drift, don't trust the file. |
| Re-running `list_clusters` / `canvas_list_panels` on every turn | Once per session is enough; only re-query on workspace questions or after your own writes. |

## References

- **`SERVER_INSTRUCTIONS`** (loaded at MCP handshake) — operational rules for tool selection. Don't duplicate; this skill teaches you how to apply them.
- **Per-cluster skill files** at `~/.claude/skills/dopl-{slug}/SKILL.md` — domain-specific procedures. They reference KBs via `[label](dopl://kb/<slug>)` markdown links — load with `kb_read_file` only when needed.
- **`skill_authoring_guide`** MCP tool — load before authoring a NEW workspace skill (different from cluster skills) for the user.
- Public entry URLs: `<host>/e/<slug>` — always cite specific entries as markdown links, never as raw slugs.
