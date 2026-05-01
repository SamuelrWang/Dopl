/**
 * Hardcoded knowledge-base data — Phase 1 UI iteration only. No DB
 * backing yet. Same list is consumed by the sidebar dropdown and the
 * `/[workspaceSlug]/knowledge` pages so they stay in sync visually.
 *
 * Replace with a Supabase-backed `knowledge_bases` table + service when
 * the backend slice lands.
 */

export type KnowledgeEntryType = "note" | "doc" | "transcript" | "imported";

export interface KnowledgeEntry {
  id: string;
  title: string;
  excerpt: string;
  type: KnowledgeEntryType;
  updatedAt: string;
}

export interface PendingItem {
  id: string;
  title: string;
  source: string;
  preview: string;
}

export type SourceProvider =
  | "slack"
  | "google-drive"
  | "gmail"
  | "notion"
  | "github";

export interface SourceConnection {
  provider: SourceProvider;
  name: string;
  status: "connected" | "available";
  meta?: string;
}

export interface KnowledgeBase {
  slug: string;
  name: string;
  description: string;
  updatedAt: string;
  entries: KnowledgeEntry[];
  pending: PendingItem[];
  sources: SourceConnection[];
}

export const HARDCODED_KBS: ReadonlyArray<KnowledgeBase> = [
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
        type: "note",
        updatedAt: "2h ago",
      },
      {
        id: "ne-2",
        title: "Warm follow-up after an intro",
        excerpt:
          "Keep it under four lines. One concrete ask. Quote the introducer's exact phrasing back.",
        type: "note",
        updatedAt: "1d ago",
      },
      {
        id: "ne-3",
        title: "Subject lines that get opened",
        excerpt:
          "Specific beats clever. Include a date, a number, or a name they already recognize.",
        type: "note",
        updatedAt: "3d ago",
      },
      {
        id: "ne-4",
        title: "Openers to avoid",
        excerpt:
          '"I hope this finds you well." "I came across your profile." "I know you\'re busy."',
        type: "note",
        updatedAt: "5d ago",
      },
      {
        id: "ne-5",
        title: "Re-engagement after 6 months",
        excerpt:
          "Reference the last conversation specifically. Don't reset the relationship — pick up where it left off.",
        type: "doc",
        updatedAt: "1w ago",
      },
      {
        id: "ne-6",
        title: "Voice memo: Sept conf takeaways",
        excerpt:
          "Three patterns from successful intros at the conference last month, transcribed.",
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
        type: "doc",
        updatedAt: "1d ago",
      },
      {
        id: "ci-2",
        title: "Positioning teardown — Acme",
        excerpt:
          "They've pivoted from 'fastest' to 'most accurate' in copy. Marketing site refresh shipped 9/12.",
        type: "note",
        updatedAt: "4d ago",
      },
      {
        id: "ci-3",
        title: "Feature gap: realtime sync",
        excerpt:
          "Two competitors shipped CRDT-backed realtime in Q3. We're a quarter behind.",
        type: "note",
        updatedAt: "6d ago",
      },
      {
        id: "ci-4",
        title: "Screenshots — onboarding flows",
        excerpt: "Side-by-side of the three onboarding flows we benchmarked against.",
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
        type: "doc",
        updatedAt: "5d ago",
      },
      {
        id: "ps-2",
        title: "ADR-014: chose workspace_id over user_id scoping",
        excerpt:
          "Decision record for moving cluster scoping from per-user to per-workspace.",
        type: "doc",
        updatedAt: "1w ago",
      },
      {
        id: "ps-3",
        title: "Design notes: bento layout for KBs",
        excerpt:
          "Why we went with bento over a sidebar+main split for knowledge bases.",
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
        type: "doc",
        updatedAt: "3d ago",
      },
      {
        id: "cf-2",
        title: "Quote: 'feels like Notion if it was actually fast'",
        excerpt:
          "From a Pro-tier customer interview 9/22. Indicates the speed positioning is landing.",
        type: "note",
        updatedAt: "1w ago",
      },
      {
        id: "cf-3",
        title: "Support ticket cluster — onboarding confusion",
        excerpt:
          "12 tickets in two weeks all asking the same first-canvas question. UI fix needed.",
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

export function findKnowledgeBase(slug: string): KnowledgeBase | null {
  return HARDCODED_KBS.find((kb) => kb.slug === slug) ?? null;
}
