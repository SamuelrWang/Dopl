import "server-only";
import type { SkillConnector, SkillStatus } from "../types";

/**
 * Seed skills for a brand-new workspace: four skills that teach an agent
 * to operate Dopl itself — archiving sessions, filing knowledge,
 * authoring the ontology, and walking a workflow. They replace the
 * earlier generic set (outbound-email-drafting etc.), which was never
 * wired to anything live.
 *
 * Bodies use the canonical `[label](dopl://kb/<slug>)` syntax that
 * `parseSkillBody` understands, linking back to the seeded Dopl Guide
 * knowledge base. All four are filed in the "Dopl" folder.
 */

/** Folder every seeded skill lands in. */
export const DOPL_SKILL_FOLDER = "Dopl";

/** Stable slugs — the ontology + workflow seeds cross-reference these. */
export const SEED_SKILL_SLUGS = {
  archiveSession: "archive-a-session-to-chats",
  fileKnowledge: "file-knowledge-well",
  authorOntology: "author-the-ontology",
  walkWorkflow: "walk-a-workflow",
} as const;

export interface SkillSeed {
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string;
  folder: string;
  body: string;
  connectors: SkillConnector[];
  status: SkillStatus;
}

export function buildSeedSkills(): SkillSeed[] {
  return [
    {
      slug: SEED_SKILL_SLUGS.archiveSession,
      name: "Archive a session to Chats",
      description:
        "Exports the working session to Dopl Chats so the next session (yours or a teammate's) can pick up where it left off.",
      whenToUse:
        "The user is wrapping up a substantive session, says 'save this' / 'log this', or you've produced deliverables worth recording.",
      whenNotToUse:
        "Trivial exchanges with no decisions or outputs, or when the user explicitly asks not to record something.",
      folder: DOPL_SKILL_FOLDER,
      body: `Export with \`dopl_chats\` op=\`export\`. The transcript is **summary-per-message** — one concise line per turn — and you exfiltrate the decisions, deliverables, learnings, and next steps that a future agent needs. See [Dopl Guide](dopl://kb/dopl-guide) for the session ritual.

## Step 1 — Summarize each message

Write one tight summary line per turn (\`role\` = user or agent). Capture what was decided and *why*, not blow-by-blow. Keep \`verbatim\` empty unless the user asked to preserve exact wording (a prompt, a legal line) — then include it on that message only.

## Step 2 — Exfiltrate deliverables and learnings

Fill \`deliverables\` as checklist items (\`{ label, done }\`): concrete outputs and whether each landed. Fill \`learnings\` with durable takeaways worth surfacing later ("staging DB resets nightly"). Put next steps in the overview or as unchecked deliverables.

## Step 3 — Set a stable session id

Pass \`clientSessionId\` (a stable handle for this session) so a re-export updates the same chat instead of duplicating it. Give the chat a specific \`title\` and a one-paragraph \`overview\`.

## Step 4 — Promote what will matter

If a learning will matter next week, don't leave it only in the export — file it as a Knowledge entry (use the "File knowledge well" skill). The export is the session record; the KB is the durable memory.`,
      connectors: [],
      status: "active",
    },
    {
      slug: SEED_SKILL_SLUGS.fileKnowledge,
      name: "File knowledge well",
      description:
        "Turns a durable learning into a well-placed, well-named knowledge base entry — without duplicating what's already filed.",
      whenToUse:
        "You've learned something reusable (a fact, a gotcha, a decision, a reference) that should outlive the current session.",
      whenNotToUse:
        "One-off session detail (belongs in the chat export), or long-lived procedure (author a Skill instead).",
      folder: DOPL_SKILL_FOLDER,
      body: `A learning becomes a KB entry when it's *true and reusable* — you'll want to reread it. Procedures become Skills; session records become Chat exports. See [Dopl Guide](dopl://kb/dopl-guide) for the full "Knowledge vs Skills vs Workflows" split.

## Step 1 — Check it isn't already filed

Run \`dopl_kb\` op=\`search\` (or \`dopl_search\`) for the topic first. If an entry exists, **update it** rather than adding a near-duplicate — split knowledge only when the topics are genuinely distinct.

## Step 2 — Pick the base and folder

Choose the base whose subject matches, and a folder that groups the entry with its siblings. If no base fits, create one with \`op=create_base\` — a clear name beats a catch-all "Misc".

## Step 3 — Write it tight

Title it as the thing it answers ("How staging resets", not "Notes"). Lead with the takeaway. Use headings, lists, and a table when structure helps. Write \`op=write_file\` with a short \`excerpt\` so it reads well in lists.

## Step 4 — Link it back

If an ontology object or a workflow step relates to this entry, point that object's \`knowledge\` attribute (or the step's \`reads\`) at the new entry so the graph stays navigable.`,
      connectors: [],
      status: "active",
    },
    {
      slug: SEED_SKILL_SLUGS.authorOntology,
      name: "Author the ontology",
      description:
        "Models things and their connections as objects — short attributes, template fields on columns, refs and edges over prose.",
      whenToUse:
        "You need to represent a thing (person, account, project, surface) and how it connects to others, or the graph has drifted from reality.",
      whenNotToUse:
        "The content is long-form prose (file it in Knowledge and reference it) or a procedure (author a Skill).",
      folder: DOPL_SKILL_FOLDER,
      body: `The ontology holds *structure*, not paragraphs. Objects are index cards; the connections between them are the value. See [Dopl Guide](dopl://kb/dopl-guide) → "Building the ontology" for the house style.

## Step 1 — Object or entry?

If you're about to write prose, stop — it belongs in a KB entry, and the object should *reference* it with a \`knowledge\` attribute. Make an object only for a discrete thing with attributes and links.

## Step 2 — Create in a column

Objects live in columns inside a cluster (\`dopl_ontology\` op=\`create_cluster\` / \`create_column\` / \`create_object\`). Set the column's \`template\` fields with \`op=set_template_field\` so every new card inherits sensible empty attributes.

## Step 3 — Attributes short, refs explicit

Set attributes with \`op=set_attribute\`: \`text\`/\`pill\` for values, \`ref\` to link objects, \`knowledge\`/\`skill\` to point at KB entries and skills. Keep values to a phrase. Add labelled edges with \`op=set_relationship\` ("account" —owned by→ "rep") — the label carries the meaning a sentence would only describe.

## Step 4 — Keep it current

When a project ships or a person changes role, update the object in the same session. A wrong graph misleads; a thin-but-true one is fine.`,
      connectors: [],
      status: "active",
    },
    {
      slug: SEED_SKILL_SLUGS.walkWorkflow,
      name: "Walk a workflow",
      description:
        "Executes a Dopl workflow step by step — resolving refs, respecting branch conditions, and recording output as you go.",
      whenToUse:
        "The user asks to run a process that has a workflow, or you find a matching workflow in dopl_map / dopl_workflow op=list.",
      whenNotToUse:
        "A single repeatable task (run the Skill directly) or a one-off with no branches (just do it).",
      folder: DOPL_SKILL_FOLDER,
      body: `Workflows are step graphs with branch-conditioned edges. Walk them one step at a time so context is disclosed at the pace you execute. See [Dopl Guide](dopl://kb/dopl-guide) → "The MCP tools" for the op surface.

## Step 1 — Find and open

\`dopl_workflow\` op=\`list\` to find it, then op=\`get\` for the whole graph, or go straight to op=\`step\` to start at the entry step. Prefer op=\`step\` for execution — it hands you exactly one step's detail at a time.

## Step 2 — Do the step

Each step carries \`reads\` (KB entries/bases to consult), \`actions\` (skills to run), \`description\`, and \`userInput\` it expects. Read what it says to read, run what it says to run, gather any input from the user before moving on.

## Step 3 — Respect the branch

A step's outgoing edges each carry a \`condition\` — an agent-readable branch guard. Evaluate the conditions against reality and follow the edge that matches. Don't take an unconditional-looking path when a condition applies.

## Step 4 — Record and advance

Write what the step produced back to its \`agentOutput\` (op=\`update_node\`) so a later reader sees the trace, then follow \`nextInstructions\` to the next step. At the end, archive the session (use "Archive a session to Chats").`,
      connectors: [],
      status: "active",
    },
  ];
}
