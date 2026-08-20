"use client";

import { useState } from "react";
import {
  Building2,
  ChevronRight,
  Copy,
  Folder,
  FolderPlus,
  Lock,
  MoreHorizontal,
  Star,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { TranscriptSkeleton } from "@/shared/ui/skeleton";
import {
  CHATS_PATH,
  CHAT_FOLDERS_PATH,
  chatPath,
} from "@/features/chats/client/query-keys";
import { usePlaygroundPoll, usePlaygroundSession } from "../../session";
import {
  buildDemoGroups,
  buildLiveGroups,
  DEMO_CHATS,
  PANE_FILTERS,
  paneChatFor,
  toPaneMessages,
  type ChatDetailDto,
  type ChatFoldersDto,
  type ChatListDto,
  type PaneChat,
  type PaneFilter,
  type PaneMessage,
} from "./chats-pane-data";

/**
 * Playground chats pane — a clone of the desktop Chats page
 * (`src/features/chats/components/chats-view.tsx` + its list/detail panes)
 * for the public /playground demo. Before a session starts (or before its
 * first poll answers) it renders the hardcoded demo archive from
 * `chats-pane-data.ts`; once the guest session's polls land it renders the
 * REAL workspace chats over the same JSX. Reads only — no writes, realtime,
 * or navigation.
 */

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

export function ChatsPane() {
  const { session } = usePlaygroundSession();
  const [filter, setFilter] = useState<PaneFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = usePlaygroundPoll<ChatListDto>(session ? CHATS_PATH : null);
  const folderRes = usePlaygroundPoll<ChatFoldersDto>(
    session ? CHAT_FOLDERS_PATH : null
  );

  // Live once the list poll has answered; until then the demo archive holds
  // the pane (requirement: no session / no data → static demo unchanged).
  const live = session !== null && list.data !== null;
  const liveChats = list.data?.chats ?? [];
  const liveFolders = folderRes.data?.folders ?? [];

  const groups = live
    ? buildLiveGroups(liveChats, liveFolders, filter, query)
    : buildDemoGroups(query);

  // Selection defaults to the first chat of the active source; a stale id
  // (demo id after go-live, deleted chat) falls back the same way.
  const selectedLive = live
    ? (liveChats.find((c) => c.id === selectedId) ?? liveChats[0] ?? null)
    : null;
  const detail = usePlaygroundPoll<ChatDetailDto>(
    live && selectedLive ? chatPath(selectedLive.id) : null
  );

  let selected: PaneChat | null;
  if (live) {
    selected = selectedLive && {
      ...paneChatFor(selectedLive, liveFolders),
      // Poll state can still hold the PREVIOUS selection's payload right
      // after a switch — only messages for the current chat count.
      messages:
        detail.data && detail.data.chat.id === selectedLive.id
          ? toPaneMessages(detail.data.chat)
          : null,
    };
  } else {
    selected = DEMO_CHATS.find((c) => c.id === selectedId) ?? DEMO_CHATS[0];
  }

  const chatCount = live ? liveChats.length : DEMO_CHATS.length;

  return (
    <div className="page-float flex antialiased">
      {/* ── Left: session list ─────────────────────────────────────── */}
      <div className="flex w-[372px] shrink-0 flex-col border-r border-border-default">
        <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
          <h1 className="text-title font-semibold tracking-tight text-text-primary">
            Chats
          </h1>
          <span className="text-caption text-text-muted">{chatCount}</span>
          <span className="flex-1" />
          <span className={ICON_BTN} aria-hidden>
            <FolderPlus size={16} />
          </span>
        </div>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search chats"
          className="mx-3.5 mb-3"
        />

        <SegmentedControl
          options={PANE_FILTERS}
          value={filter}
          onChange={setFilter}
          className="mx-3.5 mb-3"
        />

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-default pb-4">
          {groups.length === 0 ? (
            <p className="px-4 py-2.5 text-caption leading-relaxed text-text-muted">
              {live && liveChats.length === 0
                ? "No chats yet — ask your agent to export a session and it will appear here."
                : "No chats match."}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.name} className="border-b border-border-subtle">
                <FolderHeader
                  name={group.name}
                  count={group.chats.length}
                  isPublic={group.isPublic}
                />
                {group.chats.map((c) => (
                  <ChatRow
                    key={c.id}
                    chat={c}
                    selected={c.id === selected?.id}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right: selected chat document ──────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {selected === null ? (
          <div className="flex flex-1 items-center justify-center px-14">
            <p className="max-w-[360px] text-center text-body leading-relaxed text-text-muted">
              Nothing here yet. When an agent exports a session into this
              workspace, its transcript opens here.
            </p>
          </div>
        ) : (
          <>
            <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border-default px-3.5">
              <span className="shrink-0 text-small font-medium text-text-secondary">
                {selected.folderName ?? "Unfiled"}
              </span>
              <ChevronRight size={13} className="shrink-0 text-text-muted" />
              <span className="min-w-0 truncate text-lead font-semibold text-text-primary">
                {selected.title}
              </span>
              <span className="flex-1" />
              <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border-strong bg-bg-inset px-2.5 text-caption font-medium text-text-secondary">
                {selected.isPublic ? (
                  <Building2 size={11} />
                ) : (
                  <Lock size={11} />
                )}
                {selected.isPublic ? "Public" : "Private"}
              </span>
              <span
                className={cn(ICON_BTN, selected.pinned && "text-text-primary")}
                aria-hidden
              >
                <Star
                  size={15}
                  className={cn(selected.pinned && "fill-current")}
                />
              </span>
              <span className={ICON_BTN} aria-hidden>
                <Copy size={15} />
              </span>
              <span className={ICON_BTN} aria-hidden>
                <MoreHorizontal size={16} />
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-14 pb-16 pt-8">
              <div className="mx-auto max-w-[760px]">
                <HeaderCard chat={selected} />

                <div className="mb-3 mt-7 flex items-baseline gap-2">
                  <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
                    Conversation
                  </span>
                  <span className="text-caption text-text-muted">
                    {selected.messageCount} messages · {selected.format}
                  </span>
                </div>
                {selected.messages === null ? (
                  <TranscriptSkeleton
                    bubbles={Math.min(Math.max(selected.messageCount, 1), 4)}
                  />
                ) : selected.messages.length === 0 ? (
                  <p className="text-body leading-relaxed text-text-muted">
                    This chat was exported without a transcript.
                  </p>
                ) : (
                  <MessageList messages={selected.messages} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FolderHeader({
  name,
  count,
  isPublic = false,
}: {
  name: string;
  count: number;
  isPublic?: boolean;
}) {
  return (
    <div className="flex w-full items-center gap-2 pr-3.5 transition-colors hover:bg-surface-raised-1">
      <span className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3.5 text-left">
        <ChevronRight size={12} className="shrink-0 rotate-90 text-text-muted" />
        <Folder size={13} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-small font-semibold text-text-primary">
          {name}
        </span>
      </span>
      {isPublic && (
        <span className="flex h-6 w-6 items-center justify-center rounded-[6px] text-text-secondary">
          <Building2 size={12} />
        </span>
      )}
      <span className="text-micro text-text-muted">{count}</span>
    </div>
  );
}

function ChatRow({
  chat,
  selected,
  onSelect,
}: {
  chat: PaneChat;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(chat.id)}
      className={cn(
        "relative flex w-full flex-col gap-0.5 py-2 pl-8 pr-4 text-left transition-colors",
        selected ? "bg-surface-raised-3" : "hover:bg-surface-raised-1"
      )}
    >
      {selected && (
        <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r-[3px] bg-text-primary" />
      )}
      <span className="flex w-full items-center gap-1.5">
        {chat.pinned && (
          <Star size={10} className="shrink-0 fill-current text-text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
          {chat.title}
        </span>
        <span className="shrink-0 text-micro text-text-muted">
          {chat.shortDate}
        </span>
      </span>
      <span className="flex w-full items-center gap-1.5 text-caption text-text-secondary">
        <span>{chat.source}</span>
        <span className="text-text-muted">·</span>
        <span>{chat.messageCount} messages</span>
      </span>
    </button>
  );
}

function HeaderCard({ chat }: { chat: PaneChat }) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-border-strong bg-bg-elevated">
      <div className="px-5 pb-4 pt-4">
        <h2 className="break-words text-display font-semibold tracking-tight text-text-primary">
          {chat.title}
        </h2>
        <p className="mt-1.5 break-words text-lead leading-relaxed text-text-secondary">
          {chat.overview}
        </p>
        <p className="mt-2.5 text-caption text-text-muted">
          {chat.fullDate} · {chat.source} · {chat.messageCount} messages ·{" "}
          {chat.format.charAt(0).toUpperCase() + chat.format.slice(1)}
        </p>
        {chat.isPublic && (
          <div className="mt-3 flex items-center gap-2">
            <Avatar
              size="xs"
              person={{
                userId: chat.ownerUserId,
                email: null,
                displayName: chat.ownerName,
                avatarUrl: chat.ownerAvatarUrl,
              }}
            />
            <span className="text-caption text-text-secondary">
              Shared by{" "}
              <span className="font-medium text-text-primary">
                {chat.sharedBy}
              </span>
            </span>
          </div>
        )}
      </div>

      <DisclosureStrip label="Session details" />
      <DisclosureStrip
        label="What was done"
        meta={`${chat.deliverablesDone}/${chat.deliverablesTotal}`}
      />
      <DisclosureStrip
        label="Memories & learnings"
        meta={String(chat.learnings)}
      />
    </section>
  );
}

/** Collapsed disclosure strip — the demo keeps the header card resting. */
function DisclosureStrip({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="border-t border-border-subtle">
      <div className="flex w-full items-center gap-2 bg-card-surface-subtle px-4 py-1.5 text-left">
        <ChevronRight size={11} className="shrink-0 text-text-muted" />
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          {label}
        </span>
        {meta && <span className="text-caption text-text-muted">{meta}</span>}
        <span className="flex-1" />
      </div>
    </div>
  );
}

function MessageList({ messages }: { messages: PaneMessage[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {messages.map((message, index) => (
        <article
          key={index}
          className={cn(
            "rounded-[10px] border px-3.5 py-2.5",
            message.role === "user"
              ? "ml-12 border-border-default bg-card-surface-subtle"
              : "border-border-subtle bg-bg-elevated"
          )}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-micro font-medium uppercase tracking-wide text-text-muted">
              {message.role === "user" ? "You" : "Agent"} · #{index + 1}
            </span>
            {message.verbatim && (
              <span className="rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
                verbatim
              </span>
            )}
          </div>
          <p className="break-words text-body leading-relaxed text-text-primary">
            {message.summary}
          </p>
          {message.verbatim && (
            <div className="concave-field mt-2 rounded-lg px-3 py-2.5">
              <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-text-primary">
                {message.verbatim}
              </p>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
