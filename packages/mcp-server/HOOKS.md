# Claude Code hooks for Dopl

Opt-in Claude Code hook configs that make common Dopl workflows automatic.
Copy the JSON blocks into your `~/.claude/settings.json` (global) or a project's
`.claude/settings.json` (project-scoped). Everything here is optional — the MCP
server works fine without any of them.

Hooks run locally on the user's machine. They are NOT configured through the MCP
server; shipping them here just saves you the work of writing them yourself.

---

## 1. Workspace-awareness nudge (highest leverage)

The most common failure mode is answering "what do I know about X?" / "what's in
my Y cluster?" from general knowledge instead of the user's actual workspace.
This hook runs on every user prompt and, when the prompt looks like a question
about the user's own saved material, reminds the agent to check Dopl first.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": ".*(what do i (know|have)|my notes|my (knowledge|kb|cluster|skill)|in my .* (cluster|workspace|kb|knowledge base)|find my|pull together|summari[sz]e my).*",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"additionalContext\": \"This looks like a question about the user'\\''s own Dopl workspace. Before answering from general knowledge, call dopl_kb(op=search) for their knowledge bases and/or dopl_cluster(op=list)+dopl_cluster(op=get) to see what's in the relevant cluster. Ground the answer in what they actually have.\"}'"
          }
        ]
      }
    ]
  }
}
```

**Tradeoffs:**
- The regex is intentionally broad. Tighten it if you get false positives.
- This adds a small amount of context to every matching prompt — much cheaper
  than answering from stale general knowledge.
- If Dopl tool use is already consistent for you, remove this — the server
  instructions already encourage proactively loading the workspace.

---

## 2. Session-start workspace load

Reminds the agent, on the first prompt of a session, to load the user's clusters
and canvas so the conversation is grounded from turn one. (The server
instructions already say to do this; the hook makes it explicit for setups where
the model tends to skip it.)

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"additionalContext\": \"If this is the first turn of the session, call dopl_cluster(op=list) and dopl_canvas(op=list) in parallel before your substantive reply so questions about the workspace are grounded in current state. Once per session is enough.\"}'"
          }
        ]
      }
    ]
  }
}
```

**Tradeoff:** this fires on every prompt (the hook can't tell it's turn one), so
the reminder is added each turn. Keep it only if your model reliably skips the
session-start load otherwise; the broad matcher makes it noisy.

---

## Verifying

After adding any of these to your settings file:

1. Fully restart Claude Code so hooks are re-registered (hooks load at session
   start).
2. Type a prompt that should trigger the hook (e.g. "what do I know about X?").
3. Check the hook fired by looking for the injected `additionalContext` in the
   turn's output.

If a hook doesn't fire, the most common cause is a regex that doesn't match. For
`PostToolUse` matchers, MCP tools are addressed as
`mcp__{server_name}__{tool_name}` — e.g. `mcp__dopl__dopl_cluster`,
`mcp__dopl__dopl_kb`.

---

## Which hook to start with

Take **#1** — it addresses the most common problem (answering from general
knowledge instead of the user's workspace) and is easy to remove if noisy.
Adopt **#2** only if your model reliably skips the session-start load.
