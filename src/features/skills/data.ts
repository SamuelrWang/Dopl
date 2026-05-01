/**
 * Hardcoded skill data — Phase 1 UI iteration only. No DB backing yet.
 *
 * Skills are workspace-scoped, exposed to a connected agent as MCP
 * tools. Each skill has trigger metadata + a procedure body. The body
 * uses a tiny template syntax for inline references that get rendered
 * as chips:
 *
 *   {kb:slug}                  → links to a knowledge base
 *   {connector:gmail}          → references a connector
 *   {connector:gmail.threads}  → connector with a sub-field
 *   {section:Heading}          → renders an inline section header
 */

import type { SourceProvider, SourceConnection } from "@/features/knowledge/data";

export type SkillStatus = "active" | "draft";

export interface SkillExample {
  id: string;
  title: string;
  input: string;
  output: string;
}

export interface SkillRun {
  id: string;
  invokedBy: string;
  invokedAt: string;
  durationMs: number;
  status: "success" | "error";
  summary: string;
}

export interface SkillConnector extends SourceConnection {
  /** What the skill uses this connector for. */
  usedFor: string;
}

export interface Skill {
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string;
  body: string;
  knowledgeSources: string[];
  connectors: SkillConnector[];
  examples: SkillExample[];
  status: SkillStatus;
  updatedAt: string;
  totalInvocations: number;
  recentRuns: SkillRun[];
}

export const HARDCODED_SKILLS: ReadonlyArray<Skill> = [
  {
    slug: "outbound-email-drafting",
    name: "Outbound email drafting",
    description:
      "Drafts cold and follow-up outreach in your existing tone, using prior threads as context.",
    whenToUse:
      "User asks to draft a cold email, write a follow-up, or describes outreach intent (e.g. \"send Anya something about the report\").",
    whenNotToUse:
      "Internal team comms, replies to existing inbound threads, or anything explicitly transactional (invoices, password resets).",
    body: `Read the user's voice from {kb:networking-emails} before drafting. Three patterns matter: openers, asks, and sign-offs.

{section:Step 1 — Establish context}

If the user mentions a prior thread or relationship, search {connector:gmail.threads} for the most recent message between them and quote one specific phrase from it verbatim in the new draft. If no thread exists, treat this as a cold open.

{section:Step 2 — Draft}

Match the tone in {kb:networking-emails}. Aim for under four sentences. Lead with the specific reason this person matters, not a generic compliment. One concrete ask. Don't apologize for the cold contact.

{section:Step 3 — Sign off}

Sign with the user's first name only. Add a CTA only if explicitly asked. Never use "I hope this finds you well", "I came across your profile", or "I know you're busy" — those are the openers in the {kb:networking-emails} avoid-list.

{section:Output}

Return the draft as a single message. If the user asked for a subject line, prepend it on its own line. Don't include placeholders like [Name] — fill them in or ask the user.`,
    knowledgeSources: ["networking-emails"],
    connectors: [
      {
        provider: "gmail",
        name: "Gmail",
        status: "connected",
        meta: "sam@usedopl.com",
        usedFor: "Search prior threads, reference past replies",
      },
      {
        provider: "slack",
        name: "Slack",
        status: "available",
        usedFor: "Optional: post completed drafts to #outbound for review",
      },
    ],
    examples: [
      {
        id: "ex-1",
        title: "Cold open to a founder",
        input: "Email Anya at Vector — wanted to compare notes on their realtime launch.",
        output:
          "Hi Anya,\n\nYour Vector realtime launch last month is the cleanest thing I've seen ship in this space all year — the 12k signups in 48h thread you posted is making the rounds internally here. I'm working on something adjacent and would love 20 minutes to compare notes on what surprised you on the rollout.\n\nWorth half a coffee Thursday or next week?\n\nSam",
      },
      {
        id: "ex-2",
        title: "Re-engagement after 6 months",
        input:
          "Follow up with Diego — last time we talked he said to reach back out in Q4.",
        output:
          'Hi Diego,\n\nIn April you said to circle back in Q4 once we shipped the team-sharing flow — well, here we are. The "send me a real demo" you asked for is finally a real demo. \n\nThirty minutes when you have time?\n\nSam',
      },
      {
        id: "ex-3",
        title: "Follow-up on a warm intro",
        input:
          'Send a follow-up to Liane who Marcus introduced — just want to thank Marcus and propose a time.',
        output:
          'Hi Liane,\n\nThanks for the kind words back to Marcus — he said to "get on the phone with this one" so I want to make that easy. I have Tuesday or Thursday after 2pm Pacific open this week if either works for you.\n\nSam',
      },
    ],
    status: "active",
    updatedAt: "2 hours ago",
    totalInvocations: 47,
    recentRuns: [
      {
        id: "r-1",
        invokedBy: "Sam Wang",
        invokedAt: "12 min ago",
        durationMs: 1380,
        status: "success",
        summary: 'Drafted cold open to "Anya Lerner" referencing Vector realtime launch.',
      },
      {
        id: "r-2",
        invokedBy: "Sam Wang",
        invokedAt: "2 hours ago",
        durationMs: 1620,
        status: "success",
        summary: "Re-engagement draft for Diego, referencing April thread.",
      },
      {
        id: "r-3",
        invokedBy: "Alice Chen",
        invokedAt: "Yesterday, 4:12 PM",
        durationMs: 940,
        status: "success",
        summary: "Warm-intro follow-up to Liane, prefilled the Tuesday/Thursday slot.",
      },
      {
        id: "r-4",
        invokedBy: "Alice Chen",
        invokedAt: "Yesterday, 11:30 AM",
        durationMs: 2110,
        status: "error",
        summary: "Could not load tone from Networking emails (KB sync stale).",
      },
    ],
  },
  {
    slug: "competitor-research-synthesis",
    name: "Competitor research synthesis",
    description:
      "Pulls competitor signal from Slack and Drive, writes a one-pager you can share.",
    whenToUse:
      "User asks for a competitor recap, wants a positioning teardown, or pastes a competitor URL.",
    whenNotToUse:
      "User wants the raw research data — point them at the {kb:competitor-intel} entries directly instead.",
    body: `Treat {kb:competitor-intel} as the source of truth for prior research. Don't restate; build on it.

{section:Step 1 — Pull recent signal}

Search {connector:slack} (#compete channel) for messages tagged in the last 30 days. Pull file references from {connector:google-drive} (Competitor folder) modified in the same window. De-dup against entries already in {kb:competitor-intel}.

{section:Step 2 — Synthesize}

Group findings by: pricing changes, positioning shifts, feature ships, hiring signals. One paragraph per group, max. If a group has nothing new, omit it — don't pad.

{section:Step 3 — Write the one-pager}

Use the same structure as the existing recaps in {kb:competitor-intel}. Lead with the most disruptive finding. Close with two specific implications for our roadmap. Cite source links inline.`,
    knowledgeSources: ["competitor-intel"],
    connectors: [
      {
        provider: "slack",
        name: "Slack",
        status: "connected",
        meta: "#compete channel",
        usedFor: "Pull recent signals + tagged messages",
      },
      {
        provider: "google-drive",
        name: "Google Drive",
        status: "connected",
        meta: "Competitor folder",
        usedFor: "Pricing screenshots, positioning decks",
      },
    ],
    examples: [
      {
        id: "ex-1",
        title: "Q3 competitor recap",
        input: "Give me a recap of what shifted in our space in Q3.",
        output:
          "Three competitors raised entry-tier pricing 18–25% in July–September. Acme repositioned from \"fastest\" to \"most accurate\" with a marketing refresh on 9/12. Two competitors shipped CRDT-backed realtime, putting us a quarter behind on that surface. Implications: pricing power may be back, and realtime is no longer a differentiator we can lean on past Q1.",
      },
    ],
    status: "active",
    updatedAt: "1 day ago",
    totalInvocations: 12,
    recentRuns: [
      {
        id: "r-1",
        invokedBy: "Sam Wang",
        invokedAt: "Today, 9:04 AM",
        durationMs: 4280,
        status: "success",
        summary: "Q3 recap, 2 paragraphs, surfaced 3 pricing changes from #compete.",
      },
      {
        id: "r-2",
        invokedBy: "Sam Wang",
        invokedAt: "5 days ago",
        durationMs: 3910,
        status: "success",
        summary: "Acme positioning teardown — pulled the 9/12 marketing refresh deck.",
      },
    ],
  },
  {
    slug: "customer-feedback-rollup",
    name: "Customer feedback rollup",
    description:
      "Reads support tickets, Slack DMs, and call transcripts; writes a weekly themes digest.",
    whenToUse:
      "User asks for a feedback summary, a weekly digest, or 'what are people saying'.",
    whenNotToUse:
      "Single-customer questions — pull the specific ticket from {kb:customer-feedback} instead of summarizing.",
    body: `Anchor on {kb:customer-feedback}. The themes already extracted there are the categories; new feedback gets routed into them.

{section:Step 1 — Gather}

Pull the last 7 days from {connector:slack} (#customer-feedback) and {connector:gmail} (support@ inbox). Include voice memos referenced in {kb:customer-feedback}'s pending intake.

{section:Step 2 — Bucket}

For each new piece of feedback, assign it to one of the existing themes in {kb:customer-feedback}. If it doesn't fit, create a candidate new theme and flag it.

{section:Step 3 — Output}

Write a digest with: top 3 themes by volume, one quote per theme, count, and trend vs prior week. Surface any new theme candidates at the bottom for review.`,
    knowledgeSources: ["customer-feedback"],
    connectors: [
      {
        provider: "slack",
        name: "Slack",
        status: "connected",
        meta: "#customer-feedback",
        usedFor: "Power-user DMs and channel posts",
      },
      {
        provider: "gmail",
        name: "Gmail",
        status: "connected",
        meta: "support@ inbox",
        usedFor: "Support ticket bodies",
      },
      {
        provider: "notion",
        name: "Notion",
        status: "available",
        usedFor: "Optional: cross-reference call transcripts in Customer DB",
      },
    ],
    examples: [
      {
        id: "ex-1",
        title: "Weekly digest",
        input: "What are users saying this week?",
        output:
          "Top 3 themes: (1) Onboarding confusion at first canvas (12 mentions, ↑ from 9). (2) Notion sync still missing (8 mentions, flat). (3) Speed praise — \"Notion if it was actually fast\" repeated by 3 separate users this week. New theme candidate: workspace-sharing role granularity (4 mentions, all enterprise pilot accounts).",
      },
    ],
    status: "active",
    updatedAt: "3 days ago",
    totalInvocations: 28,
    recentRuns: [
      {
        id: "r-1",
        invokedBy: "Sam Wang",
        invokedAt: "Today, 10:14 AM",
        durationMs: 5240,
        status: "success",
        summary: "Weekly digest — surfaced new role-granularity theme candidate.",
      },
      {
        id: "r-2",
        invokedBy: "Alice Chen",
        invokedAt: "Yesterday",
        durationMs: 4890,
        status: "success",
        summary: "Pulled 4 quotes for the all-hands deck.",
      },
    ],
  },
  {
    slug: "spec-doc-writer",
    name: "Spec doc writer",
    description:
      "Drafts PRDs and ADRs in our house style, with the rationale links the team expects.",
    whenToUse:
      "User asks to write a PRD, ADR, design doc, or any structured engineering doc.",
    whenNotToUse:
      "Quick technical questions or one-off RFCs — those don't need the full template overhead.",
    body: `Use {kb:product-specs} for the house template and tone. Match the existing doc structure exactly — don't invent new sections.

{section:Step 1 — Identify the doc type}

Ask the user once: PRD, ADR, or design note. If unclear, default to ADR for a single technical decision and PRD for anything broader. Each has a different template in {kb:product-specs}.

{section:Step 2 — Pull priors}

Search {connector:notion} (Engineering DB) and {connector:github} (ADRs folder) for related prior docs. Link them at the top under "Related" — don't summarize them, just link.

{section:Step 3 — Draft}

Follow the section order from {kb:product-specs}. For ADRs: Context, Decision, Consequences, Alternatives considered. For PRDs: Problem, Users, Solution, Non-goals, Open questions. Don't add extras.

{section:Step 4 — Open questions}

End every doc with at least one explicit open question. The team expects them. If you can't think of one, the doc isn't ready.`,
    knowledgeSources: ["product-specs"],
    connectors: [
      {
        provider: "notion",
        name: "Notion",
        status: "connected",
        meta: "Engineering DB",
        usedFor: "Reference prior PRDs, link related decisions",
      },
      {
        provider: "github",
        name: "GitHub",
        status: "connected",
        meta: "ADRs · 14 docs",
        usedFor: "Pull existing ADR headers for the related-docs section",
      },
    ],
    examples: [
      {
        id: "ex-1",
        title: "ADR — connector token storage",
        input: "Write an ADR for whether we store connector tokens per-user or per-workspace.",
        output:
          "## ADR-021: Per-user connector tokens\n\n**Context.** Workspaces share resources but each member has their own Gmail / Slack / Drive.\n\n**Decision.** Tokens are scoped to (workspace, user). Skills declare \"needs Gmail\" abstractly; bindings resolve at run time per invoker.\n\n**Consequences.** A skill Alice built with her Gmail breaks when Bob runs it unless Bob also connected. Tradeoff is acceptable; alternative (workspace tokens) means anyone on the team can send as anyone's account.\n\n**Alternatives considered.** Workspace-level tokens (rejected: blast radius). Per-skill tokens (rejected: too granular for the team to maintain).\n\n**Open questions.** Do we want a workspace-fallback for skills that don't need user identity (e.g., a public-Slack-read skill)?",
      },
    ],
    status: "draft",
    updatedAt: "5 days ago",
    totalInvocations: 4,
    recentRuns: [
      {
        id: "r-1",
        invokedBy: "Sam Wang",
        invokedAt: "5 days ago",
        durationMs: 6720,
        status: "success",
        summary: "Drafted ADR-014 on workspace_id scoping.",
      },
    ],
  },
  {
    slug: "voice-memo-to-note",
    name: "Voice memo to note",
    description:
      "Transcribes voice memos and routes the content into the right knowledge base.",
    whenToUse:
      "User uploads a voice memo or audio file, or asks to 'capture this'.",
    whenNotToUse:
      "Real-time transcription — this is async, for memos you're filing.",
    body: `Transcribe, then categorize, then file. Don't produce a verbatim transcript as the final artifact unless the user asks for it explicitly.

{section:Step 1 — Transcribe}

Drop the audio into {connector:google-drive} (Voice memos folder) for the archive copy. Generate a clean transcript — light punctuation, no filler words.

{section:Step 2 — Categorize}

Match the content to one of the workspace's KBs: {kb:networking-emails}, {kb:competitor-intel}, {kb:product-specs}, or {kb:customer-feedback}. If multiple, pick the dominant one and flag the rest as cross-references.

{section:Step 3 — File}

Write a 2–4 sentence summary of the memo. Surface any decisions, action items, or quotes worth capturing as their own entries. Add the result to the target KB's pending intake — don't auto-incorporate.`,
    knowledgeSources: [
      "networking-emails",
      "competitor-intel",
      "product-specs",
      "customer-feedback",
    ],
    connectors: [
      {
        provider: "google-drive",
        name: "Google Drive",
        status: "connected",
        meta: "Voice memos folder",
        usedFor: "Archive raw audio + linked transcript",
      },
    ],
    examples: [
      {
        id: "ex-1",
        title: "Customer call → feedback KB",
        input: "Capture this — 30-min call with Liane from Acme.",
        output:
          'Routed to {kb:customer-feedback}. Summary: 30-min call with Liane (Acme PM). Key quote at 14:20 about workflow integration: "feels like Notion if it was actually fast". Action item flagged for the workspace-sharing role granularity theme. Filed to pending intake — incorporate after review.',
      },
    ],
    status: "active",
    updatedAt: "1 week ago",
    totalInvocations: 9,
    recentRuns: [
      {
        id: "r-1",
        invokedBy: "Sam Wang",
        invokedAt: "Yesterday",
        durationMs: 8420,
        status: "success",
        summary: "Routed Sept conf takeaways memo to networking-emails KB.",
      },
      {
        id: "r-2",
        invokedBy: "Sam Wang",
        invokedAt: "3 days ago",
        durationMs: 9810,
        status: "success",
        summary: "Filed customer call to customer-feedback pending intake.",
      },
    ],
  },
];

export function findSkill(slug: string): Skill | null {
  return HARDCODED_SKILLS.find((s) => s.slug === slug) ?? null;
}

export type { SourceProvider };
