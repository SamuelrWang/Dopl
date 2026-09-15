# KB-LOSS-TRACE — "Dopl Development" reads 0 folders / 0 entries

Read-only forensic trace. No writes to prod. All queries were `SELECT` via PostgREST
with the service-role key (bypasses RLS, so soft-deleted rows are visible too).

## VERDICT: **never-had-entries**

Base `7f943a28-ecc3-4e66-bc15-1e4d55d453b6` is an **empty shell created by hand in the
app on 2026-09-05 07:53:15 UTC, in the PERSONAL container ("Home", `c7841eeb…`), and
never written to once.** Nothing was deleted, moved or soft-deleted. There is nothing
to recover, because nothing was ever there.

The content Samuel remembers is real, but it lives on **two different bases that share
the name/slug** — the workspace-vs-home-container split, exactly as suspected:

| base id | name | slug | container | folders | entries | storage_bytes |
|---|---|---|---|---|---|---|
| `7f943a28-ecc3-4e66-bc15-1e4d55d453b6` | Dopl Development | dopl-development | `c7841eeb…` **Home (personal)** | **0** | **0** | **0** |
| `6e77d236-a594-4b30-96b6-63b8dbbfcb09` | Dopl Development | dopl-development | `26ba089d…` Mobile Command Center (home channel) | 0 | **4** | 28,528 |
| `0105b016-7929-43d4-bb7f-1540cb567f2d` | Dopl Development | dopl-development | `5291e457…` **Original** (standard workspace) | **4** | **43** | — |
| `b95805e2-49d9-4733-99d3-0bf8907121a0` | Dopl | dopl | `20b9ee26…` Qjuik (home channel) | 0 | 1 ("Dopl change log") | 1,266 |

Note the task brief assumed the empty base sits in the Dopl workspace
`e7998a94…`. **It does not** — its `workspace_id` is the personal container
`c7841eeb…`. It surfaces over MCP in this channel only because a caller's own
personal container is folded into `list_bases`.

---

## 1. Row truth — no entry or folder row has ever pointed at this base

```
knowledge_entries?knowledge_base_id=eq.7f943a28-…   → 200, Content-Range */0   (unfiltered: live AND deleted_at NOT NULL)
knowledge_folders?knowledge_base_id=eq.7f943a28-…   → 200, Content-Range */0
knowledge_entry_chunks?knowledge_base_id=eq.7f943a28-… → 200, Content-Range */0
```

Zero rows, not zero *live* rows: no `deleted_at` filter was applied. Every entry in
that container belongs to the other base there:

```
knowledge_entries?workspace_id=eq.c7841eeb-… → 8 rows, ALL knowledge_base_id = a5b5a013-… ("Orchestration Guidelines")
  Hierarchy and Roles / Escalation / New Session Bootstrap / Channel Discipline /
  Desktop Orchestrator Protocol / Intent and Objective Relay /
  Agent Communication Protocol / Turn Economy
```

## 2. The base row itself — created, never touched again

```json
{
 "id": "7f943a28-ecc3-4e66-bc15-1e4d55d453b6",
 "workspace_id": "c7841eeb-d32d-451f-8852-1a4be04b0397",
 "name": "Dopl Development", "slug": "dopl-development", "description": null,
 "agent_write_enabled": true, "created_by": "2dac1943-da3b-4fd9-aee6-1716ddfc25f9",
 "created_at": "2026-09-05T07:53:15.761039+00:00",
 "updated_at": "2026-09-05T07:53:15.761039+00:00",
 "deleted_at": null, "storage_bytes": 0, "visibility": "private",
 "access_mode": "workspace", "home_scoped": false, "pinned": false
}
```

Three independent tells:

- `updated_at == created_at` **to the microsecond** — no application UPDATE ever ran
  against the row (no rename, no description).
- `storage_bytes = 0`. The counter is trigger-maintained in the same transaction as
  every entry write, including FK-cascade deletes
  (`supabase/migrations/20260812120000_knowledge_base_storage_bytes.sql`). Zero is
  consistent with "never written", and the `updated_at` tell above rules out the
  written-then-emptied path in a way the counter alone could not.
- `description IS NULL` — never edited after creation, matching Samuel's own read.

## 3. Migration / move — nothing moved

- `revisions` (the per-write KB changelog, `20261002120000_revisions.sql`): 19 rows in
  total, the earliest `2026-09-10T11:24:54Z`. Only **three** are `resource_type =
  knowledge_entry`, and none touches this base:
  - `275d7a0b…` "New Session Bootstrap", ws `c7841eeb…`, op `edit`, user, 09-10
  - `ea8f4761…` "2026-09-13 wave (UNPUSHED)…", ws `5291e457…`, op `create`, agent, 09-13
  - same entry, op `section_edit`, agent, 09-14
  The table was applied **after** the 09-05 window, so it is silent about that day —
  the MCP call log below covers it instead.
- `workspace_activity_events`: 0 rows.
- No entry anywhere carries a base_id pointing at a base that no longer exists
  (`knowledge_base_id` is `ON DELETE CASCADE`; an orphan is not representable).

## 4. Trash / tombstones — **there is no trash, by design**

`src/features/knowledge/server/repository-entries.ts:391`
```
/** PERMANENT delete — no trash. Workspace-scoped as defense-in-depth;
 *  embedding chunks cascade via FK. */
export async function hardDeleteEntry(…)
```
`src/features/knowledge/server/repository-bases.ts:313`
```
/** PERMANENT delete of a base and everything inside — no trash. … Folders/entries
 *  (and embeddings/cluster links) cascade via `knowledge_base_id … ON DELETE CASCADE` */
export async function hardDeleteBase(…)
```
So "check the trash table" has no target: KB deletion leaves no tombstone row at all.
That is why the negative evidence above (`updated_at`, `storage_bytes`, the MCP call
log, and the contemporaneous ledger in §5) is what carries the verdict.

## 5. Timeline — reconstructed from `mcp_tool_calls` + `channel_messages`

`mcp_tool_calls` logs one row per agent-credential MCP op at the auth choke point
(`src/shared/auth/with-workspace-auth.ts:180`), **before** the handler runs — so it
records attempts, failures included, stamped with the *resolved* workspace.

| UTC (2026-09-05) | what | evidence |
|---|---|---|
| 07:50:07 | Samuel posts the "create a KB named Dopl" instruction into channel `bb0f57db…` | `channel_messages` |
| 07:50:22 | agent fires `kb.create_base`, resolved workspace `e7998a94…` (Dopl) | `mcp_tool_calls` |
| 07:50:45 | agent reports it **failed**: *"I'm blocked from creating the base: an agent can't create a knowledge base inside a shared home channel… @samuel — create it in the app"* | `channel_messages` |
| **07:53:15** | **base `7f943a28…` appears — in the PERSONAL container, not the channel's.** No MCP row at that timestamp → created by Samuel in the **app**. This is the empty shell. | `knowledge_bases`, absence in `mcp_tool_calls` |
| 07:53:31 / 07:53:35 | agent `list_bases` against `e7998a94…` — cannot see it (wrong container, no grant), so it never writes | `mcp_tool_calls` |
| 08:14:29 | base "Dopl" `b95805e2…` created instead, in Qjuik `20b9ee26…` | `knowledge_bases` |
| 08:14:39 | `write_file` → entry **"Dopl change log"** lands there (1,266 bytes) | `mcp_tool_calls`, `knowledge_entries` |
| 19:32:27 | base "Dopl Development" `6e77d236…` created in Mobile Command Center, **with a channel grant** (`resource_grants`, level `visible`, 19:32:28) | `knowledge_bases`, `resource_grants` |
| 19:33 → 21:19 | its 4 entries written by agents: "Dopl change log", "Push-point checklist", "Artifacts design v1 (RULED…)", "Desktop worker hand-off (tasks 12-15-11-13-10)" | `knowledge_entries` |
| 23:00:48 / 23:02:03 | two `write_file` attempts resolve to `c7841eeb…` and leave **no trace** — no entry in that container has an `updated_at` anywhere in 22:50–23:20. Refused writes, matching the ledger line *"Desktop Agent's session cannot write into this container."* | `mcp_tool_calls`, `knowledge_entries` |
| **23:03:14** | the Desktop Agent's own build ledger, posted to channel `4249c58a…`, already says it: **"D1. Empty duplicate base 'Dopl Development' id `7f943a28-ecc3-4e66-bc15-1e4d55d453b6`, 0 entries; slug resolves to it. Samuel deletes in app (app-only). Address real base by id."** | `channel_messages` |

Actor throughout: user `2dac1943-da3b-4fd9-aee6-1716ddfc25f9` (Samuel), via the app for
the 07:53 creation and via agent credentials for every MCP op.

## 6. Recovery

**None needed — nothing was lost.**

- The Dopl-dev content the agents have been writing since 09-05 evening is on
  `6e77d236-a594-4b30-96b6-63b8dbbfcb09` (Mobile Command Center), 4 entries, all live.
- The older, larger engineering base is `0105b016-7929-43d4-bb7f-1540cb567f2d` in the
  **Original** workspace: 43 entries, 4 folders, **zero soft-deleted rows**, with the
  full description intact.
- The change-log entry also exists standalone on `b95805e2…` ("Dopl", Qjuik).

## 7. What actually bit, and the one thing worth fixing

Three live bases share the slug `dopl-development` across three different containers,
and a fourth shares the name stem. **Slug resolution picks the empty one**, because a
caller's own personal container is folded into the same list as the channel's
container. The failure mode is not data loss, it is an ambiguous handle.

Recommendations (no writes made; Samuel's call):

1. Delete the empty shell `7f943a28…` in the app — it has 0 entries, 0 folders, 0
   bytes and no grant, so deletion destroys nothing. This is D1 from the 09-05 ledger,
   still outstanding ten days later.
2. Until then, address the real base **by id** `6e77d236-a594-4b30-96b6-63b8dbbfcb09`,
   never by slug.
3. Product: a slug collision across containers should surface as an ambiguity in
   `list_bases`/`get_tree` rather than silently resolving to one of them — the same
   shape as the `ambiguous_name` refusal the agent-template tool already returns.
