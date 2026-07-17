import type { AgentGuide, MissionStarter } from "./types";

/**
 * Static sample guide for the configuration page preview. The page is
 * UI-only for now — no server reads/writes. Delete when the real
 * profile service lands.
 */
export const MOCK_GUIDE: AgentGuide = {
  teamName: "Growth Team",
  version: 4,
  updatedAt: "Jul 3, 2026",
  publishedBy: "Samuel W.",
  draftCount: 2,
  mission: `You are the Growth Team's assistant at Dopl. Always check the Brand Guidelines knowledge base before writing anything customer-facing. Use the Lead Enrichment skill for any prospect research — never research prospects freestyle. Weekly reports follow the Weekly Report skill's format exactly. Customer names and revenue figures never leave the workspace. When in doubt about tone or claims, ask before sending.`,
  steps: [
    {
      kind: "connect",
      id: "st-dopl",
      name: "Dopl",
      category: "Agent platform",
      required: true,
      summary: "Skills, knowledge, and workflows — served live over MCP.",
      whyText:
        "The backbone. Every skill, knowledge base, and workflow in this guide is served from the workspace the moment an agent connects — nothing is installed locally, and published changes apply on the agent's next run.",
      linkLabel: "MCP setup docs",
      linkHref: "https://www.usedopl.com/docs/mcp",
      setupCommand:
        "claude mcp add --transport http dopl https://www.usedopl.com/api/mcp",
      memberNote:
        "One command. A browser window opens once for sign-in (OAuth) — no API keys, nothing else to configure.",
      agentContext:
        "Dopl is your source of truth. Before substantive work, check for a matching skill (dopl_skill) and relevant knowledge (dopl_kb). Prefer workspace skills over improvising. Write durable findings back to the appropriate knowledge base.",
      scopes: ["Read skills + knowledge", "Write to granted KBs", "Run workflows"],
      sampleDone: true,
    },
    {
      kind: "connect",
      id: "st-hubspot",
      name: "HubSpot",
      category: "CRM",
      required: true,
      summary: "Pipeline of record — contacts, deals, outreach notes.",
      whyText:
        "Every prospect and deal lives in HubSpot. Agents enrich contacts, log outreach drafts as notes, and read deal context before writing anything customer-facing.",
      linkLabel: "HubSpot MCP guide",
      linkHref: "https://developers.hubspot.com/mcp",
      setupCommand:
        "claude mcp add --transport http hubspot https://mcp.hubspot.com/anthropic",
      memberNote:
        "Run the command, then approve the OAuth prompt with your HubSpot login. If you don't see the Growth pipeline afterwards, ask Samuel to check your HubSpot seat.",
      agentContext:
        "HubSpot is the CRM of record. Log every outreach draft as a note on the contact it concerns. Read deal stage and history before drafting. Never change deal stages or amounts — flag what you'd change and let the human do it.",
      scopes: ["Read contacts + deals", "Create notes", "No stage changes"],
      sampleDone: false,
    },
    {
      kind: "connect",
      id: "st-slack",
      name: "Slack",
      category: "Communication",
      required: false,
      summary: "Channel history for reports; drafts posted for review.",
      whyText:
        "Weekly reports pull highlights from #growth and #wins. Agents draft messages but never post directly — drafts land in your DM for approval first.",
      linkLabel: "Slack connector",
      linkHref: "https://slack.com/marketplace",
      setupCommand: "",
      memberNote:
        "Connect via the Slack connector in your agent's settings — a two-click OAuth flow. Ask your workspace admin if the app isn't yet approved.",
      agentContext:
        "Use Slack to read #growth, #wins, and #launches when compiling reports or gathering context. Never send or post without explicit human approval in this session. Prefer thread summaries over full-channel dumps.",
      scopes: ["Read channels", "Draft messages (no auto-send)"],
      sampleDone: true,
    },
    {
      kind: "task",
      id: "st-voice",
      title: "Create your voice file",
      artifact: "file",
      estMinutes: 10,
      summary: "Your agent studies your sent email and distills how you write.",
      detail:
        "Anything your agent drafts should sound like you, not like a model. This one-time task has your agent read your recent sent mail and produce a voice file it loads before writing on your behalf.",
      agentPrompt:
        "Read my last 30 sent emails (skip anything sensitive). Distill a voice.md that captures how I write: tone, sentence rhythm, favorite openers and sign-offs, phrases I overuse, and things I never say. Include 3 before/after rewrites of a generic draft into my voice. Save it where you'll load it before drafting anything for me, and show me the file for approval.",
      doneWhen: [
        "voice.md exists and covers tone, phrase bank, and rewrites",
        "A test draft in your voice is approved by you",
      ],
      structure: [
        { name: "Tone", hint: "3–5 adjectives plus what to avoid" },
        { name: "Phrase bank", hint: "openers, transitions, sign-offs you actually use" },
        { name: "Example rewrites", hint: "3 before/after pairs from real emails" },
      ],
      sampleDone: false,
    },
    {
      kind: "task",
      id: "st-dealrooms",
      title: "Stand up your deal-room knowledge base",
      artifact: "knowledge-base",
      estMinutes: 15,
      summary: "One entry per open deal, structured so agents can act on it.",
      detail:
        "Deal context scattered across email threads is invisible to your agent. This task creates a Deal rooms knowledge base in Dopl with one structured entry per open deal, backfilled from HubSpot — after this, \"prep me for the Acme call\" just works.",
      agentPrompt:
        "Create a knowledge base in Dopl called \"Deal rooms\" using the structure fields in this step. Then read my open deals in HubSpot and backfill one entry per deal. Flag any deal where you couldn't fill a field so I can complete it.",
      doneWhen: [
        "Deal rooms KB exists with the structure below",
        "Every open HubSpot deal has an entry",
        "Gaps are flagged, not guessed",
      ],
      structure: [
        { name: "Account", hint: "company, segment, owner" },
        { name: "Stage", hint: "pipeline stage — mirrors HubSpot" },
        { name: "Next step", hint: "single committed action + date" },
        { name: "Risk", hint: "what could kill the deal" },
      ],
      sampleDone: false,
    },
  ],
  guardrails: [
    { id: "gr-1", policy: "always", text: "Read any Growth Team Slack channel" },
    { id: "gr-2", policy: "always", text: "Enrich prospects with the Lead enrichment skill" },
    { id: "gr-3", policy: "ask", text: "Sending any outbound email or Slack message" },
    { id: "gr-4", policy: "ask", text: "Creating or editing HubSpot records beyond notes" },
    { id: "gr-5", policy: "never", text: "Exporting customer data or revenue figures" },
    { id: "gr-6", policy: "never", text: "Changing deal stages or amounts in HubSpot" },
  ],
  members: [
    {
      id: "m-1",
      name: "Alex Rivera",
      role: "Growth lead",
      status: "complete",
      lastSync: "2h ago",
      activity: "41 runs this week",
    },
    {
      id: "m-2",
      name: "Priya Shah",
      role: "Content",
      status: "complete",
      lastSync: "1d ago",
      activity: "23 runs this week",
    },
    {
      id: "m-3",
      name: "Jordan Lee",
      role: "SDR",
      status: "drifted",
      lastSync: "12d ago",
      activity: "On guide v2",
    },
    {
      id: "m-4",
      name: "Sam Okafor",
      role: "SDR",
      status: "not-started",
      lastSync: "—",
      activity: "Never connected",
    },
  ],
  autoServed: {
    skills: ["Brand voice", "Lead enrichment", "Weekly report", "Competitor teardown"],
    knowledgeBases: ["Brand guidelines", "Competitor intel", "Sales playbook"],
  },
};

/** Templates the mission editor offers as one-click appends. */
export const MISSION_STARTERS: ReadonlyArray<MissionStarter> = [
  {
    label: "Tone & voice",
    text: "\n\nTone: write like a sharp colleague — direct, warm, no filler. Match the Brand voice skill for anything customer-facing.",
  },
  {
    label: "Escalation rule",
    text: "\n\nWhen blocked or uncertain about claims, tone, or data, stop and ask — never guess in customer-facing work.",
  },
  {
    label: "Data boundaries",
    text: "\n\nCustomer names, revenue figures, and contract terms never leave the workspace — no pasting into external tools.",
  },
  {
    label: "Weekly rhythm",
    text: "\n\nEvery Friday, compile the growth report with the Weekly report skill and post the draft for review before 3pm.",
  },
];

export const AGENT_SETUP_PROMPT = `Set up my agent for the Growth Team. Connect to Dopl over MCP (HTTP, https://www.usedopl.com/api/mcp — OAuth, no key), then read my team's configuration guide and walk me through the remaining steps. Confirm each step before moving on.`;
