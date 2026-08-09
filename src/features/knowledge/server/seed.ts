import "server-only";
import type { SeedFixture } from "./seed-fixtures";

/**
 * Canonical seed knowledge base for a brand-new workspace: the "Dopl
 * Guide" — a compact, agent-facing manual for operating this workspace
 * over MCP. Replaces the earlier generic demo bases (networking-emails,
 * competitor-intel, …) so fresh workspaces start with content the owner
 * actually wants to keep.
 *
 * Pure function — no I/O. `service-seed.ts#seedWorkspace` iterates this
 * and records each entry's `key` → inserted uuid so the ontology seed can
 * cross-reference specific entries.
 *
 * Two callers:
 *   1. The workspace-seed orchestrator (`features/workspaces/server/seed-workspace.ts`).
 *   2. `scripts/seed-knowledge-bases.ts` — explicit `--all` backfill.
 */

/** Slug of the Dopl Guide base — the orchestrator's idempotency key. */
export const DOPL_GUIDE_SLUG = "dopl-guide";

/** Stable entry keys — used to wire ontology cross-references. */
export const GUIDE_ENTRY_KEYS = {
  whatIsDopl: "what-is-dopl",
  mcpTools: "the-mcp-tools",
  sessionRitual: "the-session-ritual",
  buildingOntology: "building-the-ontology",
  knowledgeVsSkills: "knowledge-vs-skills",
} as const;

export function buildSeedKnowledgeBases(): SeedFixture[] {
  return [
    {
      name: "Dopl Guide",
      slug: DOPL_GUIDE_SLUG,
      description:
        "How this workspace works and how your agent should use it over MCP. Start here.",
      agentWriteEnabled: false,
      rootFolders: [],
      rootEntries: [
        {
          key: GUIDE_ENTRY_KEYS.whatIsDopl,
          title: "Start here — what Dopl is",
          entryType: "doc",
          excerpt:
            "A Dopl workspace is shared memory that humans and agents both read and write over MCP. Here's what lives where.",
          body: `# Start here — what Dopl is

A Dopl **workspace** is shared memory that humans and agents both read and write — the human through this web app, the agent through the Dopl MCP server. Anything one side saves, the other sees on its next run. It is not a chat log; it is the durable state your team operates from.

The workspace has four surfaces. Each answers a different question:

| Surface | Answers | You reach it with |
| --- | --- | --- |
| **Ontology** | "What things exist and how do they connect?" | \`dopl_ontology\` |
| **Knowledge** | "What do we know?" (durable reference) | \`dopl_kb\` |
| **Skills** | "How do we do a recurring task?" | \`dopl_skill\` |
| **Chats** | "What happened in past sessions?" | \`dopl_chats\` |

## The rule of thumb

- A **fact or reference** you'll reread → Knowledge entry.
- A **procedure** you'll rerun → Skill.
- A **thing** (a person, project, account) with attributes and links → Ontology object.
- A **record of a working session** → Chat export.

## Why it compounds

Every session that ends with an export, a filed learning, or an updated object makes the next session start smarter. The agent that reads \`dopl_map\` at the top of a session inherits everything prior sessions wrote down. Keeping these surfaces current is the whole point — an empty workspace teaches the agent nothing.`,
        },
        {
          key: GUIDE_ENTRY_KEYS.mcpTools,
          title: "The MCP tools",
          entryType: "doc",
          excerpt:
            "Every Dopl MCP tool, what it does, and when to reach for it. Read tools are cheap — call them early and often.",
          body: `# The MCP tools

The Dopl MCP server exposes one tool per surface. Most are multi-op: you pass \`op="..."\`. Read ops are cheap — call them liberally. The \`*_admin\` variants carry the same ops but require an elevated role; reach for the plain tool first.

| Tool | What it does | Reach for it when |
| --- | --- | --- |
| \`dopl_map\` | Compact manifest of the whole workspace | **First call of every session** — orient before acting |
| \`dopl_search\` | Cross-surface search (knowledge, skills, ontology, chats) | You don't know where something lives |
| \`dopl_kb\` | Knowledge bases + entries: \`list_bases\`, \`get_tree\`, \`read_file\`, \`write_file\`, \`search\`, \`create_base\` | Reading or filing durable reference |
| \`dopl_skill\` | Skills: \`list\`, \`get\`, \`read\`, \`create\`, \`update\`, \`write\` | Running or authoring a repeatable procedure |
| \`dopl_ontology\` | The object graph: \`get\`, \`map\`, \`resolve\`, \`create_object\`, \`set_attribute\`, \`set_relationship\` | Modelling things and their connections |
| \`dopl_chats\` | Session archive: \`list\`, \`get\`, \`export\`, \`append\` | Ending a session, or recalling a past one |
| \`dopl_members\` | Membership, teams, access (read-only): \`whoami\`, \`list\`, \`teams\`, \`my_access\` | Checking who's here and what you can see |

## Notes that save round-trips

- Most tools accept a **slug OR a uuid** wherever they take a resource handle. Slugs come back from \`list\`/\`map\`; either works.
- Writes record who made them (\`user\` vs \`agent\`), so the history stays honest. Don't be shy about writing — seeded rows are ordinary data and everything is reversible.`,
        },
        {
          key: GUIDE_ENTRY_KEYS.sessionRitual,
          title: "The session ritual",
          entryType: "doc",
          excerpt:
            "Open with dopl_map, close with a dopl_chats export. What to capture, and what makes an export worth rereading.",
          body: `# The session ritual

Two habits make every session compound instead of evaporate.

## Open: \`dopl_map\`

The first call of a session is \`dopl_map\`. It returns a compact manifest — the knowledge bases, skills, ontology clusters, and recent chats — so you act on what the workspace already knows instead of re-deriving it. If the map hints at a relevant skill or entry, open it before improvising.

## Close: \`dopl_chats\` op=\`export\`

End a substantive session by exporting it. An export is **summary-per-message** by default — one concise line per turn — with verbatim text kept only when the user explicitly asks to preserve exact wording. Pass a stable \`clientSessionId\` so re-exporting the same session updates it in place instead of duplicating.

A good export carries three things beyond the transcript:

- **Deliverables** — concrete outputs, as checklist items (\`{ label, done }\`). What got made, and whether it landed.
- **Learnings** — durable takeaways worth surfacing later ("the staging DB resets nightly").
- **Decisions** — captured in the message summaries: what was chosen and *why*.

## The test

Ask: *if a teammate's agent read only this export, could it pick up where I left off?* If not, the summaries are too thin. A learning that will matter next week doesn't belong only in the export — promote it to a Knowledge entry (see "Knowledge vs Skills").`,
        },
        {
          key: GUIDE_ENTRY_KEYS.buildingOntology,
          title: "Building the ontology",
          entryType: "doc",
          excerpt:
            "Objects, not documents. Short attributes, template fields on columns, refs and edges over prose. When something is an object vs a KB entry.",
          body: `# Building the ontology

The ontology is a graph of **objects** — the things your work is about (people, accounts, projects, surfaces) — grouped into **clusters**, arranged in **columns**. It is not a place for prose. Prose goes in Knowledge; the ontology holds structure.

## The house style

- **Objects, not documents.** If you're writing paragraphs, it belongs in a KB entry, and the object should *reference* that entry — not inline it.
- **Short attributes.** An attribute is a labelled field: \`text\`, \`pill\`, a \`ref\` to another object, a \`knowledge\` link to KB entries, or a \`skill\` link. Keep values tight — a phrase, not an essay.
- **Template fields on columns.** A column is itself an object; set its \`template\` fields and every new card born in that column inherits them as empty attributes ready to fill. Consistency for free.
- **Refs and edges over prose.** A labelled relationship ("account" —owned by→ "rep") captures a connection that a sentence would only describe. The connections are the value.

## Object or KB entry?

| Make it an object when… | Make it a KB entry when… |
| --- | --- |
| It's a discrete thing with attributes and links | It's reference text you'll reread |
| You want it to appear in the graph | It's a procedure, spec, or explainer |
| Other objects should point at it | It's long-form |

Point objects at the KB entry that documents them (a \`knowledge\` attribute) rather than copying the text. One source of truth; the object is the index card, the entry is the file.

## Keep it current

Objects go stale silently. When a project ships or a person changes role, update the object in the same session — a wrong graph is worse than a thin one.`,
        },
        {
          key: GUIDE_ENTRY_KEYS.knowledgeVsSkills,
          title: "Knowledge vs Skills",
          entryType: "doc",
          excerpt:
            "Where a thing belongs — with three concrete examples each. Facts to Knowledge, procedures to Skills, things to the Ontology, sessions to Chats.",
          body: `# Knowledge vs Skills

These two surfaces overlap in the fuzzy middle. The distinction that keeps them clean:

- **Knowledge** = things that are *true*. Facts, reference, context you reread.
- **Skills** = things you *do the same way* every time. A repeatable procedure, start to finish.

| Surface | It answers | Shape |
| --- | --- | --- |
| Knowledge | "What's true / what do we know?" | Markdown entries in bases |
| Skills | "How do I do this task?" | A SKILL.md with steps |

## Three examples each

**Knowledge**
1. The brand voice guide the team writes in.
2. The production database's quirks and reset schedule.
3. A competitor teardown you'll cite again.

**Skills**
1. Draft an outbound email in the house voice.
2. File a learning as a KB entry (naming, folder, dedupe).
3. Turn a voice memo into a filed note.

## The other two surfaces

Two more surfaces catch what is neither a fact nor a procedure:

- **Ontology** — a *thing* with attributes and links (a person, an account, a project). Objects are index cards; the connections between them are the value. Point an object at the KB entry that documents it rather than inlining prose. See "Building the ontology".
- **Chats** — the record of a *working session*: what was decided, what got made, what was learned. See "The session ritual".

## When they combine

A skill usually **reads** a KB entry, and an ontology object usually **points at** both. That's the intended shape: skills are the muscles, knowledge is the memory, the ontology is the map. Author each where it belongs and wire them together — don't paste reference text into a skill, and don't bury a reusable procedure inside a knowledge entry.`,
        },
      ],
    },
  ];
}
