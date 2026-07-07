import "server-only";
import type { SkillConnector, SkillStatus } from "../types";

/**
 * Seed fixtures inserted by `seedWorkspace` when a brand-new workspace
 * lists skills for the first time within 24h of creation. Bodies use
 * the canonical `[label](dopl://kb/<slug>)` and
 * `[label](dopl://connector/<provider>[.<field>])` syntax that
 * `parseSkillBody` understands.
 *
 * Mirrors the legacy hardcoded data shape from the deleted `data.ts`.
 * The KB slugs referenced here (networking-emails, competitor-intel,
 * customer-feedback, product-specs) are populated by the knowledge
 * feature's own seed run; broken refs are fine — the chip resolver
 * surfaces them as `available: false` without blocking renders.
 */

export interface SkillSeed {
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string;
  body: string;
  connectors: SkillConnector[];
  status: SkillStatus;
}

export function buildSeedSkills(): SkillSeed[] {
  return [
    {
      slug: "outbound-email-drafting",
      name: "Outbound email drafting",
      description:
        "Drafts cold and follow-up outreach in your existing tone, using prior threads as context.",
      whenToUse:
        'User asks to draft a cold email, write a follow-up, or describes outreach intent (e.g. "send Anya something about the report").',
      whenNotToUse:
        "Internal team comms, replies to existing inbound threads, or anything explicitly transactional (invoices, password resets).",
      body: `Read the user's voice from [Networking emails](dopl://kb/networking-emails) before drafting. Three patterns matter: openers, asks, and sign-offs.

## Step 1 — Establish context

If the user mentions a prior thread or relationship, search [Gmail threads](dopl://connector/gmail.threads) for the most recent message between them and quote one specific phrase from it verbatim in the new draft. If no thread exists, treat this as a cold open.

## Step 2 — Draft

Match the tone in [Networking emails](dopl://kb/networking-emails). Aim for under four sentences. Lead with the specific reason this person matters, not a generic compliment. One concrete ask. Don't apologize for the cold contact.

## Step 3 — Sign off

Sign with the user's first name only. Add a CTA only if explicitly asked. Never use "I hope this finds you well", "I came across your profile", or "I know you're busy" — those are the openers in the [Networking emails](dopl://kb/networking-emails) avoid-list.

## Output

Return the draft as a single message. If the user asked for a subject line, prepend it on its own line. Don't include placeholders like [Name] — fill them in or ask the user.`,
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
      status: "active",
    },
    {
      slug: "competitor-research-synthesis",
      name: "Competitor research synthesis",
      description:
        "Pulls competitor signal from Slack and Drive, writes a one-pager you can share.",
      whenToUse:
        "User asks for a competitor recap, wants a positioning teardown, or pastes a competitor URL.",
      whenNotToUse:
        "User wants the raw research data — point them at the [Competitor intel](dopl://kb/competitor-intel) entries directly instead.",
      body: `Treat [Competitor intel](dopl://kb/competitor-intel) as the source of truth for prior research. Don't restate; build on it.

## Step 1 — Pull recent signal

Search [Slack](dopl://connector/slack) (#compete channel) for messages tagged in the last 30 days. Pull file references from [Drive](dopl://connector/google-drive) (Competitor folder) modified in the same window. De-dup against entries already in [Competitor intel](dopl://kb/competitor-intel).

## Step 2 — Synthesize

Group findings by: pricing changes, positioning shifts, feature ships, hiring signals. One paragraph per group, max. If a group has nothing new, omit it — don't pad.

## Step 3 — Write the one-pager

Use the same structure as the existing recaps in [Competitor intel](dopl://kb/competitor-intel). Lead with the most disruptive finding. Close with two specific implications for our roadmap. Cite source links inline.`,
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
      status: "active",
    },
    {
      slug: "customer-feedback-rollup",
      name: "Customer feedback rollup",
      description:
        "Reads support tickets, Slack DMs, and call transcripts; writes a weekly themes digest.",
      whenToUse:
        "User asks for a feedback summary, a weekly digest, or 'what are people saying'.",
      whenNotToUse:
        "Single-customer questions — pull the specific ticket from [Customer feedback](dopl://kb/customer-feedback) instead of summarizing.",
      body: `Anchor on [Customer feedback](dopl://kb/customer-feedback). The themes already extracted there are the categories; new feedback gets routed into them.

## Step 1 — Gather

Pull the last 7 days from [Slack](dopl://connector/slack) (#customer-feedback) and [Gmail](dopl://connector/gmail) (support@ inbox). Include voice memos referenced in the [Customer feedback](dopl://kb/customer-feedback) pending intake.

## Step 2 — Bucket

For each new piece of feedback, assign it to one of the existing themes in [Customer feedback](dopl://kb/customer-feedback). If it doesn't fit, create a candidate new theme and flag it.

## Step 3 — Output

Write a digest with: top 3 themes by volume, one quote per theme, count, and trend vs prior week. Surface any new theme candidates at the bottom for review.`,
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
      status: "active",
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
      body: `Use [Product specs](dopl://kb/product-specs) for the house template and tone. Match the existing doc structure exactly — don't invent new sections.

## Step 1 — Identify the doc type

Ask the user once: PRD, ADR, or design note. If unclear, default to ADR for a single technical decision and PRD for anything broader. Each has a different template in [Product specs](dopl://kb/product-specs).

## Step 2 — Pull priors

Search [Notion](dopl://connector/notion) (Engineering DB) and [GitHub](dopl://connector/github) (ADRs folder) for related prior docs. Link them at the top under "Related" — don't summarize them, just link.

## Step 3 — Draft

Follow the section order from [Product specs](dopl://kb/product-specs). For ADRs: Context, Decision, Consequences, Alternatives considered. For PRDs: Problem, Users, Solution, Non-goals, Open questions. Don't add extras.

## Step 4 — Open questions

End every doc with at least one explicit open question. The team expects them. If you can't think of one, the doc isn't ready.`,
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
      status: "draft",
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

## Step 1 — Transcribe

Drop the audio into [Drive](dopl://connector/google-drive) (Voice memos folder) for the archive copy. Generate a clean transcript — light punctuation, no filler words.

## Step 2 — Categorize

Match the content to one of the workspace's KBs: [Networking emails](dopl://kb/networking-emails), [Competitor intel](dopl://kb/competitor-intel), [Product specs](dopl://kb/product-specs), or [Customer feedback](dopl://kb/customer-feedback). If multiple, pick the dominant one and flag the rest as cross-references.

## Step 3 — File

Write a 2–4 sentence summary of the memo. Surface any decisions, action items, or quotes worth capturing as their own entries. Add the result to the target KB's pending intake — don't auto-incorporate.`,
      connectors: [
        {
          provider: "google-drive",
          name: "Google Drive",
          status: "connected",
          meta: "Voice memos folder",
          usedFor: "Archive raw audio + linked transcript",
        },
      ],
      status: "active",
    },
  ];
}
