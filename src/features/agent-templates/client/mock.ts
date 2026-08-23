import type { AgentTemplate } from "./types";

/**
 * ⚠⚠ DEV MOCK — HARDCODED AGENT-TEMPLATE FIXTURES (2026-08-23) ⚠⚠
 *
 * `supabase/migrations/20260822200000_agent_templates.sql` IS NOT APPLIED to the
 * dev project, so `GET /api/agent-templates` throws on a missing relation and
 * the Agents page has nothing to draw. These rows exist so the surface can be
 * REVIEWED — the three scope panels, the card face, the editor behind a card —
 * and for no other reason.
 *
 * ⚠ THIS FILE IS TEMPORARY. Apply the migration and DELETE it, together with the
 * `isMockData` branch in `../hooks/use-agent-templates.ts` and the "Sample data"
 * note in `../components/agent-templates-core.tsx`. Nothing else imports it.
 *
 * ⚠ UNREACHABLE IN A PRODUCTION BUILD. Its one consumer is gated on
 * `process.env.NODE_ENV !== "production"`, which both bundlers that compile this
 * tree resolve at BUILD time, so a shipped build cannot render a row from here
 * no matter how the API fails. Never import it from anywhere else — an ungated
 * second consumer is what would put these fixtures in front of a customer.
 *
 * ⚠ READ-SIDE ONLY. Writes are NOT mocked: saving from the editor still hits the
 * real (missing) table and surfaces the server's own failure through the
 * editor's error line. That is deliberate — a page whose reads are fake and
 * whose writes silently "succeed" is a page that teaches the wrong thing.
 *
 * ⚠ MODULE-LEVEL CONSTANT, not a factory. The hook hands this array straight to
 * a `useMemo` dependency (`groupByVisibility`); a fresh array per render would
 * regroup and re-render the whole grid on every unrelated state change — the
 * same identity rule `useAgentTemplates`' module-level `select` follows.
 *
 * Follows `apps/desktop-ui/src/pages/home/mock.ts`, the design-mock precedent in
 * this repo. Unlike that one these are API-SHAPED (`AgentTemplate` verbatim), so
 * the compiler fails the moment the wire shape moves under them.
 */

const WS = "ws-mock";
const ME = "user-mock";

/** `workspaceId` is a placeholder: no surface on this page reads it. */
function mock(over: Partial<AgentTemplate> & { id: string; name: string }): AgentTemplate {
  return {
    workspaceId: WS,
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: ME,
    createdAt: "2026-08-14T09:12:00Z",
    updatedAt: "2026-08-22T17:40:00Z",
    ...over,
  };
}

export const MOCK_AGENT_TEMPLATES: AgentTemplate[] = [
  // ── Private ────────────────────────────────────────────────────────────────
  mock({
    id: "tpl-mock-code-auditor",
    name: "Code Auditor",
    description: "Reviews a diff for duplication, dead paths and unsafe edits.",
    instructions: [
      "You audit code that is already written. You do not add features.",
      "",
      "1. REFACTOR toward the shape the file already has. If a module states a",
      "   rule in its header, the fix that violates it is the wrong fix.",
      "2. SANITATION: delete what the change orphaned — unused exports, dead",
      "   branches, comments describing code that no longer exists.",
      "3. NO REPEATED CODE. If a fact is stated twice, name the two readers and",
      "   collapse them into one. Two statements of one fact is the defect,",
      "   not the duplication itself.",
      "",
      "Report one line per finding: path:line, the problem, the fix. No praise,",
      "no summary paragraph, no scope creep.",
    ].join("\n"),
    model: "claude-opus-5",
    fields: [
      { key: "severity", value: "high" },
      { key: "scope", value: "changed files only" },
      { key: "style", value: "one line per finding" },
    ],
    visibility: "private",
    knowledgeBases: [
      { id: "kb-mock-conventions", name: "Engineering conventions" },
      { id: "kb-mock-invariants", name: "Product invariants" },
    ],
  }),
  mock({
    id: "tpl-mock-research-scout",
    name: "Research Scout",
    description: "Reads around a question and comes back with sources, not opinions.",
    instructions:
      "Answer with what you found and where you found it. Every claim carries a link. When the sources disagree, say so rather than picking one.",
    model: "claude-sonnet-5",
    fields: [{ key: "depth", value: "medium" }],
    visibility: "private",
    knowledgeBases: [{ id: "kb-mock-market", name: "Market notes" }],
  }),

  // ── Team ───────────────────────────────────────────────────────────────────
  mock({
    id: "tpl-mock-pr-review-bot",
    name: "PR Review Bot",
    description: "First pass on every pull request before a human opens it.",
    instructions:
      "Check the diff against the repo's own conventions before checking it against your own taste. Flag missing tests, silent catch blocks and any new second source of truth. Skip formatting nits unless they change meaning.",
    model: "claude-haiku-4-5-20251001",
    fields: [
      { key: "repo", value: "setup-intelligence-engine" },
      { key: "blocking", value: "security, data loss" },
      { key: "tone", value: "terse" },
      { key: "max findings", value: "12" },
    ],
    visibility: "team",
    teamIds: ["team-mock-eng"],
    knowledgeBases: [{ id: "kb-mock-conventions", name: "Engineering conventions" }],
    createdBy: "user-mock-2",
  }),
  mock({
    id: "tpl-mock-docs-writer",
    name: "Docs Writer",
    description:
      "Turns a shipped change into the paragraph a customer can actually act on — reads the diff, the release note and the support threads that came before it, then writes in the product's own voice rather than in release-note boilerplate. Leaves a TODO wherever the behaviour is genuinely ambiguous instead of inventing the answer.",
    instructions:
      "Write for someone who has the product open and a task in front of them. Lead with what changed for them, not with what we built.",
    visibility: "team",
    teamIds: ["team-mock-eng", "team-mock-gtm"],
    fields: [{ key: "voice", value: "plain, second person" }],
    createdBy: "user-mock-2",
  }),

  // ── Public (wire value: `workspace`) ───────────────────────────────────────
  mock({
    id: "tpl-mock-onboarding-guide",
    name: "Onboarding Guide",
    description: "Walks a new member through their first week, one question at a time.",
    instructions:
      "You are the first thing a new member talks to. Answer from the workspace's own knowledge bases; when you don't have the answer, name the person who does instead of guessing.",
    model: "claude-fable-5",
    fields: [
      { key: "audience", value: "new hires" },
      { key: "escalate to", value: "#help-onboarding" },
    ],
    visibility: "workspace",
    knowledgeBases: [{ id: "kb-mock-handbook", name: "Company handbook" }],
  }),
  mock({
    id: "tpl-mock-bug-triage",
    name: "Bug Triage",
    description: "Reproduces, classifies and routes an incoming report.",
    instructions:
      "Reproduce before you classify. If you cannot reproduce it, say what you tried and what you'd need — an unreproduced bug filed as 'cannot reproduce' is a bug filed twice.",
    model: "claude-sonnet-5",
    fields: [
      { key: "severity scale", value: "P0-P3" },
      { key: "route to", value: "owning team" },
    ],
    visibility: "workspace",
    createdBy: "user-mock-3",
  }),
  // ⚠ NAME ONLY — the legal minimum shape (`../schema.ts`): no description, no
  // instructions, no model, no fields, no bases. Renders a card with a name and
  // nothing else, which is the row most likely to break a card layout.
  mock({
    id: "tpl-mock-scratch",
    name: "Scratch",
    visibility: "workspace",
    createdBy: null,
  }),
];
