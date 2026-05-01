/**
 * Seed fixture data — the canonical knowledge-base content used to
 * populate brand-new workspaces (and the original Phase-1 UI mocks
 * before Item 3 wired the real DB-backed UI).
 *
 * Item 5.A.4 moved this file from `src/features/knowledge/data.ts` to
 * its current location, dropped the now-unused `SourceProvider` /
 * `SourceConnection` types (those moved to `../source-types.ts`), and
 * removed the `findKnowledgeBase` lookup helper (no consumers — the
 * UI uses `service.getBaseBySlug` and skills uses a stub).
 *
 * The legacy `KnowledgeBase` shape here (with embedded `entries`,
 * `pending`, `sources` arrays) is purely the seed-input shape — it
 * differs from the live domain `KnowledgeBase` in `../types.ts`. The
 * adapter at `./seed-fixtures.ts` reshapes this into the seed inputs
 * the service consumes.
 */

// Audit fix #19 (partial): no `import "server-only"`. This file is
// pure data — string literals + types — with no server APIs, no env
// access, no secrets. The directive forced
// scripts/smoke-knowledge-md-roundtrip.ts to run with
// NODE_OPTIONS='--conditions=react-server' even though the script is
// pure-Node. Removing the directive matches ENGINEERING.md §10:
// "Shared code (types, pure utilities) has no directive."

export type LegacyKnowledgeEntryType =
  | "note"
  | "doc"
  | "transcript"
  | "imported";

export interface LegacyKnowledgeEntry {
  id: string;
  title: string;
  excerpt: string;
  body: string;
  type: LegacyKnowledgeEntryType;
  updatedAt: string;
}

interface LegacyPendingItem {
  id: string;
  title: string;
  source: string;
  preview: string;
}

interface LegacySourceConnection {
  provider: string;
  name: string;
  status: "connected" | "available";
  meta?: string;
}

export interface LegacyKnowledgeBase {
  slug: string;
  name: string;
  description: string;
  updatedAt: string;
  entries: LegacyKnowledgeEntry[];
  pending: LegacyPendingItem[];
  sources: LegacySourceConnection[];
}

export const HARDCODED_KBS: ReadonlyArray<LegacyKnowledgeBase> = [
  {
    slug: "networking-emails",
    name: "Networking emails",
    description: "Patterns, templates, and tone for cold and warm outreach.",
    updatedAt: "2 hours ago",
    entries: [
      {
        id: "ne-1",
        title: "Cold open template — founder intros",
        excerpt:
          "Lead with the specific reason this person matters, not what you want. One sentence on why now.",
        body: `The cold open is a single specific reason this person matters. Lead with that, not with what you want.

## Structure

1. **Open** — one sentence on why now
2. **Specific** — name a thing they shipped, said, or did
3. **Ask** — one CTA, easy to say yes to
4. **Sign-off** — first name only, no title

## Patterns that work

| Opener | Why it works |
| --- | --- |
| "Your post on X" | Recent, specific, flatters by attention |
| "Ankur said to reach out" | Warm by reference even when otherwise cold |
| "I noticed you ship every Friday" | Pattern recognition reads as genuine care |
| "We almost worked together at Y" | Establishes shared context fast |

## Avoid

- "I hope this finds you well"
- "I came across your profile"
- "I know you're busy"
- Anything that opens with "I"

## Example

> Hi Anya — your Vector launch last month was the cleanest thing I've seen ship in this space all year. The 12k signups in 48h thread is making the rounds here. I'm working on something adjacent and would love 20 minutes to compare notes. Worth half a coffee Thursday?
>
> — Sam

Notice: opens with *them* (their launch), references something specific (the 48h thread), asks for something easy (20 minutes, suggested time), signs off short.`,
        type: "note",
        updatedAt: "2h ago",
      },
      {
        id: "ne-2",
        title: "Warm follow-up after an intro",
        excerpt:
          "Keep it under four lines. One concrete ask. Quote the introducer's exact phrasing back.",
        body: `When someone introduces you, **the introducer is the most important reader of the first email**, not the introducee. Your reply tells them whether the intro was worth making.

## Rules

- Under four lines
- One concrete ask
- Quote the introducer's exact phrasing back to them
- Drop the introducer to BCC (or omit if the etiquette norm in your circle is BCC after first message)

## Why quote the introducer

It signals you read what they said, you took it seriously, and it gives the introducee a hook into why they were introduced.

> Marcus said to "get on the phone with this one" so I want to make that easy. Tuesday or Thursday after 2pm Pacific?

## Anti-pattern

Don't restate the introduction. The introducee was on the same email — they read it.`,
        type: "note",
        updatedAt: "1d ago",
      },
      {
        id: "ne-3",
        title: "Subject lines that get opened",
        excerpt:
          "Specific beats clever. Include a date, a number, or a name they already recognize.",
        body: `Specific beats clever. The goal of the subject line is to **survive the inbox glance** — that's it.

## Three things that consistently lift open rates

1. **A name they already recognize** — a mutual, an introducer, a company they've heard of
2. **A specific number** — "$49 → $79", "12 minutes", "2026 Q3"
3. **A date** — "Thursday", "Sept 12", "this week"

## Examples

| Bad | Better |
| --- | --- |
| "Quick question" | "Question about your Vector launch" |
| "Following up" | "Following up on Tuesday's call" |
| "Hello!" | "Marcus said to reach out" |
| "Touching base" | "Sept 12 update on the redesign" |

## Length

Under 50 characters. Mobile clients truncate at ~40. Front-load the recognizable element.`,
        type: "note",
        updatedAt: "3d ago",
      },
      {
        id: "ne-4",
        title: "Openers to avoid",
        excerpt:
          '"I hope this finds you well." "I came across your profile." "I know you\'re busy."',
        body: `These signal you wrote the email from a template, not from the actual circumstance.

- "I hope this finds you well"
- "I came across your profile"
- "I know you're busy"
- "Reaching out because…"
- "I wanted to introduce myself"
- "Hope you're having a great week"

## Why they fail

They're **inbox noise**. They communicate nothing about why this email and not any other email. The first 15 words of an email are the most expensive real estate you have — don't spend them on filler.

## Replace with

A specific, recent, concrete sentence about *them*. If you can't write one, you don't know enough about them yet to send the email.`,
        type: "note",
        updatedAt: "5d ago",
      },
      {
        id: "ne-5",
        title: "Re-engagement after 6 months",
        excerpt:
          "Reference the last conversation specifically. Don't reset the relationship — pick up where it left off.",
        body: `**Don't reset the relationship.** Pick up where it left off.

## Structure

1. Reference the last conversation specifically — date or topic
2. Note what changed on your side that's relevant to them
3. Make the ask easy

## Example

> Hi Diego — in April you said to circle back in Q4 once we shipped the team-sharing flow. Well, here we are. The "send me a real demo" you asked for is finally a real demo.
>
> Thirty minutes when you have time?
>
> — Sam

## Why this works

Diego already invested attention in April. The re-engagement honors that attention and converts it. Treat the relationship as a continuous thread, not a fresh cold open.`,
        type: "doc",
        updatedAt: "1w ago",
      },
      {
        id: "ne-6",
        title: "Voice memo: Sept conf takeaways",
        excerpt:
          "Three patterns from successful intros at the conference last month, transcribed.",
        body: `Three patterns I noticed from intros that converted at the conference last month:

## 1. Specificity before generality

The intros that landed always opened with a specific thing — a tweet, a launch, a quote — before zooming out to "and so I think we should talk." Generality first ("we're both in AI…") never worked.

## 2. Ask was always smaller than I'd guess

Nobody asked for "30 minutes to chat." The successful ones asked for **5 minutes for a yes/no on a single thing**, OR a slack DM, OR a referral to one person. Small asks landed.

## 3. Sign-off was a name, not a title

People who signed "Sam" had higher response rates than people who signed "Sam Wang, Co-Founder & CEO @ Dopl". The title triggered a different read of the email — "this is sales" — even when it wasn't.

---

*Original audio: 4:12. Filed in Voice memos folder.*`,
        type: "transcript",
        updatedAt: "2w ago",
      },
    ],
    pending: [
      {
        id: "ne-p1",
        title: "Voice memo from this morning",
        source: "Voice memo · 0:42",
        preview:
          "Note about the way Anya phrased her ask in our intro thread — keep this as a template…",
      },
      {
        id: "ne-p2",
        title: "Pasted from Notes",
        source: "Quick paste",
        preview:
          'Subject: "Following up on Tuesday" — opening should reference the specific moment from the call…',
      },
      {
        id: "ne-p3",
        title: "Email thread snippet",
        source: "Imported from Gmail",
        preview:
          "Reply from Diego on the warm-intro template, suggesting a tighter close that lands…",
      },
    ],
    sources: [
      {
        provider: "gmail",
        name: "Gmail",
        status: "connected",
        meta: "Sent · Networking label",
      },
      {
        provider: "slack",
        name: "Slack",
        status: "connected",
        meta: "#networking · DMs from intros",
      },
      {
        provider: "google-drive",
        name: "Google Drive",
        status: "connected",
        meta: "Networking templates folder",
      },
      { provider: "notion", name: "Notion", status: "available" },
      { provider: "github", name: "GitHub", status: "available" },
    ],
  },
  {
    slug: "competitor-intel",
    name: "Competitor intel",
    description: "Notes, screenshots, pricing, and positioning from competitors.",
    updatedAt: "1 day ago",
    entries: [
      {
        id: "ci-1",
        title: "Pricing page changes — Q3",
        excerpt:
          "Three competitors raised entry-tier pricing 18–25% between July and September.",
        body: `Three competitors raised entry-tier pricing between July and September.

## Changes

| Competitor | July | September | Δ |
| --- | --- | --- | --- |
| Acme | $49/mo | $59/mo | +20% |
| Vector | $39/mo | $49/mo | +25% |
| Helix | $29/mo | $35/mo | +21% |

## Implications

- The market has **pricing power** again after a long flat period
- Our $25/mo entry tier now sits ~30% under the market median
- Either we lift, or we lean into "most affordable" as a positioning lever

## Recommendation

Lift entry tier to $35/mo for new signups in Q4. Existing customers grandfathered for 12 months. Pair with a feature ship so the price increase has a story.`,
        type: "doc",
        updatedAt: "1d ago",
      },
      {
        id: "ci-2",
        title: "Positioning teardown — Acme",
        excerpt:
          "They've pivoted from 'fastest' to 'most accurate' in copy. Marketing site refresh shipped 9/12.",
        body: `Acme shipped a marketing site refresh on 9/12. The headline change matters more than the visual change.

## Before

> The fastest way to ship X.

## After

> The most accurate way to ship X.

## What this signals

- They no longer believe **speed** is a defensible position. Probably because two competitors caught up on perf.
- "Accuracy" implies a quality/correctness moat that's harder to copy in a quarter.
- They're moving upmarket. Expect enterprise-y collateral and a sales-led motion next.`,
        type: "note",
        updatedAt: "4d ago",
      },
      {
        id: "ci-3",
        title: "Feature gap: realtime sync",
        excerpt:
          "Two competitors shipped CRDT-backed realtime in Q3. We're a quarter behind.",
        body: `Two competitors shipped CRDT-backed realtime collaboration in Q3. We're a quarter behind on this surface.

## Status

- **Acme** — shipped 8/14, Yjs-based, observed in their docs
- **Vector** — shipped 9/3, custom CRDT, mentioned in launch thread
- **Us** — HTTP debounced sync, no plans on roadmap yet

## Why it matters

Realtime is no longer a differentiator we can lean on past Q1. Two competitors at parity means it shifts to **table stakes**.

## Options

1. Match by Q1 with Yjs
2. Skip realtime, double down on a different surface (mobile, batch ingest)
3. Acquire a CRDT-savvy team`,
        type: "note",
        updatedAt: "6d ago",
      },
      {
        id: "ci-4",
        title: "Screenshots — onboarding flows",
        excerpt: "Side-by-side of the three onboarding flows we benchmarked against.",
        body: `Side-by-side comparison of the three competitor onboarding flows we benchmarked against. Screenshots in the Drive folder.

## Step counts

| Competitor | Steps | First-canvas time |
| --- | --- | --- |
| Acme | 4 | ~90s |
| Vector | 3 | ~60s |
| Helix | 6 | ~3m |
| Us | 5 | ~2m |

Vector is the cleanest. Helix is the worst. We sit in the middle.`,
        type: "imported",
        updatedAt: "1w ago",
      },
    ],
    pending: [
      {
        id: "ci-p1",
        title: "Twitter thread on Vector launch",
        source: "Imported from X",
        preview:
          "Founder thread breaking down the launch metrics — 12k signups in 48h…",
      },
      {
        id: "ci-p2",
        title: "Pricing screenshot",
        source: "Quick paste",
        preview: "PNG attached: $49 → $79 / mo on the Pro tier as of October 1.",
      },
    ],
    sources: [
      {
        provider: "slack",
        name: "Slack",
        status: "connected",
        meta: "#compete channel",
      },
      {
        provider: "google-drive",
        name: "Google Drive",
        status: "connected",
        meta: "Competitor folder",
      },
      { provider: "gmail", name: "Gmail", status: "available" },
      { provider: "notion", name: "Notion", status: "available" },
      { provider: "github", name: "GitHub", status: "available" },
    ],
  },
  {
    slug: "product-specs",
    name: "Product specs",
    description: "PRDs, design decisions, and architectural rationale.",
    updatedAt: "5 days ago",
    entries: [
      {
        id: "ps-1",
        title: "PRD — Workspace overhaul",
        excerpt:
          "Splits the canvas concept into workspace + canvas. Membership-aware sharing.",
        body: `## Problem

The "canvas" concept conflates two things: the **shareable team unit** (where members + invitations live) and the **visual page** (where panels are arranged). Users see the same name everywhere and the data model couples them.

## Users

- Single users — currently fine, but future multi-canvas-per-workspace would require a redesign anyway
- Teams — the conflation makes it unclear who can see what
- Admins — billing and member management ride on the canvas table, which is awkward

## Solution

Split into two tables:

1. **\`workspaces\`** — team / share / billing container
2. **\`canvases\`** — page/view inside a workspace

Membership and invitations move to \`workspace_members\` and \`workspace_invitations\`.

## Non-goals

- Multi-canvas-per-workspace UX (one canvas per workspace for now)
- Per-canvas permissions (workspace-level only)
- Workspace switching across organizations

## Open questions

- Where do connector tokens live? (See ADR-021)
- Does the canvas page slug live in the URL or just internal? **Decision: in URL** — \`/{workspaceSlug}/{canvasSlug}\``,
        type: "doc",
        updatedAt: "5d ago",
      },
      {
        id: "ps-2",
        title: "ADR-014: workspace_id over user_id scoping",
        excerpt:
          "Decision record for moving cluster scoping from per-user to per-workspace.",
        body: `## Context

Pre-overhaul, every cluster row was scoped to \`user_id\`. With workspaces, multiple users can collaborate on the same set of clusters.

## Decision

Move all cluster-related tables to scope by \`workspace_id\` instead of \`user_id\`. Keep \`user_id\` on rows as the **creator** for audit, not for access control.

## Consequences

- All existing data needs migration (acceptable: pre-launch)
- RLS policies must JOIN through \`workspace_members\` instead of comparing \`user_id\`
- Realtime subscriptions filter by workspace, not user

## Alternatives considered

- **Per-user with sharing**: would require a separate \`shared_with\` table per cluster. Rejected — too many small tables.
- **Per-canvas (the visual one)**: would tie cluster lifecycle to canvas lifecycle. Rejected — clusters often outlive a specific canvas.

## Open questions

- How do we handle published clusters (community gallery)? They're cross-workspace by nature. **Resolution**: keep \`published_clusters\` user-scoped; clone semantics on fork.`,
        type: "doc",
        updatedAt: "1w ago",
      },
      {
        id: "ps-3",
        title: "Design notes: bento layout for KBs",
        excerpt:
          "Why we went with bento over a sidebar+main split for knowledge bases.",
        body: `Initial design used a bento layout for the KB detail page. **Switching to sidebar + doc split** based on user feedback.

## Why bento failed

- Knowledge entries felt like ornamental tiles, not real documents
- Adding/editing was awkward inside a small card
- Users immediately compared it to Notion and asked "why isn't it that"

## Why sidebar + doc wins

- Each entry reads like a real document, not a tile
- Tables, headings, lists all have room to breathe
- Familiar pattern (Notion, Confluence, Outline)
- Cleanly separates *navigation* (sidebar) from *content* (doc)`,
        type: "note",
        updatedAt: "2w ago",
      },
    ],
    pending: [
      {
        id: "ps-p1",
        title: "Engineering review meeting transcript",
        source: "Voice memo · 24:11",
        preview:
          "Review of the integrations layer architecture, with three open questions to resolve…",
      },
    ],
    sources: [
      {
        provider: "notion",
        name: "Notion",
        status: "connected",
        meta: "Engineering DB",
      },
      {
        provider: "github",
        name: "GitHub",
        status: "connected",
        meta: "ADRs · 14 docs",
      },
      { provider: "slack", name: "Slack", status: "available" },
      { provider: "gmail", name: "Gmail", status: "available" },
      { provider: "google-drive", name: "Google Drive", status: "available" },
    ],
  },
  {
    slug: "customer-feedback",
    name: "Customer feedback",
    description: "Quotes, support tickets, and call transcripts from users.",
    updatedAt: "3 days ago",
    entries: [
      {
        id: "cf-1",
        title: "Top 5 churn reasons — Q3",
        excerpt:
          "Aggregated from exit surveys: missing realtime, slow imports, no Notion sync.",
        body: `Aggregated from 47 exit surveys submitted in Q3.

| # | Reason | Mentions | Trend vs Q2 |
| --- | --- | --- | --- |
| 1 | Missing realtime collaboration | 18 | ↑ from 11 |
| 2 | Slow ingestion on large repos | 12 | ↑ from 8 |
| 3 | No Notion sync | 9 | ↑ from 4 |
| 4 | Pricing too high for solo users | 6 | ↓ from 9 |
| 5 | Confusing onboarding | 4 | ↓ from 7 |

## Notes

- **#1 and #2** correlate: users who care about realtime also tend to have large workspaces that strain ingestion.
- **#3** is new this quarter — three competitors shipped Notion sync in Q3, raising expectations.
- **#5** dropped — the welcome flow refresh in August is helping.

## Recommendation

Prioritize realtime by Q1. Notion sync is a fast follow.`,
        type: "doc",
        updatedAt: "3d ago",
      },
      {
        id: "cf-2",
        title: "Quote: 'feels like Notion if it was actually fast'",
        excerpt:
          "From a Pro-tier customer interview 9/22. Indicates the speed positioning is landing.",
        body: `> It feels like Notion if it was actually fast.

— Pro-tier customer, interview 9/22

## Why this matters

This is exactly the positioning we've been pushing for two quarters. **The customer is articulating it back to us unprompted.** That's the strongest signal that the message is landing.

## Use this quote

- Hero of the homepage refresh
- Sales decks (with attribution stripped or anonymized)
- Internal alignment — when someone asks "what are we building", this is the answer`,
        type: "note",
        updatedAt: "1w ago",
      },
      {
        id: "cf-3",
        title: "Support ticket cluster — onboarding confusion",
        excerpt:
          "12 tickets in two weeks all asking the same first-canvas question. UI fix needed.",
        body: `12 tickets in two weeks. **All variations of the same question**: "I just signed up, where do I start?"

## Pattern

Users land on /canvas (now /workspaceSlug/main), see an empty canvas, and don't know what to do next. The empty state has no instruction, no sample content, no CTA.

## Tickets

| ID | User | Day | Phrase used |
| --- | --- | --- | --- |
| #1042 | sam@... | 1 | "what is this" |
| #1051 | leo@... | 2 | "blank canvas" |
| #1063 | mira@... | 3 | "how do I get started" |
| #1070 | dani@... | 4 | "is something missing" |
| #1078 | … | … | … |

## Fix

- Empty-state CTA: "Add your first entry" with a paste-URL or upload-file flow
- Inline tutorial card on first canvas (dismissible)
- Welcome video: 30 seconds, no narration, just shows what the canvas does

## Owner

Onboarding squad. Target: ship by end of next sprint.`,
        type: "imported",
        updatedAt: "1w ago",
      },
    ],
    pending: [
      {
        id: "cf-p1",
        title: "Customer call transcript",
        source: "Voice memo · 32:04",
        preview:
          "30-min call with Liane from Acme. Key quote at 14:20 about workflow integration…",
      },
      {
        id: "cf-p2",
        title: "Slack DM thread",
        source: "Imported from Slack",
        preview:
          "Power-user feedback on the new sidebar layout, with three concrete suggestions…",
      },
    ],
    sources: [
      {
        provider: "slack",
        name: "Slack",
        status: "connected",
        meta: "#customer-feedback",
      },
      {
        provider: "gmail",
        name: "Gmail",
        status: "connected",
        meta: "support@ inbox",
      },
      { provider: "notion", name: "Notion", status: "available" },
      { provider: "google-drive", name: "Google Drive", status: "available" },
      { provider: "github", name: "GitHub", status: "available" },
    ],
  },
];

