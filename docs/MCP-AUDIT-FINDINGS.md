# Dopl MCP Server — Audit & Hardening Findings

**Date:** 2026-06-17
**Method:** drove the live Dopl MCP server (`6a12c8bd-…`, OAuth remote, authed as **owner** of *Samuel's Workspace* `5291e457-…`) against itself across all 13 tools / ~40 ops, with adversarial edge cases. Every write was cross-checked against the **same prod Supabase** (`mrefkedvdehahjejreae`) via SQL — a PASS means the DB confirmed the effect, not just the MCP's own success text. All test artifacts were prefixed `mcp-audit-*` and hard-purged afterward.

**Scope note:** this is an audit. No app code was changed. Findings are observations, not fixes.

> Verification loop is real: the dopl MCP and the supabase MCP point at the same DB; workspace ids matched exactly. Where the MCP claimed success but the DB disagreed, that gap is the finding.

---

## 1. Coverage summary

| Tool | Ops exercised | Result |
|---|---|---|
| `current_workspace`, `list_workspaces` | all | PASS |
| `set_workspace` | all | FRAGILE (MCP-9) |
| `dopl_cluster` / `_admin` | list, get, create, update, delete_cluster | PASS w/ 5 findings |
| `dopl_kb` / `_admin` | all 15 + 3 admin | PASS w/ 7 findings (search broken) |
| `dopl_skill` / `_admin` | all 10 + 2 admin | PASS w/ 6 findings (gates hold) |
| `dopl_workflow` / `_admin` | all 10 + 1 admin | PASS w/ 7 findings (cycles + orphans) |
| `dopl_canvas` | list, rename_chat | FAIL on rename_chat (MCP-2) |
| `dopl_packs` | list, list_files, get_file | PASS (path-safe) w/ 1 finding |
| cross-cutting (isolation, source, scope, rate-limit, footer) | — | isolation/source/rate-limit SOUND; 3 hardening findings |

**Posture verdict:** the security boundary is fundamentally sound — workspace isolation holds, MCP writes are correctly stamped `last_edited_source='agent'`, OAuth scope gating is active (live token carries `dopl.read`+`dopl.write`), and rate-limiting accrues per token. The problems are **correctness/robustness bugs in individual ops** and **large capability/exposure gaps**, not a broken auth model.

---

## 2. Issues & fragility

Severity: **HIGH** = data corruption / silent wrong result an agent will act on · **MED** = misleading behavior or data inconsistency · **LOW** = rough edge · **INFO** = noted, likely by-design.

### HIGH

**MCP-1 · `dopl_kb` search returns every entry for any query (no relevance filter).**
Repro: `dopl_kb(op=search, base=…, query="zzzznonexistentword99")` → returned all 4 entries at rank ~0.02; `query="xylophone"` (1 true match) → all 4 returned, true match at 0.03, non-matches at 0.02. Expected: only matching entries (or none). Actual: unfiltered ranked retrieval with no threshold and no FTS `@@` gate. An agent is shown non-matching entries as "matches" — actively misleading and makes search unusable for grounding. Likely `src/features/knowledge/server/` search service + `packages/mcp-server/src/tools/knowledge.ts`.

**MCP-2 · `dopl_canvas` rename_chat has no panel-type guard and no rows-affected check.**
Repro: `dopl_canvas(op=rename_chat, panel_id="panel-does-not-exist", title="x")` → returns success though no row changed; `panel_id` of a **node** or **workflow** panel → **actually writes the `title` column on that non-chat panel** and reports `Renamed chat to "x"`. During this audit it corrupted real workflow panel `panel-401` (CONSULTING_OUTREACH; original `title=NULL`). The op is effectively an unguarded `UPDATE canvas_panels SET title=? WHERE panel_id=?` with no `panel_type='chat'` filter. Tool: `packages/mcp-server/src/tools/canvas.ts` → `PATCH /api/canvas/panels/[panelId]`.

**MCP-3 · `dopl_workflow` set_graph (and connect) accept cycles silently.**
Repro: `set_graph` with edges `[header→n1, n1→n2, n2→n1]`, then `get` → "Steps (2)" but "3 stages", Step A = "stage 3 of 3" printed before Step B = "stage 2 of 3", each step Depends-on AND Leads-to the other; no cycle warning. `connect` also creates cycle edges with no error. An agent reading the plan gets an unexecutable, self-contradictory graph. `src/features/workflows/server/graph.ts` (topological compose) has no cycle rejection at write time.

**MCP-4 · delete_workflow permanently orphans node panels + inter-node edges, with no reclaim path.**
Repro: delete a workflow with header + connected nodes → `workflows` row + header panel gone, but node `canvas_panels` and the inter-node `canvas_edges` survive as live, workflow-less panels. No MCP op can delete a loose panel (`dopl_canvas` = list/rename only) or adopt one into a workflow (`set_graph` mints fresh ids; `connect` needs workflow-scoped node ids). These orphans are unreachable through tools forever. (Confirmed during audit; cleaned only via direct SQL.) Relates to F-021.

**MCP-5 · KB restore of a child before its parent strands the item in limbo.**
Repro: delete folder `newparent` (cascades to `deep/moved-note.md`), then `restore_file(entry_id=…)` while ancestors still trashed → entry `deleted_at=NULL` but parent folder still trashed, so the entry is **absent from `get_tree` AND from `list_trash`**: alive, reachable by nothing. Recoverable only if the user independently restores the ancestor, but nothing surfaces it to tell them. `src/features/knowledge/server/service.ts` restore path.

### MED

**MCP-6 · Duplicate-title `write_file` returns a raw 500 instead of a clean conflict.**
Repro: write an entry whose `title` already exists in the same folder → `INTERNAL_ERROR: Internal server error`. The `UNIQUE(knowledge_base_id, folder_id, title)` violation is uncaught/untranslated. Inconsistent with `move_file`/`move_folder`, which return a clean `KNOWLEDGE_PATH_CONFLICT` for the same collision class. DB confirmed no partial insert (correct), only the error surface is wrong.

**MCP-7 · set_graph is non-atomic — failed validation leaves orphaned panels.**
Repro: `set_graph` where a new node carries a private-skill action → fails `PRIVATE_RESOURCE`, but the node panel was already created before the resource check and was **not** rolled back. Partial writes survive a rejected call.

**MCP-8 · set_graph reconciliation ignores edgeless panels.**
Repro: with an orphan (edgeless) node present, re-send `set_graph` with the intended node set → the orphan survives. Reconciliation only deletes nodes reachable from the header via edges, so a stray/edgeless node can never be cleaned by re-authoring. Compounds MCP-7.

**MCP-9 · `set_workspace` is a silent no-op across calls but reports success.**
Repro: `set_workspace('fidaris')` returns "Active workspace set to Fidaris" with a Fidaris footer; the very next `current_workspace` reports Samuel's Workspace. The stateless OAuth transport re-derives the workspace from the token on every request (`src/app/api/mcp/route.ts` notes "Stateless HTTP can't persist set_workspace"). An agent told it switched will silently keep writing to the old workspace. The per-call `workspace=` override works correctly and is the only reliable cross-workspace mechanism.

**MCP-10 · Cluster description silently truncated to 300 chars.**
Repro: `dopl_cluster(op=update, description=<311 chars>)` → success, DB shows `length=300`, tail dropped. No error, no schema `maxLength` on the cluster `description` param (the workflow description param *does* enforce 300 in-schema). Silent data loss.

**MCP-11 · delete_cluster reports success on a nonexistent slug.**
Repro: `dopl_cluster_admin(op=delete_cluster, slug="never-existed")` → "Deleted cluster …". DB: 0 rows ever matched. A blind no-op that confirms success masks typos/stale-slug bugs (unlike `get`/`update`, which 404 correctly).

**MCP-12 · Whitespace-only cluster name bypasses the empty-name guard.**
Repro: `create(name="   ")` → creates a cluster with `name=''` (trimmed) and slug `cluster`. The guard only catches `""`. A fat-fingered space silently lands a blank, generically-slugged junk cluster.

**MCP-13 · Skill `agent_write_enabled` gate rejects on parameter presence, with a backwards message.**
Repro: `dopl_skill(op=update, agent_write_enabled=true)` when it's already true → rejected `SKILL_AGENT_WRITE_DISABLED: Agent writes are disabled … Toggle the per-skill setting`. The gate correctly prevents the agent changing the column (verified: value unchanged), but it fires merely because the field is present (any value) and the message claims writes are *disabled* when they're *enabled*. An agent that includes this field alongside legit metadata edits gets the whole update rejected with a nonsensical reason. Should ignore the field silently or return a "session-only setting" message. `src/features/skills/server/service.ts`.

**MCP-14 · Rename silently changes the slug — the only stable handle — and no id is ever returned.**
Repro: `dopl_cluster`/`dopl_workflow` update with a new `name` → slug changes; the old slug 404s on the next call. The MCP never surfaces an immutable id/public_id for clusters or workflows (clusters: see F-017). An agent (or a concurrent UI rename) invalidates every held reference with no warning and no redirect.

**MCP-15 · Workflow update does not sync the canvas header panel.**
Repro: `update(name=…, description=…)` → `workflows` row updates, but the header `canvas_panels.panel_data` still shows the old name/empty description. The two write targets (workflow row vs canvas header) drift; the canvas shows stale metadata.

### LOW

**MCP-16 · False-positive successes on edge ops.** `disconnect` of a nonexistent edge → "Disconnected …". `set_graph` with an edge to an unknown ref → the edge is silently dropped yet the success message over-counts ("2 edges" when 1 persisted), and an unreferenced node gets deleted — author misled about what was saved.

**MCP-17 · No-version `write_file` is silent last-write-wins.** Omitting `expected_version` "auto-guards" against the *current* version, which always matches, so it never conflicts. Two concurrent no-version writes → first silently lost. (The explicit `expected_version` path is correct: stale token → 412 with reconcile guidance, `force=true` overrides, no partial write.)

**MCP-18 · packs `list_files` limit handling.** `limit=0` returns ALL files (falsy coalesce, likely `limit || 50`); `limit=501` not rejected. (Clamp at 500 untestable — test pack had only 4 files.)

**MCP-19 · Skill soft-delete orphans child files.** `delete` sets `skills.deleted_at` but leaves `skill_files.deleted_at = NULL`. Not a leak (parent gone), but inconsistent — any file-reaper or restore keyed on file `deleted_at` will mishandle these.

**MCP-20 · SKILL.md recreate is blocked by uniqueness, not a primary-file guard.** `create_file(name='SKILL.md')` on a live skill → `SKILL_FILE_CONFLICT`. If a skill ever lacks a live SKILL.md (botched migration, or the MCP-19 orphan path), `create_file('SKILL.md')` would likely succeed and reintroduce a primary file via the supplementary path, bypassing the "only op=create makes SKILL.md" invariant. (rename/delete of SKILL.md *are* properly guarded by `SKILL_PRIMARY_FILE_IMMUTABLE`.)

**MCP-21 · Path traversal `..` becomes a literal folder.** `create_folder(path="../escape")` → root folder literally named `..` with child `escape`, visible as `📁 ../`. Contained within the base (no cross-base escape, not a security breach) but produces a confusing artifact colliding with traversal semantics. Leading/trailing/double slashes are correctly normalized.

**MCP-22 · Unicode slug derivation strips instead of transliterating.** `café` → `caf`; CJK/emoji dropped; all-non-ASCII names can yield near-empty slugs. Deterministic but lossy.

**MCP-23 · restore_base/folder bumps descendants' `updated_at`.** After delete→restore, every child entry's version token changes, so an agent holding a pre-delete `expected_version` gets a spurious 412 after an unrelated restore.

**MCP-27 · Scope gate fails-open; non-admin writes ungated.** `server.ts`: `canWrite = !scopes || scopes.includes("dopl.write")` — a session with NULL/empty scopes registers all `*_admin` destructive tools (fails open). Today moot (OAuth token carries `dopl.write`), but any future auth path that omits scopes exposes deletes. Also, gating is registration-level on the four `*_admin` tools only; non-admin write ops (`dopl_kb.write_file`, etc.) are not scope-checked, so a `dopl.read`-only token could still write via non-admin ops.

### INFO

- **MCP-24 · Cluster names are force-uppercased on create** (`mcp-audit-a-cluster-1` → `MCP-AUDIT-A-CLUSTER-1`); undocumented, breaks name round-trips.
- **MCP-25 · Draft skills are invisible to `list`** with no status filter → an agent that creates a `status='draft'` skill (which `create` accepts) cannot rediscover it via MCP.
- **MCP-26 · Footer reports the session workspace, not the per-call-`workspace=`-served workspace** → an agent could attribute Fidaris results to Samuel's Workspace. (Footer correctly omitted on errors.)
- **MCP-28 · Duplicate display names with no disambiguator** + no id surfaced makes two same-named clusters genuinely ambiguous in `list`.
- **`dopl_workflow` get over-exposes:** for a workflow with attachments it dumps the entire attached KB folder tree (every entry title + `entry_id`) and the attached skill's full body/metadata. By design for agent execution, but it is the main info-exposure surface — anyone who can read a workflow reads the source of every attached KB/skill.

---

## 3. Information-exposure gaps (DB columns the MCP never returns)

Agents reason off what the read ops return; these fields exist in the schema but are invisible through the MCP:

- **Clusters:** `id`, `created_at/updated_at`, `user_id`, fork lineage; `description` absent from `list`; per-workflow step counts.
- **KB bases:** `access_mode`, `agent_write_enabled` (the very flag gating writes), `public_id`, `created_by`, timestamps, entry/folder counts; `visibility` only shown as a `(private)` tag (public bases unmarked).
- **KB entries:** `entry_type`, `excerpt`, `created_by`, `last_edited_by` (id), `created_at`; entry `id` not returned by `read_file`; `updated_at` only as the opaque "Version".
- **KB folders:** `description`, `position`, ids, timestamps.
- **Skills:** `total_invocations`, `examples`, `connectors`, `recent_runs`, `created_by`, `last_edited_by/source`, `public_id`, timestamps, `agent_write_enabled`, `visibility`; `description` shown in `list` but omitted from `get`.
- **Workflows:** `access_mode`, `cluster_id`, `user_id`, timestamps — so a caller can't tell a workflow's sharing or cluster state at all.
- **Canvas `list`:** `panel_id` (!), real `panel_type`, `summary`, geometry, `added_at`, `source_url`, and all of `panel_data` (linked `knowledgeBaseId`/`workflowId`/`slug`, node `reads/actions/instructions`). You can't even learn a panel's id from the list to feed `rename_chat`.
- **Packs:** `summary`, `tags`, `frontmatter` (list_files); `last_commit_sha`/manifest (list).

---

## 4. Capability gaps (actions with no MCP surface at all)

**Workflow/cluster authoring is half-wired:**
- **No way to assign a workflow to a cluster** (set `workflows.cluster_id`). The MCP can create clusters and workflows but cannot connect them — a cluster created via MCP is permanently empty (the tool text itself says "assign from the canvas"). *Top gap.*
- **No way to publish a KB or skill** (`set_visibility`/`access_mode`). Yet `set_graph` **requires** public KB/skill for node `reads`/`actions`. An agent can create a private KB/skill but has no tool path to make it referenceable → dead end for agent-authored workflows.
- **No canvas management:** no create / move / resize / delete panel, no reclaim of loose panels (root cause of MCP-4), no read of a chat panel's conversation.
- **No `access_mode` control** on workflows/KBs/skills.

**No execution, despite "agent-followable" framing:**
- **No `run`/`execute` for workflows** — `get` returns an ordered plan that nothing runs.
- **No `run`/`invoke` for skills** — `total_invocations`/`recent_runs` exist but nothing increments or reads them.

**Whole subsystems absent:**
- **Conversations/chat:** no list/read/create of conversations or attachments — agents can't see chat history.
- **Workspace management:** no create workspace, invite/list/remove members, set roles, or manage teams + resource grants.
- **Trash:** KB has list_trash/restore but **no purge/empty**; **skills have no restore at all** via MCP.
- **KB writes can't set** `entry_type` (always `note`), `excerpt`, or `position`/reorder.
- **Packs:** read-only, no `sync`/refresh trigger.

---

## 5. Recommended new tools/ops (prioritized)

### P1 — unblock the core authoring loop (small, high leverage)
1. `dopl_workflow(op=set_cluster, slug, cluster)` + `dopl_cluster(op=add_workflow/remove_workflow)` — connect the two entities the MCP can already create separately. **Closes the top dead-end.**
2. `dopl_kb(op=set_visibility)` and `dopl_skill(op=set_visibility)` (+ `access_mode`) — let an agent publish what it authored so workflows can reference it.
3. `dopl_canvas(op=create_panel | delete_panel | move_panel)` — manage the canvas and **reclaim/delete loose panels** (fixes MCP-4's permanent orphans).
4. Surface an **immutable id/`public_id`** on every read op and accept it everywhere a slug is accepted — kills the rename-breaks-references class (MCP-14).

### P2 — make it an execution surface, not just an authoring one
5. `dopl_workflow(op=run)` — execute the ordered graph (the entire point of "agent-followable workflows").
6. `dopl_skill(op=run/invoke)` — execute a skill and record `total_invocations`/`recent_runs`.
7. `dopl_chat` / `dopl_conversation` tools — list/read/create conversations + attachments; let agents see and continue chat history.
8. `dopl_kb(op=semantic_search)` exposing the existing embeddings with a real relevance threshold — and fix MCP-1 so the keyword `search` stops returning everything.

### P3 — management, recovery, observability
9. `dopl_workspace_admin` — create workspace, invite/list/remove members, set roles, manage teams + `team_resource_access` grants.
10. `dopl_kb(op=purge_trash)` / `dopl_skill(op=restore | list_trash | purge_trash)` — complete the lifecycle.
11. A `verbose`/`fields` option on read ops to return the hidden fields from §3 (visibility, access_mode, ids, timestamps, counts, source) without bloating the default.
12. `dopl_packs(op=sync)` and KB write support for `entry_type` / `excerpt` / reorder.

### Robustness fixes worth doing alongside
- Reject (or spatial-fallback with a clear notice) cycles in set_graph/connect (MCP-3); make set_graph atomic + reconcile edgeless orphans (MCP-7/8).
- Translate the duplicate-title 500 into a clean conflict (MCP-6); block child-restore-before-parent or auto-restore ancestors (MCP-5).
- Guard `rename_chat` on `panel_type='chat'` + check rows-affected (MCP-2); return real 404s on no-op deletes/disconnects (MCP-11, MCP-16).
- Trim+validate names (MCP-12), enforce description caps in-schema (MCP-10), make scope gating fail-closed and cover non-admin writes (MCP-27), and make `set_workspace` either truly persist or stop claiming it did (MCP-9).

---

## 6. Cross-references to existing refactor findings
- **F-017** (clusters have no `public_id`) — directly underlies MCP-14/MCP-28 (no immutable handle).
- **F-021** (canvas panels not team-filtered) — adjacent to MCP-4 (loose-panel lifecycle) and the canvas-thinness gaps.

## 7. Coverage limitations
- All tests ran as **owner of both workspaces**, so isolation checks validate **scoping**, not **non-member permission denial**. Recommend a 2-account test (a user who is NOT a member of the target workspace) to close that gap.
- Large-payload writes (~400 KB KB body, near-1 MiB skill body) were not transmitted end-to-end due to harness output limits; the client-side Zod caps were confirmed but server acceptance of large-but-valid bodies is unverified.
