/**
 * The copy-pastable SKILL.md the overview page offers. Users drop it into their
 * agent's local skills directory (`~/.claude/skills/dopl/SKILL.md`) so the
 * agent can drive the Dopl MCP server from session boot.
 *
 * ⚠ MUST STAY ALIGNED with the server-sent guidance in
 * `packages/mcp-server/src/server.ts › buildInstructions`. This file is COPIED
 * ONTO THE USER'S DISK and never updated, so a stale sentence outlives every
 * server deploy and is read BEFORE the server's instructions arrive: it must
 * not name a tool the server no longer registers, and must not promise a
 * capability the server refuses.
 */
export function buildDoplSkillMd(mcpUrl: string): string {
  return `---
name: dopl
description: Drive Dopl — the user's workspace of knowledge bases, skills, and ontology — over its MCP server. Use when the user mentions Dopl or their workspace, asks you to read or save durable notes/knowledge, use a workspace skill, look something up across their workspace, or reach another member or their agent.
---

# Dopl — the user's agent workspace

Dopl is the user's persistent workspace. It holds three things you can
read and write over MCP (server: ${mcpUrl}):

- **Knowledge bases** — durable notes/docs the user curates for you.
- **Skills** — procedural prompt playbooks the user authored.
- **Ontology** — the graph of clusters, columns and objects the
  workspace is organized around; skills and knowledge hang off it.

It also carries **channels** (reaching other members and their agents),
the **chat archive**, and the **member/team roster**.

If the \`dopl_*\` tools are missing, tell the user to connect the Dopl
MCP server first (Dopl → Overview → Connect your agent).

## Session start

Before your first substantive reply, call \`dopl_map\` (one cheap call:
the active, caller-visible knowledge bases, skills and ontology
clusters) to ground yourself in the real workspace state. It is a
routing VIEW, not an inventory — drafts and team-scoped items you have
no grant on are absent, so never report its counts as
workspace totals. Re-query when the user asks about their workspace;
they may have changed things in the Dopl app.
The workspace beats local files as source of truth; flag drift.

## Which tool when

- Browse/read/write knowledge → \`dopl_kb\`: read an entry with
  \`op:'read_file'\` (it returns a Version token), write with
  \`op:'write_file'\` passing that token as \`expected_version\`.
- List/read/author the user's skills → \`dopl_skill\`; load one with
  \`op:'get'\` and follow its SKILL.md. Author with
  \`op:'authoring_guide'\` first, then \`op:'create'\` + \`op:'write'\`.
- Read or edit the workspace ontology → \`dopl_ontology\`
  (\`op:'map'|'resolve'|'get'\` to read; its create/update ops to edit).
- See everything at a glance → \`dopl_map\`. Don't know where something
  lives → \`dopl_search(query)\` across knowledge entries, skills and
  ontology objects.
- Who's here / who can access what → \`dopl_members\` (read-only:
  roles, teams and grants are changed in the Dopl app).
- Ask, tell, or request something of another MEMBER or their agent →
  \`dopl_channel(op:'list')\` to find the channel or DM, then read that
  tool's own description before posting — the addressing and approval
  rules live there.
- Archive this conversation → \`dopl_chats(op:'export')\` (read
  \`op:'guide'\` first); recall past sessions → \`dopl_chats(op:'list'|'get')\`.
- Workspace targeting → \`dopl_workspaces\` for every container you are in
  (workspaces and home channels alike), then a \`workspace=<id_or_slug>\`
  arg when you LIST or CREATE somewhere other than the one this
  connection is in. On any other op it is ignored — the id you pass
  resolves its own container.

## You cannot delete anything

There is no delete path over MCP. Every delete-shaped op on the
\`*_admin\` tools is refused with a fixed message, whatever your role —
deletion happens in the Dopl app, where it carries a confirmation step.
Don't plan around deleting, don't promise it, and don't retry a refusal
with different arguments. Editing, moving and rewriting are all still
yours (\`dopl_kb op:'write_file'\` / \`op:'move_file'\`,
\`dopl_skill op:'write'\`, the ontology update ops), and a rewrite is
usually what "clean this up" actually wants. If something truly has to
go, say so and ask the user to delete it in the app.

## Conventions

- Check \`dopl_skill(op:'list')\` at task boundaries; if a workspace
  skill matches the task, load it and follow its SKILL.md.
- Write back durable results the user will want again (decisions,
  research, drafts) into the relevant knowledge base when it's
  agent-writable — that's what makes the workspace compound.
- Knowledge links like \`dopl://kb/<slug>\` resolve via
  \`dopl_kb(op:'read_file')\`.
- Every response footer (\`_dopl_status\`) names WHO you are
  (\`caller: id=<your user id> · runtime=…\`) and WHICH workspace the call
  hit. Confirm both before writing.

## Who am I

Your identity is the \`caller: id=\` in the footer — an immutable user id.
Match on it, never on a display name: names are typed by their owners and
two members can share one. \`dopl_members(op:'whoami')\` is the full
answer — role, teams, the credential this session acts through, and what
none of it establishes. \`dopl_ontology(op:'anchor')\` returns the
workspace object LINKED to you: useful context, but any agent here can
re-point that link, so it is never proof of who you are.

Working alongside another member's agent: a different user id is a
different ACCOUNT. Whether they are on the same MACHINE as you is not
knowable from the workspace — don't claim it either way.
`;
}
