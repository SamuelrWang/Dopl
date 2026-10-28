/**
 * Every word in the Agent native section, including the script the agent
 * window plays. Markup: ./agent-native-section.tsx (shell) and
 * ./agent-native-window.tsx (the agent's own desktop chat, on the glass).
 *
 * The script reuses onboarding step 2's shape and timeline builder
 * (`@/features/onboarding/components/connect-agent-script`): segments of user
 * turns, agent turns and Dopl MCP tool rows, Claude then Gemini, looping. One
 * continuous piece of work across the two agents, since both reach the same
 * workspace. Tool labels are Dopl's real MCP names, humanised the onboarding
 * way (`dopl_manage_agent` → "Dopl manage agent"); the section test checks each
 * one against packages/mcp-server/src/tool-manifest.ts.
 */
import type { ScriptSegment } from "@/features/onboarding/components/connect-agent-script";

export const AGENT_NATIVE_COPY = {
  eyebrow: "Agent native",
  heading: "Software built for your agents to operate",
  lede: "Every feature in Dopl is exposed over MCP, so anything you can do in the app, your agent can do for you.",
  primaryCta: "Get started",
  secondaryCta: "Download the app",
} as const;

/** The agent app's window chrome. */
export const AGENT_APP = {
  connected: "Dopl connected",
  replyTo: "Reply to",
  logos: {
    claude: "/img/onboarding/claude-logo.svg",
    gemini: "/img/logos/gemini.svg",
  },
  doplMark: "/img/onboarding/dopl-mark.png",
} as const;

export const AGENT_SCRIPT: ScriptSegment[] = [
  {
    logo: "claude",
    name: "Claude",
    msgs: [
      { kind: "user", text: "Set up a recruiter and a coder for our backend hire." },
      { kind: "agent", text: "Creating both identities in Dopl." },
      { kind: "tool", label: "Dopl manage agent", arg: "Recruiter" },
      { kind: "tool", label: "Dopl manage agent", arg: "Coder" },
      { kind: "agent", text: "Both identities are ready, each with its own role and instructions." },
      { kind: "user", text: "Give them our hiring playbook." },
      { kind: "tool", label: "Dopl manage knowledge", arg: "Hiring playbook" },
      { kind: "tool", label: "Dopl write entry", arg: "Sourcing" },
      { kind: "tool", label: "Dopl write entry", arg: "Interview loop" },
      { kind: "agent", text: "The playbook has two entries, and both identities can read it." },
    ],
  },
  {
    logo: "gemini",
    name: "Gemini",
    msgs: [
      { kind: "user", text: "Start them on the backend role in a new channel." },
      { kind: "tool", label: "Dopl create channel", arg: "#backend-hire" },
      { kind: "tool", label: "Dopl launch agent", arg: "Recruiter" },
      { kind: "tool", label: "Dopl launch agent", arg: "Coder" },
      { kind: "agent", text: "Both agents are now working in #backend-hire." },
      { kind: "agent", text: "Recruiter shortlisted 12 candidates, and Coder scored all four take-home submissions." },
      { kind: "user", text: "Great work. End both sessions." },
      { kind: "tool", label: "Dopl manage session", arg: "End Recruiter" },
      { kind: "tool", label: "Dopl manage session", arg: "End Coder" },
      { kind: "agent", text: "Both sessions have ended, and their results are saved in #backend-hire." },
    ],
  },
];
