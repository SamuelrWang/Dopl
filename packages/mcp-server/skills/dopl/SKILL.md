---
name: dopl
description: >-
  Use whenever the user references their Dopl workspace — their knowledge
  bases (notes/docs), skills (procedural prompt templates), clusters
  (groupings of knowledge bases + skills), or canvas. The Dopl MCP tools
  let the agent search and read the user's knowledge, list and inspect
  clusters and what's inside them, author skills, and browse curated
  knowledge packs. Use for "what do I know about…", "what's in my X
  cluster", "find my notes on…", "write me a skill for…", even when the
  user doesn't say "Dopl".
when_to_use: >-
  - When the user asks what they have or know in their workspace ("what's
    in my Polymarket cluster", "find my notes on X").
  - When you need reference material the user has saved — knowledge-base
    entries, skills, or a cluster's contents — to answer or build.
  - When the user wants to author or edit a skill, or organize knowledge
    bases + skills into a cluster.
  - When the user is implementing in a domain that has a knowledge pack
    (e.g. Rokid AR glasses, Unity VR) — the pack is canonical reference.
when_not_to_use: >-
  - General programming, debugging, or refactoring with no connection to
    the user's saved workspace knowledge.
  - ML model training, fine-tuning, dataset curation.
  - Pure web/UI design, copy editing, math homework.
---

# Dopl — the user's knowledge bases, skills, and clusters

## Overview

**Core principle: ground answers in the user's real workspace, not in stale local files.** Dopl is a workspace of **knowledge bases** (the user's notes/docs), **skills** (procedural prompt templates), and **clusters** (named groupings of knowledge bases + skills), organized on a **canvas**. The MCP exposes tools to search and read knowledge, inspect clusters and their contents, author skills, and browse curated knowledge packs. The agent's job is to synthesize from what the user actually has — pulling across knowledge bases, skills, and clusters — not to dump raw entries.

This skill is the meta-guide. Per-cluster `~/.claude/skills/dopl-{slug}/SKILL.md` files cover specific domains; this file covers how to navigate the workspace.

## When to use / when not to use

See frontmatter. One extra note: **trigger on intent, not the brand name.** If the user says "what do I have on Slack agents" or "pull my Polymarket notes together," that's a Dopl trigger even though they never said "Dopl."

## Core workflows

### 1. Search & read the user's knowledge (knowledge bases)

When the user asks about something they "have" or "know," search their knowledge bases:

- `dopl_kb(op=search, query)` — full-text search across the workspace's knowledge bases. Returns ranked entries with a snippet + path. Optional `base` narrows to one knowledge base.
- `dopl_kb(op=read_file, base, path)` — read an entry's full markdown body.
- `dopl_kb(op=list_bases)` / `dopl_kb(op=get_tree, base)` / `dopl_kb(op=list_dir, base, path)` — browse what bases and entries exist.

Knowledge bases are also writable (`op=create_base`, `op=write_file`, folders, trash/restore) when the caller has access — see the tool description for the full op list and the `expected_version` write-safety token.

### 2. Inspect clusters and what's inside them

A cluster is a named grouping of knowledge bases + skills.

- `dopl_cluster(op=list)` — list all clusters with an at-a-glance summary of attached KBs + skills.
- `dopl_cluster(op=get, slug)` — full cluster detail: attached knowledge bases (each with an entries index) and skills (with truncated bodies).
- `dopl_cluster(op=read_knowledge_entry, cluster_slug, knowledge_base_id, entry_id)` — read the full body of one entry inside a knowledge base attached to the cluster. Get the (kb id, entry id) pair from `op=get` first.
- `dopl_cluster(op=read_skill, cluster_slug, skill_id)` — read every file (SKILL.md + supplementary) of a skill attached to the cluster.

### 3. Organize into clusters

- `dopl_cluster(op=create, {name})` — create a new, empty cluster by name. Attach knowledge bases / skills to it as a separate step from the web UI.
- `dopl_cluster(op=update, {slug, name})` — rename a cluster.
- `dopl_cluster_admin(op=delete_cluster, slug)` — permanently delete a cluster grouping. Attached knowledge bases + skills REMAIN; only the grouping is removed. Confirm intent if the user's phrasing is ambiguous.

> **Private resources can't be attached to a cluster.** A cluster is a workspace-shared surface; the attach API rejects a private KB/skill with `403 PRIVATE_RESOURCE`. If you hit this, tell the user the resource is private and stop — don't auto-publish.

### 4. Work with skills

Skills are procedural prompts the user authored. Call `dopl_skill(op=list)` at every task boundary to see if any apply, then:

- `dopl_skill(op=get, slug)` — fetch the resolved bundle; read `SKILL.md` first as the procedure. KB references appear as `[label](dopl://kb/<slug>)` — load that KB with `dopl_kb(op=read_file)` when you actually need it.
- `dopl_skill(op=read_file, slug, file_name)` — read one file.
- **Authoring:** call `dopl_skill(op=authoring_guide)` first to load the framework, then `dopl_skill(op=create)` (with strong metadata) + `dopl_skill(op=write_file)`. Destructive ops live on `dopl_skill_admin`.

### 5. See the canvas

- `dopl_canvas(op=list)` — list the panels on the user's canvas (chat, knowledge, skills, knowledge-base, skill, artifact, connection).
- `dopl_canvas(op=rename_chat, panel_id, title)` — rename a chat panel.

### 6. Knowledge packs (specialist verticals)

For domains with a curated pack (e.g. Rokid AR glasses, Unity VR), the pack is canonical reference — your training data may be stale:

- `dopl_packs(op=list)` — discover installed packs.
- `dopl_packs(op=list_files, pack, category?)` — browse a pack's file tree.
- `dopl_packs(op=get_file, pack, path)` — fetch one file's full markdown.

Cite the file path (e.g. `docs/sdk/camera.md`) in code comments. For domains with no installed pack, say so plainly — don't fabricate.

### 7. Switch workspaces on the fly

A single MCP server can target any workspace the user belongs to:

- **`list_workspaces`** — everything they're a member of, with role on each.
- **`set_workspace(workspace=<slug_or_id>)`** — flip the session default; confirm with `current_workspace` and tell the user once.
- **`workspace=<slug_or_id>` arg on any tool** — single-call override for "in my acme workspace, …" one-offs.

The active workspace appears in the `_dopl_status` footer of every response, so you can self-correct after a switch.

## Session start

At the start of every new session, before your first substantive reply, **call `dopl_cluster(op=list)` and `dopl_canvas(op=list)` in parallel.** This loads the user's clusters and canvas panels so questions about their workspace are grounded in current state. Once per session is enough; re-query when the user asks about their workspace or after any write op of yours.

**Workspace > local files as source of truth.** If a user's `CLAUDE.md` or a `~/.claude/skills/dopl-*` file implies a different shape than `dopl_cluster(op=list)` returns, trust the MCP and flag the drift.

## Decision tree — which tool first

- User asks **what they know / find their notes** → `dopl_kb(op=search)`, then `dopl_kb(op=read_file)`.
- User asks **what clusters exist / what's in a cluster** → `dopl_cluster(op=list)` then `dopl_cluster(op=get)`.
- User wants a **specific KB entry or skill inside a cluster** → `dopl_cluster(op=read_knowledge_entry)` / `dopl_cluster(op=read_skill)`.
- User wants to **organize** → `dopl_cluster(op=create | update)`.
- User wants to **author / edit a skill** → `dopl_skill(op=authoring_guide)` then `dopl_skill(op=create | write_file)`.
- User asks **what's on the canvas** → `dopl_canvas(op=list)`.
- User is implementing in a **packed domain** → `dopl_packs`.
- User mentions a **different workspace** → `workspace=<slug>` arg (one-off) or `set_workspace` (multi-turn).

## Examples

### Example 1 — "Pull together everything I know about my Polymarket setup"

1. `dopl_kb(op=search, "Polymarket")` — find relevant knowledge-base entries.
2. `dopl_kb(op=read_file, base, path)` on the top hits — read the bodies.
3. Check for a matching cluster: `dopl_cluster(op=list)` → `dopl_cluster(op=get, <slug>)` to see attached KBs + skills.
4. Synthesize a tight summary from those sources, citing them by name.

### Example 2 — "What's in my Trading cluster?"

1. `dopl_cluster(op=list)` (if not already cached this session) to resolve the slug.
2. `dopl_cluster(op=get, "trading")` — attached knowledge bases (with entries index) + skills.
3. To read a specific entry: `dopl_cluster(op=read_knowledge_entry, ...)`; for a skill body: `dopl_cluster(op=read_skill, ...)`.

## Common mistakes

| Mistake | Fix |
|---|---|
| Treating local `~/.claude/skills/dopl-*` files as authoritative | They're a cache. `dopl_cluster(op=list)` is canonical — flag drift, don't trust the file. |
| Dumping raw knowledge-base entries as the answer | Synthesize across sources; the user wants curation, not a dump. |
| Re-running `dopl_cluster(op=list)` / `dopl_canvas(op=list)` on every turn | Once per session is enough; only re-query on workspace questions or after your own writes. |
| Auto-publishing a private KB/skill to attach it to a cluster | Stop and tell the user it's private; let them make it public. |

## References

- **`SERVER_INSTRUCTIONS`** (loaded at MCP handshake) — operational rules for tool selection. Don't duplicate; this skill teaches you how to apply them.
- **Per-cluster skill files** at `~/.claude/skills/dopl-{slug}/SKILL.md` — domain-specific procedures. They reference KBs via `[label](dopl://kb/<slug>)` — load with `dopl_kb(op=read_file)` only when needed.
- **`dopl_skill(op=authoring_guide)`** MCP tool — load before authoring a NEW workspace skill for the user.
