import type { AgentProfile } from "./types";

/**
 * Static sample profile for the configuration page preview. The page is
 * UI-only for now — no server reads/writes. Delete when the real
 * profile service lands.
 */
export const MOCK_PROFILE: AgentProfile = {
  teamName: "Growth Team",
  version: 4,
  updatedAt: "Jul 3, 2026",
  publishedBy: "Samuel W.",
  instructions: `You are the Growth Team's assistant at Dopl. Always check the Brand Guidelines knowledge base before writing anything customer-facing. Use the Lead Enrichment skill for any prospect research — never research prospects freestyle. Weekly reports follow the Weekly Report skill's format exactly. Customer names and revenue figures never leave the workspace. When in doubt about tone or claims, ask before sending.`,
  skills: [
    {
      id: "sk-1",
      name: "Brand voice",
      description:
        "House style for outbound email, social, and landing copy — voice rules, banned phrases, three worked examples.",
      enabled: true,
      source: "Workspace skill",
      tags: ["Outbound", "Content"],
      runsPerWeek: 31,
      lastUsed: "2h ago",
    },
    {
      id: "sk-2",
      name: "Lead enrichment",
      description:
        "Research a prospect end-to-end: role, company intel, funding, tech stack, suggested opener, next actions.",
      enabled: true,
      source: "Workspace skill",
      tags: ["Sales", "Research"],
      runsPerWeek: 18,
      lastUsed: "5h ago",
    },
    {
      id: "sk-3",
      name: "Weekly report",
      description:
        "Compile the Friday growth report from metrics, Slack highlights, and pipeline changes. Fixed format.",
      enabled: true,
      source: "Workspace skill",
      tags: ["Reporting"],
      runsPerWeek: 4,
      lastUsed: "3d ago",
    },
    {
      id: "sk-4",
      name: "Churn postmortem",
      description:
        "Structured write-up when an account cancels: timeline, signals missed, owner, prevention actions.",
      enabled: false,
      source: "Marketing pack",
      tags: ["Retention"],
      runsPerWeek: 0,
      lastUsed: "Never",
    },
    {
      id: "sk-5",
      name: "Competitor teardown",
      description:
        "Deep-dive a competitor: pricing moves, positioning shifts, feature deltas — feeds Competitor Intel KB.",
      enabled: true,
      source: "Marketing pack",
      tags: ["Research", "Intel"],
      runsPerWeek: 7,
      lastUsed: "1d ago",
    },
    {
      id: "sk-6",
      name: "Case study draft",
      description:
        "Turn a customer call transcript into a case-study draft with pull quotes and metrics callouts.",
      enabled: false,
      source: "Marketing pack",
      tags: ["Content"],
      runsPerWeek: 0,
      lastUsed: "Never",
    },
  ],
  connections: [
    {
      id: "dopl",
      name: "Dopl",
      category: "Agent platform",
      required: true,
      status: "auto",
      tagline: "Skills, knowledge, and workflows — served live over MCP.",
      teamUsage:
        "The backbone. Every skill, knowledge base, and workflow on this page is served from the workspace the moment an agent connects — nothing is installed locally, and manager updates apply on the agent's next run.",
      agentContext:
        "Dopl is your source of truth. Before substantive work, check for a matching skill (dopl_skill) and relevant knowledge (dopl_kb). Prefer workspace skills over improvising. Write durable findings back to the appropriate knowledge base.",
      setupCommand: "claude mcp add --transport http dopl https://www.usedopl.com/api/mcp",
      setupNote:
        "One command. A browser window opens once for sign-in (OAuth) — no API keys, nothing else to configure.",
      scopes: ["Read skills + knowledge", "Write to granted KBs", "Run workflows"],
    },
    {
      id: "slack",
      name: "Slack",
      category: "Communication",
      required: true,
      status: "connected",
      tagline: "Channel history for reports; drafts posted for review.",
      teamUsage:
        "Weekly reports pull highlights from #growth and #wins. Agents draft messages but never post directly — drafts land in your DM for approval first.",
      agentContext:
        "Use Slack to read #growth, #wins, and #launches when compiling reports or gathering context. Never send or post without explicit human approval in this session. Prefer thread summaries over full-channel dumps.",
      setupCommand: null,
      setupNote:
        "Connect via the Slack connector in your agent's settings — it's a two-click OAuth flow. Ask your workspace admin if the app isn't yet approved.",
      scopes: ["Read channels", "Draft messages (no auto-send)"],
    },
    {
      id: "notion",
      name: "Notion",
      category: "Docs & wiki",
      required: false,
      status: "action-needed",
      tagline: "Meeting notes and the growth wiki.",
      teamUsage:
        "Call notes and campaign retros live in the Growth wiki. Agents read these for context when enriching leads or drafting postmortems.",
      agentContext:
        "The Growth wiki in Notion holds meeting notes and campaign retros. Search it before asking the human for context they've likely already written down. Read-only — updates go through the human.",
      setupCommand: null,
      setupNote:
        "Connect the Notion MCP connector, then grant access to the 'Growth' teamspace when the share dialog appears. Takes about a minute.",
      scopes: ["Read Growth teamspace"],
    },
    {
      id: "github",
      name: "GitHub",
      category: "Code",
      required: false,
      status: "connected",
      tagline: "Landing-page repo for copy changes.",
      teamUsage:
        "Copy tweaks to the marketing site ship as PRs against `marketing-site`. Agents branch, edit, and open the PR — a human always merges.",
      agentContext:
        "Copy changes to the landing pages go through the marketing-site repo: branch from main, keep diffs copy-only, open a PR with before/after in the description. Never merge; never touch non-copy code.",
      setupCommand: "gh auth login",
      setupNote:
        "Authenticate the GitHub CLI once. Your agent uses it for branches and PRs — repo access follows your existing GitHub permissions.",
      scopes: ["Read/write marketing-site", "Open PRs"],
    },
  ],
  knowledgeBases: [
    {
      id: "kb-1",
      name: "Brand guidelines",
      entryCount: 12,
      enabled: true,
      tint: "#5b6ee1",
      updatedAt: "Jun 28",
      visibility: "Workspace",
      summary: "Voice, tone, claims policy, approved boilerplate.",
    },
    {
      id: "kb-2",
      name: "Competitor intel",
      entryCount: 28,
      enabled: true,
      tint: "#2f7d57",
      updatedAt: "Jul 2",
      visibility: "Workspace",
      summary: "Pricing pages, positioning notes, teardown archive.",
    },
    {
      id: "kb-3",
      name: "Sales playbook",
      entryCount: 9,
      enabled: true,
      tint: "#c0762e",
      updatedAt: "Jun 20",
      visibility: "Growth Team",
      summary: "ICP definitions, objection handling, sequence templates.",
    },
    {
      id: "kb-4",
      name: "Eng handbook",
      entryCount: 41,
      enabled: false,
      tint: "#7c4dbe",
      updatedAt: "Jul 1",
      visibility: "Workspace",
      summary: "Architecture docs and runbooks — not relevant to Growth.",
    },
  ],
  guardrails: [
    { id: "gr-1", kind: "allow", text: "Read any Growth Team Slack channel" },
    { id: "gr-2", kind: "allow", text: "Open PRs against marketing-site" },
    { id: "gr-3", kind: "ask", text: "Sending any outbound email or Slack message" },
    { id: "gr-4", kind: "ask", text: "Editing Notion pages outside personal notes" },
    { id: "gr-5", kind: "block", text: "Billing, contracts, or customer data exports" },
    { id: "gr-6", kind: "block", text: "Sharing revenue figures outside the workspace" },
  ],
  members: [
    {
      id: "m-1",
      name: "Alex Rivera",
      role: "Growth lead",
      initial: "A",
      status: "complete",
      lastSync: "2h ago",
      agentActivity: "41 runs this week",
    },
    {
      id: "m-2",
      name: "Priya Shah",
      role: "Content",
      initial: "P",
      status: "complete",
      lastSync: "1d ago",
      agentActivity: "23 runs this week",
    },
    {
      id: "m-3",
      name: "Jordan Lee",
      role: "SDR",
      initial: "J",
      status: "drifted",
      lastSync: "12d ago",
      agentActivity: "On profile v2",
    },
    {
      id: "m-4",
      name: "Sam Okafor",
      role: "SDR",
      initial: "S",
      status: "not-started",
      lastSync: "—",
      agentActivity: "Never connected",
    },
  ],
};

export const AGENT_SETUP_PROMPT = `Set up my agent for the Growth Team. Connect to Dopl over MCP (HTTP, https://www.usedopl.com/api/mcp — OAuth, no key), then read my team's configuration profile and walk me through connecting each remaining tool. Confirm each step before moving on.`;
