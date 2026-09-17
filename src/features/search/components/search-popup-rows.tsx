"use client";

/**
 * THE POPUP'S ROWS — one anatomy, nine kinds, and no new markup.
 *
 * ⚠ **ONE ROW COMPONENT, KEYED OFF `item.kind` — NEVER A COMPONENT PER KIND.**
 * Every row in the reference is the same object: a leading mark, a bold title,
 * a secondary line, and right-aligned meta. The kinds differ in WHICH MARK and
 * WHAT THE SECONDARY LINE SAYS, which is data, not structure. Nine components
 * would be nine places for the row height to drift.
 *
 * ⚠ **THE FACE IS THE KIT'S `.menu-row`** (`docs/DESIGN-SYSTEM.md` › Kit
 * classes) — the app's ONE option face, hover and focus alike. The
 * keyboard-active row wears `bg-menu-item-hover-bg`, the same token the CSS
 * hover paints, so a pointer hover and an ↓ landing look identical. Never a
 * second gray here.
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
import type { SearchGroupKind, SearchItem } from "../contracts";
import { sanitizeSnippet } from "./search-popup-sections";

/** The entry glyph, per kind — the same glyph vocabulary the product already
 *  uses for these objects (a channel is a hash, a template is a bot). */
const GLYPH: Record<SearchGroupKind, LucideIcon> = {
  channels: Hash,
  messages: MessageSquare,
  threads: MessagesSquare,
  artifacts: FileText,
  knowledge: BookOpen,
  agentTemplates: Bot,
  members: User,
  skills: Wrench,
  chats: MessageCircle,
};

/**
 * ⚠ `avatarUrls` is a list of URLs on the wire; `AvatarStack` takes people. The
 * mapping is here and nowhere else, and a URL is its own key — the wire carries
 * no user ids for these faces on purpose (a row is not a roster).
 *
 * ⚠ **THE FALLBACK NAME COMES OUT OF THE URL**, because there is no name on the
 * wire and `AvatarStack` draws INITIALS whenever the image does not resolve —
 * which is every avatar in the packaged SPA until main hands the bytes back. A
 * blank name there paints a row of `?` circles.
 */
function stackUsers(urls: readonly string[]) {
  return urls.map((url, i) => ({
    userId: `${i}:${url}`,
    displayName: (url.split("/").pop() ?? "").replace(/\.\w+$/, "").replace(/[-_]+/g, " "),
    avatarUrl: url,
  }));
}

/** The row's own right-hand fact: where it lives, else when it last moved. */
function metaLabel(item: SearchItem): string | null {
  if (item.containerName) return item.containerName;
  if (item.updatedAt) return formatRelativeTime(item.updatedAt);
  return null;
}

export function SearchResultRow({
  item,
  active,
  onActivate,
  onHover,
}: {
  item: SearchItem;
  active: boolean;
  onActivate: () => void;
  onHover: () => void;
}) {
  const Glyph = GLYPH[item.kind];
  const meta = metaLabel(item);
  const faces = item.avatarUrls ?? [];

  return (
    <button
      type="button"
      // ⚠ `data-active` IS THE KEYBOARD CURSOR, and the test reads it. The
      // pointer's own hover stays with the CSS.
      data-active={active || undefined}
      data-search-row={item.id}
      onClick={onActivate}
      onMouseMove={onHover}
      className={cn(
        "menu-row flex w-full items-center gap-2.5 px-2 py-1.5 text-left",
        active && "bg-menu-item-hover-bg"
      )}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-surface-raised-2 text-text-secondary"
        // ⚠ THE AGENT'S OWN HUE WHEN THE ROW HAS ONE (a template's colour
        // arrives as a value, so it cannot be a Tailwind class —
        // `docs/DESIGN-SYSTEM.md` › THE AGENT COLOUR BANK).
        style={item.color ? { color: item.color } : undefined}
        aria-hidden
      >
        <Glyph size={13} strokeWidth={2} />
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body truncate font-semibold text-text-primary">
          {item.title}
        </span>
        {item.snippet ? (
          // ⚠ THE ONLY `dangerouslySetInnerHTML` IN THIS FEATURE, and it reads
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

      {faces.length > 0 && (
        <AvatarStack users={stackUsers(faces)} max={3} size="2xs" />
      )}
      {meta && (
        <span className="text-caption shrink-0 whitespace-nowrap text-text-muted">
          {meta}
        </span>
      )}
    </button>
  );
}
