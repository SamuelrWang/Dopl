"use client";

/**
 * The popup's rows: one anatomy, nine kinds, no new markup.
 *
 * One row component keyed off `item.kind`, never a component per kind — the kinds
 * differ in which mark and what the secondary line says, which is data. Nine
 * components would be nine places for the row height to drift.
 *
 * The face is the kit's `.menu-row`. The keyboard-active row wears
 * `bg-menu-item-hover-bg`, the same token CSS hover paints, so a pointer hover
 * and an arrow landing look identical.
 *
 * (2026-09-17) Two shapes, chosen by a SET rather than a prop: channels and
 * threads are one line (name, then description in muted italic); every other kind
 * keeps the stacked title + snippet. The tile and trailing chip are shared, so the
 * two shapes cannot drift into two row heights.
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

/** The entry glyph, per kind — the same glyph vocabulary the product already
 *  uses for these objects (a channel is a hash, an identity is a bot). */
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

/**
 * The one-line kinds: a channel and a thread are each a named thing with a
 * description, so stacking it bought a second line saying what the first said.
 * Everything else is prose found by its body, and prose needs the snippet line.
 */
const ONE_LINE_KINDS: ReadonlySet<SearchGroupKind> = new Set<SearchGroupKind>([
  "channels",
  "threads",
]);

/**
 * `avatarUrls` is URLs on the wire and `AvatarStack` takes people; a URL is its
 * own key, since the wire carries no user ids for these faces (a row is not a
 * roster). The fallback name is derived from the URL because `AvatarStack` draws
 * initials whenever the image does not resolve, and a blank name paints `?`
 * circles.
 */
function stackUsers(urls: readonly string[]) {
  return urls.map((url, i) => ({
    userId: `${i}:${url}`,
    displayName: (url.split("/").pop() ?? "").replace(/\.\w+$/, "").replace(/[-_]+/g, " "),
    avatarUrl: url,
  }));
}

/**
 * (2026-09-17) The container is a chip only where it tells the reader something:
 * in container scope, and for the reader's own container, the name is already
 * implied. Only a cross-container row leaves "where is this" a question.
 */
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
  /** The HOST's scope — decides whether the container chip says anything. */
  scope: SearchScope;
  /** The container the host is already in, when it has one. */
  containerId?: string;
  onActivate: () => void;
  onHover: () => void;
}) {
  const Glyph = GLYPH[item.kind];
  const oneLine = ONE_LINE_KINDS.has(item.kind);
  const chip = containerChip(item, scope, containerId);
  // A time only on the stacked rows, and only when no chip took the slot — the
  // one-line kinds spend their right-hand space on the description.
  const when = !oneLine && chip === null && item.updatedAt
    ? formatRelativeTime(item.updatedAt)
    : null;
  const faces = oneLine ? [] : (item.avatarUrls ?? []);

  return (
    <button
      type="button"
      // `data-active` is the keyboard cursor and the test reads it; the pointer's
      // own hover stays with the CSS.
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
        // The agent's own hue when the row has one: an identity's colour arrives
        // as a value, so it cannot be a Tailwind class.
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
          {/* Omitted entirely with nothing to say: an empty span still takes the
              row's free space. */}
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
            // The only `dangerouslySetInnerHTML` in this feature, and it reads
            // the sanitiser's output — never the wire string.
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
        /* The kit's chip at the card's own scale — never a second copy of the
           row's name. */
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
