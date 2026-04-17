# Claude Code hooks for Dopl

Three opt-in Claude Code hook configs that make common Dopl workflows automatic.
Copy the JSON blocks into your `~/.claude/settings.json` (global) or a project's
`.claude/settings.json` (project-scoped). Everything here is optional — the MCP
server works fine without any of them.

Hooks run locally on the user's machine. They are NOT configured through the MCP
server; shipping them here just saves you the work of writing them yourself.

---

## 1. Auto-sync skills after canvas/brain changes

After you create a cluster, add an entry, save a memory, or edit a brain, the
on-disk skill file at `~/.claude/skills/dopl-{slug}/SKILL.md` drifts from the
DB state until `sync_skills` runs. This hook runs it automatically after any
mutation that would change the skill content.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__dopl__canvas_create_cluster|mcp__dopl__add_entry_to_cluster|mcp__dopl__save_cluster_memory|mcp__dopl__update_cluster_brain|mcp__dopl__update_cluster_memory|mcp__dopl__delete_cluster_memory|mcp__dopl__update_cluster",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"suggestion\": \"Run sync_skills to update the on-disk skill file for this cluster.\"}'"
          }
        ]
      }
    ]
  }
}
```

**Tradeoff:** adds a brief prompt after every cluster mutation. If that's too
noisy, keep only the `canvas_create_cluster` and `update_cluster_brain`
matchers — those are the two where drift hurts most.

If you prefer the hook to actually *run* `sync_skills` instead of suggesting
it, swap the `command` for a curl call against your deployment. Be aware that
hooks can't currently call MCP tools directly — they shell out.

---

## 2. Descriptor pop after skeleton ingest (admin only)

When you run `skeleton_ingest` on a URL, the descriptor lands 10–30s later.
This hook nudges Claude to poll `get_setup` once so you see what was actually
written before moving on.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__dopl__skeleton_ingest",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"suggestion\": \"Wait ~20 seconds, then call get_setup with the returned entry_id to see the generated descriptor.\"}'"
          }
        ]
      }
    ]
  }
}
```

**When to use this:** you're the admin running a mass ingestion session and
want to spot-check outputs without manually polling each one. Skip this if
you're doing true bulk ingestion (100+ URLs); the suggestions will pile up.

---

## 3. Proactive search nudge on AI/automation prompts (highest leverage)

This is the single highest-leverage hook for the "Claude doesn't reach for
Dopl tools on its own" problem. It runs on every user prompt and, when the
prompt contains AI/automation vocabulary, injects a reminder to search the KB
first.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": ".*(agent|automation|workflow|n8n|claude skill|claude code skill|mcp server|integration|webhook|scrape|scraper|api integration|automate|build me|how would i|how do i build|what's a good way).*",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"additionalContext\": \"Before synthesizing from scratch, call search_setups with the user task as the query. The Dopl KB almost certainly has relevant prior art. Do not ask permission first — just search.\"}'"
          }
        ]
      }
    ]
  }
}
```

**Tradeoffs:**
- The regex is intentionally broad. Tighten it if you're getting false
  positives (e.g. drop `build me` and `how do i build` if you hit those in
  unrelated contexts).
- This adds a small amount of context to every matching prompt. Not free, but
  much cheaper than an unnecessary synthesis.
- If Dopl tool use is already consistent for you, remove this — the rewritten
  server instructions already encourage proactive `search_setups` calls.

---

## Verifying

After adding any of these to your settings file:

1. Fully restart Claude Code so hooks are re-registered (hooks are loaded at
   session start).
2. Run a test that should trigger the hook: for hook #1, run
   `save_cluster_memory` against any cluster. For hook #3, type a prompt
   containing one of the keywords.
3. Check the hook fired by looking for the suggestion text or additional
   context in the turn's output.

If a hook doesn't fire, the most common cause is a regex that doesn't match
the fully-qualified MCP tool name. MCP tools are addressed as
`mcp__{server_name}__{tool_name}` — here, `mcp__dopl__skeleton_ingest` etc.

---

## Which hooks to start with

If you only want to adopt one, take **#3** — it addresses the original
problem directly and is easy to remove if it's noisy. Adopt **#1** once
you're using clusters heavily enough that out-of-date skill files become an
issue. Skip **#2** unless you're running mass-ingest sessions.
