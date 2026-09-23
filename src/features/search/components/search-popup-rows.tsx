"use client";

/**
 * The popup's rows: one component keyed off `item.kind`, so row height cannot drift.
 * Channels and threads are one line; other kinds stack title + snippet. The keyboard-
 * active row wears the CSS hover token, so arrow and pointer look identical.
 */

import {
  Bot,
  BookOpen,
  FileText,
  Hash,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  User,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import type { SearchGroupKind, SearchItem, SearchScope } from "../contracts";
import { sanitizeSnippet } from "./search-popup-sections";

/** The product's existing glyph for each object kind. */
const GLYPH: Record<SearchGroupKind, LucideIcon> = {
  channels: Hash,
  messages: MessageSquare,
  threads: MessagesSquare,
  artifacts: FileText,
  knowledge: BookOpen,
  agentIdentities: Bot,
  members: User,
  skills: Wrench,
  chats: MessageCircle,
};

/** Named things with a description; prose kinds need the snippet line. */
const ONE_LINE_KINDS: ReadonlySet<SearchGroupKind> = new Set<SearchGroupKind>([
  "channels",
  "threads",
]);

/** URL-keyed faces (the wire has no user ids); the derived name avoids `?` initials. */
function stackUsers(urls: readonly string[]) {
  return urls.map((url, i) => ({
    userId: `${i}:${url}`,
    displayName: (url.split("/").pop() ?? "").replace(/\.\w+$/, "").replace(/[-_]+/g, " "),
    avatarUrl: url,
  }));
}

/** A chip only for a cross-container row in account scope; elsewhere it is implied. */
function containerChip(
  item: SearchItem,
  scope: SearchScope,
  containerId: string | undefined
): string | null {
  if (scope !== "account") return null;
  if (item.containerName === undefined) return null;
  return item.containerId === containerId ? null : item.containerName;
}

export function SearchResultRow({
  item,
  active,
  scope,
  containerId,
  onActivate,
  onHover,
}: {
  item: SearchItem;
  active: boolean;
  /** The host's scope — decides whether the container chip says anything. */
  scope: SearchScope;
  /** The container the host is already in, when it has one. */
  containerId?: string;
  onActivate: () => void;
  onHover: () => void;
}) {
  const Glyph = GLYPH[item.kind];
  const oneLine = ONE_LINE_KINDS.has(item.kind);
  const chip = containerChip(item, scope, containerId);
  // Time only on stacked rows with no chip; one-line kinds spend that space on the description.
  const when = !oneLine && chip === null && item.updatedAt
    ? formatRelativeTime(item.updatedAt)
    : null;
  const faces = oneLine ? [] : (item.avatarUrls ?? []);

  return (
    <button
      type="button"
      // The keyboard cursor (tests read it); pointer hover stays with the CSS.
      data-active={active || undefined}
      data-search-row={item.id}
      onClick={onActivate}
      onMouseMove={onHover}
      className={cn(
        "menu-row flex w-full items-center gap-2 px-1.5 py-1 text-left",
        active && "bg-menu-item-hover-bg"
      )}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-surface-raised-2 text-text-secondary"
        // An identity's colour arrives as a value, so it cannot be a Tailwind class.
        style={item.color ? { color: item.color } : undefined}
        aria-hidden
      >
        <Glyph size={11} strokeWidth={2} />
      </span>

      {oneLine ? (
        <>
          <span className="text-small min-w-0 truncate font-semibold text-text-primary">
            {item.title}
          </span>
          {/* No subtitle: a spacer still pushes the trailing chip right. */}
          {item.subtitle ? (
            <span className="text-caption min-w-0 flex-1 truncate italic text-text-muted">
              {item.subtitle}
            </span>
          ) : (
            <span className="flex-1" aria-hidden />
          )}
        </>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-small truncate font-semibold text-text-primary">
            {item.title}
          </span>
          {item.snippet ? (
            // The feature's only innerHTML: the sanitiser's output, never the wire string.
            <span
              className="text-caption truncate text-text-secondary [&_mark]:bg-caution/30 [&_mark]:text-text-primary"
              dangerouslySetInnerHTML={{ __html: sanitizeSnippet(item.snippet) }}
            />
          ) : item.subtitle ? (
            <span className="text-caption truncate text-text-muted">
              {item.subtitle}
            </span>
          ) : null}
        </span>
      )}

      {faces.length > 0 && (
        <AvatarStack users={stackUsers(faces)} max={3} size="2xs" />
      )}
      {chip !== null && (
        <span className="text-micro shrink-0 whitespace-nowrap rounded-full border border-border-strong bg-bg-elevated px-1.5 py-px font-medium text-text-muted">
          {chip}
        </span>
      )}
      {when && (
        <span className="text-micro shrink-0 whitespace-nowrap text-text-muted">
          {when}
        </span>
      )}
    </button>
  );
}
