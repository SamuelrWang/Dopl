"use client";

import { useState } from "react";
import { ChevronDown, Hash, PanelRight, Plus, UserPlus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { EmptyState } from "@/shared/ui/empty-state";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SendButton } from "@/shared/ui/send-button";
import { TranscriptSkeleton } from "@/shared/ui/skeleton";
import { usePlaygroundPoll, usePlaygroundSession } from "../../session";
import {
  DEMO_CHANNELS,
  toDemoChannel,
  toDemoMessage,
  type ChannelListResponse,
  type DemoChannel,
  type DemoMessage,
  type MessageListResponse,
} from "./channels-pane-data";

/**
 * Playground: the Channels page. A visual clone of
 * `@/features/channels/components/channels-view-core` and the panes it
 * composes (`channels-list-pane`, `channel-pane`, `channel-transcript`,
 * `message-composer`) — every class recipe is copied from the real components
 * so the demo stays pixel-faithful; if the real page moves, move this with it.
 *
 * Content source is two-mode: baked-in demo content until a playground
 * session's workspace answers, then the REAL channel list + the selected
 * channel's messages via `usePlaygroundPoll`. Reads only — the composer stays
 * a visual prop either way.
 */

type DemoTab = "active" | "archived";

export function ChannelsPane() {
  const [tab, setTab] = useState<DemoTab>("active");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("ch-general");

  const { session } = usePlaygroundSession();
  const channelsPoll = usePlaygroundPoll<ChannelListResponse>(
    session ? "/api/channels" : null
  );
  // Live once the workspace answers; the static demo until then (first poll
  // in flight, poll erroring, or no session at all).
  const live = channelsPoll.data?.channels ?? null;

  const channels: DemoChannel[] =
    live === null ? DEMO_CHANNELS : live.map((c) => toDemoChannel(c, []));

  const selected =
    (channels.find((c) => c.id === selectedId) ?? channels[live === null ? 1 : 0]) ||
    null;

  return (
    <div className="page-float flex antialiased">
      <ListPane
        channels={channels}
        tab={tab}
        onTabChange={setTab}
        query={query}
        onQueryChange={setQuery}
        selectedId={selected?.id ?? ""}
        onSelect={setSelectedId}
      />
      {selected === null ? (
        <EmptyState
          icon={Hash}
          title="No channels yet."
          description="Ask your connected agent to open a channel or post a message — it shows up here."
        />
      ) : live === null ? (
        <ChannelDetail channel={selected} />
      ) : (
        // `key` remounts the poll per channel: a fresh loading state instead
        // of the previous channel's held payload flashing under a new header.
        <LiveChannelDetail key={selected.id} channel={selected} />
      )}
    </div>
  );
}

/** Live detail: owns the selected channel's messages poll. */
function LiveChannelDetail({ channel }: { channel: DemoChannel }) {
  const { data, loading } = usePlaygroundPoll<MessageListResponse>(
    `/api/channels/${channel.id}/messages`
  );
  const messages = (data?.messages ?? []).map(toDemoMessage);
  return (
    <ChannelDetail
      channel={{ ...channel, messages }}
      loadingMessages={loading}
    />
  );
}

/** Left master pane — clone of `ChannelsListPane`. */
function ListPane({
  channels,
  tab,
  onTabChange,
  query,
  onQueryChange,
  selectedId,
  onSelect,
}: {
  channels: DemoChannel[];
  tab: DemoTab;
  onTabChange: (tab: DemoTab) => void;
  query: string;
  onQueryChange: (q: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const visible =
    tab === "archived"
      ? []
      : channels.filter((c) => q === "" || c.name.toLowerCase().includes(q));
  const directs = visible.filter((c) => c.isDirect);
  const normals = visible.filter((c) => !c.isDirect);

  const rows = (channels: DemoChannel[]) =>
    channels.map((c) => (
      <ChannelRow
        key={c.id}
        channel={c}
        selected={c.id === selectedId}
        onSelect={() => onSelect(c.id)}
      />
    ));

  return (
    <div className="flex w-[372px] shrink-0 flex-col border-r border-border-default">
      <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
        <h1 className="text-title font-semibold tracking-tight text-text-primary">
          Channels
        </h1>
        <span className="text-caption text-text-muted">{channels.length}</span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="New"
          title="New"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="mx-3.5 mb-3">
        <SearchField
          value={query}
          onChange={onQueryChange}
          placeholder="Search channels"
        />
      </div>

      <SegmentedControl
        options={[
          { key: "active" as const, label: "Active" },
          { key: "archived" as const, label: "Archived" },
        ]}
        value={tab}
        onChange={onTabChange}
        className="mx-3.5 mb-3"
      />

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-default pb-4">
        {visible.length === 0 ? (
          <p className="px-4 py-2.5 text-caption leading-relaxed text-text-muted">
            {q
              ? "No channels match."
              : tab === "archived"
                ? "No archived channels."
                : "No channels yet."}
          </p>
        ) : (
          <>
            {directs.length > 0 && <SectionLabel>Direct messages</SectionLabel>}
            {rows(directs)}
            {normals.length > 0 && <SectionLabel>Channels</SectionLabel>}
            {rows(normals)}
          </>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3.5 pb-1 pt-2.5 text-label font-semibold uppercase tracking-wide text-text-secondary">
      {children}
    </p>
  );
}

/** One list row — merges the real pane's `ChannelRow` / `DirectRow` twins. */
function ChannelRow({
  channel: c,
  selected,
  onSelect,
}: {
  channel: DemoChannel;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors",
        selected ? "bg-surface-raised-3" : "hover:bg-surface-raised-1"
      )}
    >
      {selected && (
        <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r-[3px] bg-text-primary" />
      )}
      {c.isDirect ? (
        <Avatar
          person={{
            userId: c.id,
            email: null,
            displayName: c.name,
            avatarUrl: null,
          }}
          size="xs"
        />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-inset text-text-secondary">
          <Hash size={12} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 truncate text-body text-text-primary",
              c.unread ? "font-semibold" : "font-medium"
            )}
          >
            {c.name}
          </span>
          {c.unread && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-primary" />
          )}
          <span className="flex-1" />
          <span className="shrink-0 text-micro text-text-muted">{c.time}</span>
        </span>
        {!c.isDirect && (
          <span className="block truncate text-caption text-text-secondary">
            {c.visibility === "public" ? "Public" : "Private"} · {c.memberCount}{" "}
            members
            {c.topic ? ` · ${c.topic}` : ""}
          </span>
        )}
      </span>
    </button>
  );
}

/** Right detail column — clone of `ChannelPane`'s crumb bar + transcript + composer. */
function ChannelDetail({
  channel,
  loadingMessages = false,
}: {
  channel: DemoChannel;
  loadingMessages?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border-default px-3.5">
        {channel.isDirect ? (
          <>
            <Avatar
              person={{
                userId: channel.id,
                email: null,
                displayName: channel.name,
                avatarUrl: null,
              }}
              size="xs"
            />
            <span className="shrink-0 truncate text-lead font-semibold text-text-primary">
              {channel.name}
            </span>
          </>
        ) : (
          <>
            <Hash size={15} className="shrink-0 text-text-muted" />
            <span className="shrink-0 truncate text-lead font-semibold text-text-primary">
              {channel.name}
            </span>
            <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
              {channel.visibility}
            </span>
            {channel.topic && (
              <span className="min-w-0 truncate text-caption text-text-muted">
                {channel.topic}
              </span>
            )}
          </>
        )}
        <span className="flex-1" />

        <span className="flex shrink-0 items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              channel.onlineCount > 0 ? "bg-success" : "bg-text-disabled"
            )}
          />
          <span className="text-caption text-text-muted">
            {channel.onlineCount > 0
              ? `${channel.onlineCount} online`
              : "No agents online"}
          </span>
          <AvatarStack
            users={channel.members.map((m) => ({
              userId: m.userId,
              displayName: m.displayName,
              avatarUrl: null,
              online: m.online,
            }))}
            max={5}
          />
        </span>

        <button
          type="button"
          aria-label="Rooms"
          title="Show rooms"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
        >
          <PanelRight size={16} />
        </button>
        {!channel.isDirect && (
          <button
            type="button"
            aria-label="Add members"
            title="Add members"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
          >
            <UserPlus size={16} />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-14 pt-6">
          <div className="mx-auto flex max-w-[760px] flex-col gap-2.5 pb-2">
            {channel.messages.length > 0 ? (
              channel.messages.map((m) => <MessageBubble key={m.id} message={m} />)
            ) : loadingMessages ? (
              <TranscriptSkeleton />
            ) : (
              <p className="py-8 text-center text-caption text-text-muted">
                No messages yet.
              </p>
            )}
          </div>
        </div>
        <Composer channel={channel} />
      </div>
    </div>
  );
}

/** Transcript bubble — clone of `channel-transcript`'s `MessageBubble`. */
function MessageBubble({ message: m }: { message: DemoMessage }) {
  const isHuman = m.kind === "user";
  const isOwn = Boolean(m.own);
  return (
    <article
      className={cn(
        "max-w-[66%] rounded-[10px] border px-3.5 py-2.5",
        isOwn ? "self-end" : "self-start",
        isHuman
          ? "border-border-default bg-card-surface-subtle"
          : "border-border-subtle bg-bg-elevated"
      )}
    >
      <div className={cn("mb-1 flex items-center gap-1.5", isOwn && "justify-end")}>
        {!isOwn && (
          <Avatar
            person={{
              userId: m.author,
              email: null,
              displayName: m.author,
              avatarUrl: null,
            }}
            size="xs"
          />
        )}
        <span className="text-micro font-medium uppercase tracking-wide text-text-muted">
          {m.author} · {m.time}
        </span>
        {!isHuman && (
          <span className="rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
            agent
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-text-primary">
        {m.body}
      </p>
    </article>
  );
}

/** Pinned composer — static clone of `MessageComposer`'s resting chat state. */
function Composer({ channel }: { channel: DemoChannel }) {
  return (
    <div className="shrink-0 px-14 pb-5 pt-2">
      <div className="mx-auto max-w-[760px]">
        <div className="concave-field flex items-end gap-2 rounded-[12px] px-3 py-2">
          <textarea
            rows={1}
            readOnly
            placeholder={
              channel.isDirect
                ? `Message ${channel.name}`
                : `Message #${channel.name}`
            }
            className="min-h-[calc(1.625em_+_8px)] max-h-[calc(4.875em_+_8px)] flex-1 resize-none overflow-y-auto bg-transparent py-1 text-body leading-relaxed text-text-primary outline-none placeholder:text-text-muted"
          />
          <button
            type="button"
            aria-label="Send as: Message"
            className="flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-bg-elevated px-2 py-1 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            Message
            <ChevronDown size={11} className="shrink-0 text-text-muted" />
          </button>
          <SendButton onClick={() => {}} disabled label="Send message" />
        </div>
        <p className="mt-1.5 text-caption text-text-muted">
          Goes to the channel. No agent is started.
        </p>
      </div>
    </div>
  );
}
