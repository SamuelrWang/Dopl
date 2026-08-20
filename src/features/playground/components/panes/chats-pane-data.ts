import type {
  Chat,
  ChatDetail,
  ChatFolder,
} from "@/features/chats/types";
import { SOURCE_LABELS, UNFILED_LABEL } from "@/features/chats/constants";
import { formatDate, formatShortDate } from "@/shared/lib/format-time";

/**
 * Data layer for the playground chats pane: the static demo archive it rests
 * on before a session starts, plus the mappers that project REAL workspace
 * chats (polled via `usePlaygroundPoll` with the guest bearer) into the same
 * display shape, so the pane's JSX renders either source unchanged.
 *
 * Read endpoints (GET, workspace-scoped — see `src/app/api/chats/`):
 *   /api/chats            → { chats: Chat[]; hiddenCount: number }
 *   /api/chats/folders    → { folders: ChatFolder[] }
 *   /api/chats/[chatId]   → { chat: ChatDetail }  (transcript included)
 */

export interface ChatListDto {
  chats: Chat[];
  hiddenCount: number;
}

export interface ChatFoldersDto {
  folders: ChatFolder[];
}

export interface ChatDetailDto {
  chat: ChatDetail;
}

export type PaneFilter = "all" | "private" | "team" | "workspace";

export const PANE_FILTERS: ReadonlyArray<{ key: PaneFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "private", label: "Private" },
  { key: "team", label: "Team" },
  { key: "workspace", label: "Public" },
];

export interface PaneMessage {
  role: "user" | "agent";
  summary: string;
  verbatim?: string;
}

/** Display-model chat — pre-formatted strings so the JSX stays dumb. */
export interface PaneChat {
  id: string;
  title: string;
  overview: string;
  shortDate: string;
  fullDate: string;
  source: string;
  format: string;
  pinned: boolean;
  isPublic: boolean;
  folderName: string | null;
  deliverablesDone: number;
  deliverablesTotal: number;
  learnings: number;
  messageCount: number;
  /** "you" in the demo, the owner's real name on live data. */
  sharedBy: string;
  ownerUserId: string;
  ownerName: string;
  ownerAvatarUrl: string | null;
  /** Null while the live transcript is still loading. */
  messages: PaneMessage[] | null;
}

export interface PaneGroup {
  name: string;
  isPublic: boolean;
  chats: PaneChat[];
}

/* ── Live mapping ─────────────────────────────────────────────────────── */

function matchesFilter(chat: Chat, filter: PaneFilter): boolean {
  if (filter === "all") return true;
  if (filter === "private") return chat.visibility === "private";
  if (filter === "team")
    return chat.visibility === "public" && chat.accessMode === "teams";
  return chat.visibility === "public" && chat.accessMode === "workspace";
}

function toPaneChat(chat: Chat, folderName: string | null): PaneChat {
  return {
    id: chat.id,
    title: chat.title,
    overview: chat.overview,
    shortDate: formatShortDate(chat.sessionDate),
    fullDate: formatDate(chat.sessionDate),
    source: SOURCE_LABELS[chat.source] ?? SOURCE_LABELS.other,
    format: chat.format,
    pinned: chat.pinned,
    isPublic: chat.visibility === "public",
    folderName,
    deliverablesDone: chat.deliverables.filter((d) => d.done).length,
    deliverablesTotal: chat.deliverables.length,
    learnings: chat.learnings.length,
    messageCount: chat.messageCount,
    sharedBy: chat.owner.name,
    ownerUserId: chat.owner.userId,
    ownerName: chat.owner.name,
    ownerAvatarUrl: chat.owner.avatarUrl,
    messages: null,
  };
}

/** Folder groups in server order (pinned chats first inside each), Unfiled
 *  last — mirroring the desktop list pane's grouping. */
export function buildLiveGroups(
  chats: Chat[],
  folders: ChatFolder[],
  filter: PaneFilter,
  query: string
): PaneGroup[] {
  const q = query.trim().toLowerCase();
  const visible = chats.filter(
    (c) =>
      matchesFilter(c, filter) && (q === "" || c.title.toLowerCase().includes(q))
  );
  const sort = (list: Chat[]) =>
    [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  const groups: PaneGroup[] = folders.map((folder) => ({
    name: folder.name,
    isPublic: folder.visibility === "public",
    chats: sort(visible.filter((c) => c.folderId === folder.id)).map((c) =>
      toPaneChat(c, folder.name)
    ),
  }));
  const folderIds = new Set(folders.map((f) => f.id));
  const unfiled = sort(
    visible.filter((c) => c.folderId === null || !folderIds.has(c.folderId))
  );
  groups.push({
    name: UNFILED_LABEL,
    isPublic: false,
    chats: unfiled.map((c) => toPaneChat(c, null)),
  });
  return groups.filter((g) => g.chats.length > 0);
}

/** Unfiltered projection for the SELECTED chat — selection survives a query
 *  or scope filter that hides its row, matching the demo behavior. */
export function paneChatFor(chat: Chat, folders: ChatFolder[]): PaneChat {
  const folder = folders.find((f) => f.id === chat.folderId);
  return toPaneChat(chat, folder?.name ?? null);
}

export function toPaneMessages(detail: ChatDetail): PaneMessage[] {
  return detail.messages.map((m) => ({
    role: m.role,
    summary: m.summary,
    verbatim: m.verbatim ?? undefined,
  }));
}

/* ── Static demo archive (pre-session fallback) ───────────────────────── */

const demo = (
  chat: Omit<
    PaneChat,
    | "sharedBy"
    | "ownerUserId"
    | "ownerName"
    | "ownerAvatarUrl"
    | "messageCount"
    | "deliverablesDone"
  > & { deliverablesTotal: number; messages: PaneMessage[] }
): PaneChat => ({
  ...chat,
  deliverablesDone: chat.deliverablesTotal,
  messageCount: chat.messages.length,
  sharedBy: "you",
  ownerUserId: "demo-owner",
  ownerName: "Sam",
  ownerAvatarUrl: null,
});

export const DEMO_CHATS: PaneChat[] = [
  demo({
    id: "seed",
    title: "Getting started with Dopl",
    overview:
      "A first session on a new Dopl workspace: how to orient with dopl_map, where different kinds of memory belong, and how to leave a trail. A worked example of a clean export.",
    shortDate: "Aug 12",
    fullDate: "Aug 12, 2026",
    source: "Claude Code",
    format: "summarized",
    pinned: true,
    isPublic: true,
    folderName: "Onboarding",
    deliverablesTotal: 2,
    learnings: 1,
    messages: [
      {
        role: "user",
        summary:
          "Asked how to get started on the new Dopl workspace and what the agent should do first.",
      },
      {
        role: "agent",
        summary:
          "Explained the session ritual: call dopl_map first to orient on what the workspace already knows, then act. Pointed at the Dopl Guide knowledge base as the manual.",
      },
      {
        role: "user",
        summary:
          "Asked where a durable learning should live versus a one-off session note.",
      },
      {
        role: "agent",
        summary:
          "Clarified the split — facts to Knowledge, procedures to Skills, things and their connections to the Ontology, session records to Chats — and offered to file the learning as a KB entry so it outlives the session.",
        verbatim:
          "Facts → Knowledge. Procedures → Skills. Things and their connections → Ontology. Session records → Chats.",
      },
    ],
  }),
  demo({
    id: "map",
    title: "Mapping the workspace ontology",
    overview:
      "An agent session walking the ontology clusters with dopl_map, linking the caller's anchor object, and filing two new objects it found in the codebase.",
    shortDate: "Aug 13",
    fullDate: "Aug 13, 2026",
    source: "Claude Code",
    format: "summarized",
    pinned: false,
    isPublic: false,
    folderName: null,
    deliverablesTotal: 3,
    learnings: 1,
    messages: [
      {
        role: "user",
        summary:
          "Asked the agent to survey the workspace ontology and report which clusters were still empty.",
      },
      {
        role: "agent",
        summary:
          "Ran dopl_map, walked each cluster, filed two new objects it found in the repo, linked them to the caller's anchor, and exported this session so the next agent starts from the map.",
      },
    ],
  }),
  demo({
    id: "export",
    title: "Exporting a clean session transcript",
    overview:
      "A short session practicing the close-out ritual: summarize each turn, mark the deliverables, and export via dopl_chats so the archive compounds.",
    shortDate: "Aug 15",
    fullDate: "Aug 15, 2026",
    source: "Claude Desktop",
    format: "mixed",
    pinned: false,
    isPublic: false,
    folderName: null,
    deliverablesTotal: 1,
    learnings: 2,
    messages: [
      {
        role: "user",
        summary:
          "Asked what a good end-of-session export looks like before closing out.",
      },
      {
        role: "agent",
        summary:
          "Walked through the export shape — a one-line summary per turn, deliverables checked off, learnings pulled out — then filed this very conversation.",
      },
    ],
  }),
];

export function buildDemoGroups(query: string): PaneGroup[] {
  const q = query.trim().toLowerCase();
  const visible = DEMO_CHATS.filter(
    (c) => q === "" || c.title.toLowerCase().includes(q)
  );
  return [
    {
      name: "Onboarding",
      isPublic: true,
      chats: visible.filter((c) => c.folderName !== null),
    },
    {
      name: UNFILED_LABEL,
      isPublic: false,
      chats: visible.filter((c) => c.folderName === null),
    },
  ].filter((g) => g.chats.length > 0);
}
