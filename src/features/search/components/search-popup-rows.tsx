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
 *
 * 🔒 **TWO SHAPES SINCE 2026-09-17, AND WHICH ONE A KIND TAKES IS A SET, NOT A
 * PROP (Samuel, over the live card:** *"For channels it like repeats the name of
 * the channel in like 3 places it doesn't make any sense. For channels and
 * threads, it should be one line, it should be the name of the channel in black,
 * and then to the right the description of the channel in gray italics."*).
 * Channels and threads are ONE LINE — name, then the row's own description in
 * muted italic; every other kind keeps the stacked title + snippet. The rest of
 * the anatomy (the tile, the trailing chip) is shared, so the two shapes cannot
 * drift into two row heights.
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
 * 🔒 **THE ONE-LINE KINDS (Samuel, 2026-09-17 — quoted in the header).** A
 * channel and a thread are each a NAMED THING with a description; stacking that
 * description under the name bought a second line that said what the first line
 * already said. Everything else here is a piece of PROSE found by its body, and
 * prose needs the snippet line.
 */
const ONE_LINE_KINDS: ReadonlySet<SearchGroupKind> = new Set<SearchGroupKind>([
  "channels",
  "threads",
]);

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

/**
 * 🔒 **THE CONTAINER IS A CHIP, AND ONLY WHERE IT TELLS THE READER SOMETHING
 * (Samuel, 2026-09-17).** In container scope every row is in the container the
 * reader is already looking at, and in account scope the reader's own container
 * is the unstated default — naming either one is the third copy of a word the
 * row already carries. What is left is the CROSS-CONTAINER row, which is the
 * only case where "where is this" is a question.
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
  // ⚠ A TIME ONLY ON THE STACKED ROWS, and only when no chip took the slot: the
  // one-line kinds spend their right-hand space on the description.
  const when = !oneLine && chip === null && item.updatedAt
    ? formatRelativeTime(item.updatedAt)
    : null;
  const faces = oneLine ? [] : (item.avatarUrls ?? []);

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
        "menu-row flex w-full items-center gap-2 px-1.5 py-1 text-left",
        active && "bg-menu-item-hover-bg"
      )}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-surface-raised-2 text-text-secondary"
        // ⚠ THE AGENT'S OWN HUE WHEN THE ROW HAS ONE (a template's colour
        // arrives as a value, so it cannot be a Tailwind class —
        // `docs/DESIGN-SYSTEM.md` › THE AGENT COLOUR BANK).
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
          {/* ⚠ **OMITTED ENTIRELY WITH NOTHING TO SAY** — an empty span still
              takes the row's free space, and the name would stop reading as the
              start of a line. */}
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
      )}

      {faces.length > 0 && (
        <AvatarStack users={stackUsers(faces)} max={3} size="2xs" />
      )}
      {chip !== null && (
        /* The kit's chip (`docs/DESIGN-SYSTEM.md` › Pills/chips) at the card's
           own scale — never a second copy of the row's name. */
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
