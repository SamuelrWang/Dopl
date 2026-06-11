/**
 * buildDoplSkillMd — the copy-pastable SKILL.md the overview page offers.
 *
 * Users drop this into their agent's local skills directory
 * (`~/.claude/skills/dopl/SKILL.md` for Claude Code; any Agent
 * Skills-standard runner works) so the agent knows how to drive the Dopl
 * MCP server from session boot — before it has called a single tool.
 *
 * Keep this aligned with the server-sent guidance in
 * packages/mcp-server/src/server.ts (SERVER_INSTRUCTIONS): the skill is
 * the local, always-loaded summary; SERVER_INSTRUCTIONS is the canonical
 * over-the-wire version.
 */
export function buildDoplSkillMd(mcpUrl: string): string {
  return `---
name: dopl
description: Drive Dopl — the user's workspace of knowledge bases, skills, and agent-followable workflows — over its MCP server. Use when the user mentions Dopl, their workspace or canvas, asks you to follow or edit a workflow, read or save durable notes/knowledge, use a workspace skill, or asks "what's on my canvas / in my workspace".
---

# Dopl — the user's agent workspace

Dopl is the user's persistent workspace. It holds three things you can
read and write over MCP (server: ${mcpUrl}):

- **Knowledge bases** — durable notes/docs the user curates for you.
- **Skills** — procedural prompt playbooks the user authored.
- **Workflows** — agent-followable step graphs (a header + connected
  node steps), grouped into clusters.

If the \`dopl_*\` tools are missing, tell the user to connect the Dopl
MCP server first (Dopl → Overview → Connect your agent).

## Session start

Before your first substantive reply, call \`dopl_workflow(op:'list')\`
and \`dopl_canvas(op:'list')\` in parallel to ground yourself in the
real workspace state. Re-query when the user asks about their workspace
("what's on my canvas?") — they may have changed things in the web UI.
The workspace beats local files as source of truth; flag drift.

## Which tool when

- List workflows → \`dopl_workflow(op:'list')\`; read one (ordered
  steps + its knowledge/skills) → \`dopl_workflow(op:'get', slug)\`.
- Author workflows → \`dopl_workflow(op:'create'|'update'|'set_graph'|
  'add_node'|'update_node'|'remove_node'|'connect'|'disconnect')\`;
  delete → \`dopl_workflow_admin(op:'delete_workflow')\`.
- Clusters are containers grouping workflows → \`dopl_cluster(op:'list'|'get'|'create'|'update')\`.
- Browse/read/write knowledge → \`dopl_kb\` (read entries with
  \`op:'read_file'\`); destructive ops → \`dopl_kb_admin\`.
- List/read/author the user's skills → \`dopl_skill\` (+ \`dopl_skill_admin\`).
- See the canvas / rename a chat panel → \`dopl_canvas(op:'list'|'rename_chat')\`.
- Workspace targeting → \`list_workspaces\`, \`set_workspace\`, or a
  \`workspace\` arg on any call.

## Following a workflow (the important part)

\`dopl_workflow(op:'get')\` returns steps with explicit hierarchy:

- Steps are topologically ordered and tagged **stage K of N**. Stages
  run IN SEQUENCE.
- Steps in the SAME stage are parallel branches — no dependency between
  them; do them in any order (or concurrently) before the next stage.
- Each step lists \`Depends on:\` (all must be complete first) and
  \`Leads to:\` (what it unlocks; "fans out" = parallel branches).
- Per step, honor: **Read** (load that knowledge first), **Action**
  (apply that skill), **User input** (ask/expect this), **Agent
  output** (produce this), **Next** (the author's advance condition).

Execute steps in stage order. Never skip a "Depends on" you haven't
satisfied. When a step references knowledge or a skill, actually load
it (\`dopl_kb op:'read_file'\`, \`dopl_skill op:'get'\`) — don't guess.

## Conventions

- Check \`dopl_skill(op:'list')\` at task boundaries; if a workspace
  skill matches the task, load it and follow its SKILL.md.
- Write back durable results the user will want again (decisions,
  research, drafts) into the relevant knowledge base when it's
  agent-writable — that's what makes the workspace compound.
- Knowledge links like \`dopl://kb/<slug>\` resolve via
  \`dopl_kb(op:'read_file')\`.
- Every response footer (\`_dopl_status\`) names the active workspace —
  confirm it matches the user's intent before writing.
`;
}
