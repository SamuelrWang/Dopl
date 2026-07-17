import type { SetupStep, GuardrailRule } from "./types";

/**
 * Seed content for the Configuration page — INTENTIONALLY UNUSED for now.
 *
 * The Configuration page is still UI-only (see `mock-data.ts#MOCK_GUIDE`,
 * which renders a rich sample for an established team). This module is the
 * *starter* configuration a brand-new workspace should be born with: a
 * short mission, a few setup plays, and starter guardrails — the spirit of
 * the mock, sized for an empty workspace.
 *
 * It is not wired into any seed path or page yet. When the Configuration
 * page is rebuilt on a real service, the main session will thread this
 * through the workspace-seed orchestrator (alongside knowledge/skills/etc.)
 * and delete this comment. Typed against `./types` so it can't drift from
 * the real shapes in the meantime.
 */

export interface SeedConfiguration {
  /** Base instructions prepended to every agent session in this workspace. */
  mission: string;
  /** Onboarding plays each member's agent works through. */
  steps: SetupStep[];
  /** Starter guardrails — the "ask/always/never" policy each member inherits. */
  guardrails: GuardrailRule[];
}

export const SEED_CONFIGURATION: SeedConfiguration = {
  mission: `You are this workspace's agent. Start every session with dopl_map to see what the workspace already knows, and prefer its skills and workflows over improvising. Before substantive work, check for a matching skill (dopl_skill) and relevant knowledge (dopl_kb). Write durable findings back to Knowledge and archive each session to Chats. When unsure about tone, claims, or anything customer-facing, ask before sending.`,
  steps: [
    {
      kind: "connect",
      id: "seed-connect-dopl",
      name: "Connect your tools",
      category: "Agent platform",
      required: true,
      summary: "Point your agent at this workspace over MCP — skills, knowledge, and workflows, served live.",
      whyText:
        "Everything in this guide is served from the workspace the moment your agent connects. Nothing is installed locally; published changes apply on the agent's next run.",
      linkLabel: "MCP setup docs",
      linkHref: "https://www.usedopl.com/docs/mcp",
      setupCommand: "claude mcp add --transport http dopl https://www.usedopl.com/api/mcp",
      memberNote:
        "One command, then a browser window opens once for sign-in (OAuth). No API keys. Connect the other tools your team uses (email, CRM, Slack) the same way as they come up.",
      agentContext:
        "Dopl is your source of truth. Open with dopl_map, prefer workspace skills over improvising, and write durable findings back to the right knowledge base.",
      scopes: ["Read skills + knowledge", "Write to granted KBs", "Run workflows"],
      sampleDone: false,
    },
    {
      kind: "task",
      id: "seed-task-voice",
      title: "Create your voice file",
      artifact: "file",
      estMinutes: 10,
      summary: "Your agent studies your sent mail and distills how you write.",
      detail:
        "Anything your agent drafts should sound like you, not like a model. This one-time task has your agent read your recent sent mail and produce a voice profile it loads before writing on your behalf.",
      agentPrompt:
        "Read my last 30 sent emails (skip anything sensitive). Distill a voice profile that captures my tone, sentence rhythm, favorite openers and sign-offs, phrases I overuse, and things I never say. Include 3 before/after rewrites of a generic draft into my voice. Save it as a knowledge entry you'll load before drafting anything for me, and show it to me for approval.",
      doneWhen: [
        "A voice profile entry exists covering tone, phrase bank, and rewrites",
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
      id: "seed-task-first-kb",
      title: "Fill your first knowledge base",
      artifact: "knowledge-base",
      estMinutes: 15,
      summary: "Give your agent the reference it needs to stop guessing.",
      detail:
        "Your agent is only as good as what the workspace knows. Pick the one area where you most often re-explain context — your product, your customers, your process — and capture it as a small knowledge base with a handful of tight entries.",
      agentPrompt:
        "Create a knowledge base for the area I most often have to re-explain to you. Interview me for the essentials, then write 3–5 focused entries — each titled as the question it answers, leading with the takeaway. Flag anything you're unsure about instead of guessing.",
      doneWhen: [
        "A knowledge base exists with 3–5 focused entries",
        "Each entry is titled as the question it answers",
        "Open questions are flagged, not guessed",
      ],
      structure: [
        { name: "Title", hint: "the question the entry answers" },
        { name: "Takeaway", hint: "the answer, up top, in one or two lines" },
        { name: "Detail", hint: "supporting context, lists, or a table" },
      ],
      sampleDone: false,
    },
  ],
  guardrails: [
    { id: "seed-gr-map", policy: "always", text: "Start a session with dopl_map before acting" },
    { id: "seed-gr-file", policy: "always", text: "File durable learnings to Knowledge and archive the session to Chats" },
    { id: "seed-gr-send", policy: "ask", text: "Sending any outbound email or message on my behalf" },
    { id: "seed-gr-external", policy: "never", text: "Pasting customer data or internal figures into external tools" },
  ],
};
