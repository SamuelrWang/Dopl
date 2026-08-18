/**
 * Channels v2 — the Tags row's dropdown: a MENTIONS INBOX.
 *
 * The label stays "Tags" (the reference design's word); the content is every
 * message that @-tags the viewer. An accordion inside the Info tab, not a
 * popover — the panel is 340px and a floating card would cover the rows it
 * answers to.
 *
 * Clicking an item NAVIGATES (channel or thread view), SCROLLS the transcript
 * to the message and MARKS the mention read — the page owns all three
 * (index.tsx › onOpenMention). Read items stay in the list, unmarked: the inbox
 * is a record, not just a to-do pile.
 */

import { Avatar } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { AgentChip } from "./bits";
import { MENTIONS, mentionLocation, type MockMention } from "./mock-mentions";

export function MentionsList({
  readMentions,
  onOpenMention,
  onMarkAllRead,
}: {
  readMentions: ReadonlySet<string>;
  onOpenMention: (mention: MockMention) => void;
  onMarkAllRead: () => void;
}) {
  const unread = MENTIONS.filter((m) => !readMentions.has(m.id)).length;

  if (MENTIONS.length === 0) {
    return (
      <p className="px-2 pb-2 pt-1 text-caption text-text-muted">
        No messages tag you in this channel yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 pb-2 pl-7 pr-1 pt-0.5">
      {unread > 0 && (
        <button
          type="button"
          onClick={onMarkAllRead}
          className="self-end rounded-[6px] px-1.5 py-0.5 text-caption font-medium text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
        >
          Mark all read
        </button>
      )}
      {MENTIONS.map((mention) => (
        <MentionItem
          key={mention.id}
          mention={mention}
          unread={!readMentions.has(mention.id)}
          onOpen={() => onOpenMention(mention)}
        />
      ))}
    </div>
  );
}

function MentionItem({
  mention,
  unread,
  onOpen,
}: {
  mention: MockMention;
  unread: boolean;
  onOpen: () => void;
}) {
  const { author, authorLabel, agent, time, snippet, threadId } = mention;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-unread={unread || undefined}
      className={cn(
        "flex w-full flex-col gap-1 rounded-[8px] px-2 py-1.5 text-left transition-colors",
        // Unread wears a soft link tint + dot; read rows are plain. The tint is
        // conditional so hover can own the background on read rows.
        unread ? "bg-link/5 hover:bg-link/10" : "hover:bg-surface-raised-1"
      )}
    >
      <span className="flex w-full items-center gap-1.5">
        {unread && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-link"
          />
        )}
        <Avatar
          person={author}
          size="xs"
          className="h-[18px] w-[18px] text-micro"
        />
        <span className="truncate text-small font-semibold text-text-primary">
          {authorLabel}
        </span>
        {agent && <AgentChip />}
        <span className="ml-auto shrink-0 text-micro text-text-muted">
          {time}
        </span>
        <span className="sr-only">{unread ? "unread mention" : "read mention"}</span>
      </span>
      <span className="line-clamp-2 text-caption text-text-secondary">
        {snippet}
      </span>
      <span className="text-micro text-text-muted">
        in {mentionLocation(threadId)}
      </span>
    </button>
  );
}
