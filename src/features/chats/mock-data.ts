import type { Conversation, ConversationFolder } from "./types";

/**
 * Hard-coded fixtures for the conversations UI mockup. Delete when the
 * archive backend lands and the view reads real data.
 */

export const MOCK_FOLDERS: ConversationFolder[] = [
  { id: "f-dopl", name: "Dopl" },
  { id: "f-consulting", name: "Consulting" },
  { id: "f-research", name: "Research" },
];

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "c-archive",
    folderId: "f-dopl",
    title: "Chat archive — scoping the conversations feature",
    pinned: true,
    source: "claude-code",
    project: "setup-intelligence-engine",
    format: "mixed",
    sessionDate: "2026-07-07",
    exportedAt: "2026-07-07T18:40:00Z",
    overview:
      "Scoped the new conversation archive: audited what the gutted chat feature left behind, decided to drop and rebuild the tables, and agreed the MCP export / retrieval feature set.",
    deliverables: [
      { label: "Audited leftover chat tables and code references", done: true },
      { label: "Confirmed drop_chat_feature migration was never applied", done: true },
      { label: "Agreed feature set: folders, session header, per-message summaries", done: true },
      { label: "UI mockup with skeleton code structure", done: false },
    ],
    learnings: [
      "The drop_chat_feature migration exists in the repo but its version sorts before already-applied migrations — needs a renumber before it can push.",
      "The old conversations table was canvas-panel-scoped with a single jsonb messages blob; the new schema should store messages as rows.",
      "Learnings should eventually become first-class objects that link back to their source conversation.",
    ],
    messages: [
      {
        index: 1,
        role: "user",
        summary:
          "Asked for a review of the old chat feature's database leftovers and described the new archive concept: agent-exported conversations, folders, static UI, session header, and an instruction file for export etiquette.",
      },
      {
        index: 2,
        role: "agent",
        summary:
          "Surveyed the live database: conversations and chat_attachments tables still exist with two junk rows, both expired in May. The drop migration was written but never applied.",
      },
      {
        index: 3,
        role: "agent",
        summary:
          "Recommended dropping rather than rewiring — the old schema is panel-tied with forced expiry and a jsonb message blob, wrong shape for an archive.",
      },
      {
        index: 4,
        role: "user",
        summary:
          "Asked for suggestions to strengthen the feature before building.",
        verbatim:
          "confirm you understand what im describing, and give me suggestions how i could make this feature even better potentially",
      },
      {
        index: 5,
        role: "agent",
        summary:
          "Proposed: per-message rows over jsonb, structured header columns enforced by the export tool schema, idempotent upsert by session id, embedding summaries into the existing search infra, a context-pack retrieval op, conversation threading, and promoting learnings to first-class objects.",
      },
      {
        index: 6,
        role: "user",
        summary:
          "Liked learnings-as-objects but deferred it; requested a UI mockup with hardcoded content on the global design system first.",
      },
    ],
  },
  {
    id: "c-members",
    folderId: "f-dopl",
    title: "Members page redesign on the design system",
    pinned: false,
    source: "claude-code",
    project: "setup-intelligence-engine",
    format: "summarized",
    sessionDate: "2026-07-07",
    exportedAt: "2026-07-07T09:15:00Z",
    overview:
      "Rebuilt the members page on the global token layer: deleted the hero, moved to page-float with concave tabs, and neutralized the rainbow role colors.",
    deliverables: [
      { label: "Hero removed; page-float shell with concave tab switcher", done: true },
      { label: "Role and scope rank re-expressed as gray tiers", done: true },
      { label: "Status dots wired to success/warning/danger tokens", done: true },
    ],
    learnings: [
      "Team hex colors are user data and stay; identity color belongs to teams, never to roles.",
      "Effective access must stay server-resolved — no client-side mirror of the access matrix.",
    ],
    messages: [
      {
        index: 1,
        role: "user",
        summary:
          "Asked to bring the members page onto the design system and kill the improvised styling.",
      },
      {
        index: 2,
        role: "agent",
        summary:
          "Replaced the hero with the compact header-bar pattern, composed concave-track tabs, and mapped role rank to gray tiers instead of colors.",
      },
      {
        index: 3,
        role: "user",
        summary:
          "Approved the direction; flagged that team colors should survive since they're user-chosen data.",
      },
      {
        index: 4,
        role: "agent",
        summary:
          "Kept team hex colors, finished the token sweep, and promoted Popover, Avatar, and useApiGet into the shared kit.",
      },
    ],
  },
  {
    id: "c-oauth",
    folderId: "f-dopl",
    title: "MCP OAuth refresh-token rotation bug",
    pinned: false,
    source: "claude-code",
    project: "setup-intelligence-engine",
    format: "mixed",
    sessionDate: "2026-06-08",
    exportedAt: "2026-06-08T22:05:00Z",
    overview:
      "Chased intermittent 401s on long-lived MCP connections down to refresh-token rotation: reused refresh tokens weren't being detected as family replays.",
    deliverables: [
      { label: "Root cause isolated to token-family replay detection", done: true },
      { label: "mcp_token_family migration shipped", done: true },
      { label: "Regression steps documented for the OAuth flow", done: true },
    ],
    learnings: [
      "Refresh tokens must be tracked as a family: reuse of a rotated-out token should revoke the whole family, not 401 a single request.",
      "Client retry storms after one 401 were masking the true failure order in the logs.",
    ],
    messages: [
      {
        index: 1,
        role: "user",
        summary:
          "Reported agents losing MCP auth after roughly a day, with reconnects fixing it temporarily.",
      },
      {
        index: 2,
        role: "agent",
        summary:
          "Traced rate_limit_events and mcp_tokens: rotation issued new refresh tokens but old ones stayed valid, so parallel clients raced each other.",
        verbatim:
          'POST /api/mcp 401 {"error":"invalid_grant","description":"refresh token already used"}',
      },
      {
        index: 3,
        role: "agent",
        summary:
          "Implemented family-id tracking on mcp_tokens so replay of a rotated token revokes the family and forces one clean re-auth.",
      },
      {
        index: 4,
        role: "user",
        summary:
          "Confirmed the fix held across two days of connections; asked for the regression steps to be written down.",
      },
    ],
  },
  {
    id: "c-outreach",
    folderId: "f-consulting",
    title: "Vanta ops-lead outreach draft",
    pinned: false,
    source: "claude-desktop",
    project: null,
    format: "summarized",
    sessionDate: "2026-06-24",
    exportedAt: "2026-06-24T16:30:00Z",
    overview:
      "Identified the likely executive sponsor behind a Vanta ops posting and drafted a first-touch email in Samuel's voice.",
    deliverables: [
      { label: "Sponsor identified: VP Ops (posting owner, not recruiter)", done: true },
      { label: "First-touch email drafted and tightened to six sentences", done: true },
      { label: "Follow-up cadence sketched (day 4, day 9)", done: false },
    ],
    learnings: [
      "JD language about 'building the function from scratch' signals the hire reports to the sponsor directly — pitch the sponsor, not HR.",
    ],
    messages: [
      {
        index: 1,
        role: "user",
        summary:
          "Shared the LinkedIn posting and asked who to email and for a draft.",
      },
      {
        index: 2,
        role: "agent",
        summary:
          "Filtered by location and JD signals to the VP Ops as the likely commissioner; drafted a pitch anchored on the listing-to-contract conversion angle.",
      },
      {
        index: 3,
        role: "user",
        summary: "Asked for a shorter draft with a colder open.",
      },
      {
        index: 4,
        role: "agent",
        summary:
          "Cut the draft to six sentences, moved the proof point to sentence two, and ended on a single low-friction ask.",
      },
    ],
  },
  {
    id: "c-polymarket",
    folderId: "f-research",
    title: "Polymarket bot stack survey",
    pinned: false,
    source: "claude-desktop",
    project: null,
    format: "summarized",
    sessionDate: "2026-05-20",
    exportedAt: "2026-05-20T13:20:00Z",
    overview:
      "Surveyed the tooling needed for an automated Polymarket trading bot: CLOB API access, async Python, and VPS deployment.",
    deliverables: [
      { label: "Stack chosen: async Python + py-clob-client on a VPS", done: true },
      { label: "Strategy candidate: auto-buy 'No' on standalone yes/no markets", done: true },
    ],
    learnings: [
      "CLOB API keys derive from the wallet signature — key management is wallet custody, not a dashboard credential.",
    ],
    messages: [
      {
        index: 1,
        role: "user",
        summary: "Asked what a minimal Polymarket bot actually requires end to end.",
      },
      {
        index: 2,
        role: "agent",
        summary:
          "Mapped the stack: wallet + USDC on Polygon, py-clob-client for orders, websockets for fills, and a supervisor loop on a cheap VPS.",
      },
      {
        index: 3,
        role: "agent",
        summary:
          "Flagged the 'No'-side structural edge on standalone markets and the resolution-risk caveats that come with holding to settlement.",
      },
    ],
  },
  {
    id: "c-granola",
    folderId: null,
    title: "Granola → Notion meeting sync idea",
    pinned: false,
    source: "claude-desktop",
    project: null,
    format: "summarized",
    sessionDate: "2026-07-01",
    exportedAt: "2026-07-01T20:10:00Z",
    overview:
      "Kicked around piping Granola meeting notes into Notion automatically; parked it pending a real need.",
    deliverables: [
      { label: "Sketched trigger: poll Granola folders, upsert Notion pages", done: true },
      { label: "Decision: parked until meetings volume justifies it", done: true },
    ],
    learnings: [
      "Granola's folder list is the stable anchor for incremental sync — transcripts are fetched per meeting id.",
    ],
    messages: [
      {
        index: 1,
        role: "user",
        summary: "Floated auto-syncing Granola meeting summaries into a Notion database.",
      },
      {
        index: 2,
        role: "agent",
        summary:
          "Outlined a poll-and-upsert design keyed on meeting ids, then questioned whether current meeting volume justifies the moving parts.",
      },
      {
        index: 3,
        role: "user",
        summary: "Agreed to park it; asked to keep the sketch findable for later.",
      },
    ],
  },
];
