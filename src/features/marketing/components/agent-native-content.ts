/**
 * Every word (and every scripted beat) in the Agent native section: tab copy
 * AND the strings drawn inside its three animated windows, so copy can change
 * without touching markup.
 * Markup: ./agent-native-section.tsx (shell + tour), ./agent-native-windows.tsx
 * (the three windows). Styles: ../agent-native.css (+ the shared `.lp-ont-*`
 * shell and play contract in ../marketing.css).
 *
 * ⚠ Times are ms from the moment the window starts playing; the tab meter fills
 * over `endMs` plus the section's settle (same tour as Orchestration).
 * Tool names are the real Dopl MCP surface (packages/mcp-server/src/tool-manifest.ts).
 */
import { PEOPLE, RUNTIME } from "./ontology-content";

export const AGENT_NATIVE_COPY = {
  eyebrow: "Agent native",
  heading: "Software built for your agents to operate",
  tablistLabel: "Agent native views",
  primaryCta: "Get started",
  secondaryCta: "Download the app",
} as const;

export const STAGE_COPY = {
  identities: {
    title: "Create identities",
    blurb: "Your agent creates each identity with its role, runtime, and instructions through Dopl's MCP tools.",
  },
  knowledge: {
    title: "Build knowledge",
    blurb: "Your agent creates knowledge bases, writes sectioned entries, and grants identities access to them.",
  },
  agents: {
    title: "Launch and end agents",
    blurb: "Your agent launches identities into a channel, follows their progress, and ends each session when the work is done.",
  },
} as const;
export type StageId = keyof typeof STAGE_COPY;

export type IdentityId = "orchestrator" | "recruiter" | "coder";

/** Sam's identities: his photo, ringed in the identity's colour-bank slot,
 *  with the runtime's mark inset (the landing's identity avatar). */
export const IDENTITIES: Record<
  IdentityId,
  { name: string; color: number; runtime: (typeof RUNTIME)[keyof typeof RUNTIME] }
> = {
  orchestrator: { name: "Orchestrator", color: 3, runtime: RUNTIME.claude },
  recruiter: { name: "Recruiter", color: 9, runtime: RUNTIME.muse },
  coder: { name: "Coder", color: 13, runtime: RUNTIME.chatgpt },
};
export const OWNER_PHOTO = PEOPLE.sam.photo;
export const DOPL_MARK = "/img/onboarding/dopl-mark.png";

/** The agent doing the work, shown at the head of every window's log. */
export const OPERATOR = {
  identity: "orchestrator" as IdentityId,
  via: "Connected over MCP",
  working: "Working",
  done: "Done",
} as const;

/** One MCP call in the log: it appears at `at` running, and lands at `doneAt`. */
export type ToolCall = { tool: string; args: string; at: number; doneAt: number };

// ── 1 · Create identities ─────────────────────────────────────────────────

export const IDENTITY_SCENE = {
  endMs: 5800,
  prompt: "Set up a recruiter and a coder for our backend hire.",
  calls: [
    { tool: "dopl_manage_agent", args: 'action: "create", name: "Recruiter", runtime: "muse"', at: 700, doneAt: 1500 },
    { tool: "dopl_manage_agent", args: 'action: "create", name: "Coder", runtime: "chatgpt"', at: 2000, doneAt: 2800 },
    { tool: "dopl_manage_agent", args: 'action: "update", identity: "recruiter", instructions: "…"', at: 3300, doneAt: 4100 },
    { tool: "dopl_list_agents", args: "{}", at: 4600, doneAt: 5200 },
  ] as ToolCall[],
  label: "Identities",
  instructionsKey: "Instructions",
  notSet: "Not set",
  cards: [
    {
      identity: "recruiter" as IdentityId,
      role: "Sources and screens backend candidates",
      at: 1500,
      /** Filled by the `update` call. */
      instructions: "Prioritize Go and Postgres depth",
      instructionsAt: 4100,
    },
    {
      identity: "coder" as IdentityId,
      role: "Reviews take-home submissions",
      at: 2800,
      instructions: "Score against the backend rubric",
      instructionsAt: 2800,
    },
  ],
  footer: "2 identities ready",
  footerAt: 5200,
} as const;

// ── 2 · Build knowledge ───────────────────────────────────────────────────

export const KNOWLEDGE_SCENE = {
  endMs: 6200,
  prompt: "Write our hiring playbook and give both identities access.",
  calls: [
    { tool: "dopl_manage_knowledge", args: 'action: "create_base", name: "Hiring playbook"', at: 700, doneAt: 1400 },
    { tool: "dopl_write_entry", args: 'path: "Sourcing", body: "## Channels …"', at: 1800, doneAt: 2600 },
    { tool: "dopl_write_entry", args: 'path: "Interview loop", body: "## Screen …"', at: 3000, doneAt: 3800 },
    { tool: "dopl_manage_agent", args: 'action: "update", identity: "recruiter", knowledge_bases: […]', at: 4200, doneAt: 4800 },
    { tool: "dopl_manage_agent", args: 'action: "update", identity: "coder", knowledge_bases: […]', at: 5000, doneAt: 5600 },
  ] as ToolCall[],
  label: "Knowledge base",
  title: "Hiring playbook",
  titleAt: 1400,
  entries: [
    { name: "Sourcing", sections: ["Channels", "Outreach", "Referrals"], at: 2600 },
    { name: "Interview loop", sections: ["Screen", "Technical", "Debrief"], at: 3800 },
  ],
  readersLabel: "Read by",
  readers: [
    { identity: "recruiter" as IdentityId, at: 4800 },
    { identity: "coder" as IdentityId, at: 5600 },
  ],
} as const;

// ── 3 · Launch and end agents ─────────────────────────────────────────────

export type SessionStatus = "working" | "reported" | "ended";
export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  working: "Working",
  reported: "Reported",
  ended: "Ended",
};

export const AGENTS_SCENE = {
  endMs: 6900,
  prompt: "Launch both on the backend role and end them once they report back.",
  calls: [
    { tool: "dopl_create_channel", args: 'name: "backend-hire"', at: 700, doneAt: 1300 },
    { tool: "dopl_launch_agent", args: 'channel: "backend-hire", identity: "recruiter"', at: 1700, doneAt: 2300 },
    { tool: "dopl_launch_agent", args: 'channel: "backend-hire", identity: "coder"', at: 2700, doneAt: 3300 },
    { tool: "dopl_manage_session", args: 'action: "end", to: "@recruiter"', at: 5000, doneAt: 5600 },
    { tool: "dopl_manage_session", args: 'action: "end", to: "@coder"', at: 5900, doneAt: 6500 },
  ] as ToolCall[],
  label: "Channel",
  channel: "backend-hire",
  channelAt: 1300,
  liveSuffix: "live",
  sessions: [
    {
      identity: "recruiter" as IdentityId,
      at: 2300,
      steps: [
        ["working", 2300],
        ["reported", 4200],
        ["ended", 5600],
      ],
      output: [
        ["Sourcing backend candidates…", 2300],
        ["Shortlisted 12 candidates", 4200],
      ],
    },
    {
      identity: "coder" as IdentityId,
      at: 3300,
      steps: [
        ["working", 3300],
        ["reported", 4700],
        ["ended", 6500],
      ],
      output: [
        ["Reviewing 4 take-home submissions…", 3300],
        ["Scored 4 submissions", 4700],
      ],
    },
  ] as {
    identity: IdentityId;
    at: number;
    steps: [SessionStatus, number][];
    output: [string, number][];
  }[],
} as const;
