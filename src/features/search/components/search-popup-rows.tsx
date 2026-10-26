"use client";

/**
 * The popup's rows: one component keyed off `item.kind`, so row height cannot drift. People
 * and identities lead with their face, every other kind with its glyph on a mark tile.
 * Channels and threads are one line; other kinds stack the title over one line of context.
 * The keyboard-active row wears the CSS hover token, so arrow and pointer look identical.
 */

import type { ReactNode } from "react";
import {
  BookOpen,
  Clock3,
  CornerDownLeft,
  FileText,
  Hash,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { IdentityFace } from "@/shared/ui/identity-face";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import { splitMatches } from "../highlight";
import type { SearchGroupKind, SearchItem, SearchScope } from "../contracts";
import { sanitizeSnippet } from "./search-popup-sections";

type FaceKind = "members" | "agentIdentities";

const GLYPH: Record<Exclude<SearchGroupKind, FaceKind>, LucideIcon> = {
  channels: Hash,
  messages: MessageSquare,
  threads: MessagesSquare,
  artifacts: FileText,
  knowledge: BookOpen,
  skills: Wrench,
  chats: MessageCircle,
};

/** Named things with a description; prose kinds need the context line. */
const ONE_LINE_KINDS: ReadonlySet<SearchGroupKind> = new Set<SearchGroupKind>([
  "channels",
  "threads",
]);

const LEAD_PX = 20;

/** The row face; `[&_mark]` paints the server's snippet marks and the title's alike. */
const ROW =
  "menu-row flex w-full items-center gap-2.5 px-2 py-1.5 text-left [&_mark]:rounded-[2px] [&_mark]:bg-caution/25 [&_mark]:text-text-primary";

/** Small white key box: the footer legend, the active row's Enter and the field's Esc. */
export function Keycap({ children }: { children: ReactNode }) {
  return (
    <span className="text-micro inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-border-default bg-bg-elevated px-1 leading-none text-text-secondary">
      {children}
    </span>
  );
}

function GlyphTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="mark-tile size-5 flex-none text-text-secondary" aria-hidden>
      <Icon size={11} strokeWidth={2} />
    </span>
  );
}

function Lead({ item }: { item: SearchItem }) {
  if (item.kind === "members" || item.kind === "agentIdentities") {
    return (
      <IdentityFace
        size={LEAD_PX}
        photo={item.avatarUrls?.[0]}
        name={item.title}
        // A saved identity has no colour of its own; a member is a person, ringless.
        ring={item.kind === "agentIdentities" ? "neutral" : undefined}
      />
    );
  }
  return <GlyphTile icon={GLYPH[item.kind]} />;
}

function Marked({ text, pattern }: { text: string; pattern: RegExp | null }) {
  return (
    <>
      {splitMatches(text, pattern).map((part, i) =>
        part.match ? <mark key={i}>{part.text}</mark> : part.text
      )}
    </>
  );
}

/** The container only for a cross-container row in account scope; elsewhere it is implied. */
function containerLabel(
  item: SearchItem,
  scope: SearchScope,
  containerId: string | undefined
): string | null {
  if (scope !== "account") return null;
  if (item.containerName === undefined) return null;
  return item.containerId === containerId ? null : item.containerName;
}

function EnterHint() {
  return (
    <Keycap>
      <CornerDownLeft size={10} aria-hidden />
    </Keycap>
  );
}

export function SearchResultRow({
  item,
  active,
  pattern,
  scope,
  containerId,
  onActivate,
  onHover,
}: {
  item: SearchItem;
  active: boolean;
  /** The typed query's highlight, built once per query (`highlight.ts`). */
  pattern: RegExp | null;
  /** The host's scope — decides whether the container is worth naming. */
  scope: SearchScope;
  /** The container the host is already in, when it has one. */
  containerId?: string;
  onActivate: () => void;
  onHover: () => void;
}) {
  const oneLine = ONE_LINE_KINDS.has(item.kind);
  // One quiet fact on the right: the container when it answers a question, else the age of
  // a stacked row (one-line kinds spend that space on the description).
  const meta =
    containerLabel(item, scope, containerId) ??
    (!oneLine && item.updatedAt ? formatRelativeTime(item.updatedAt) : null);

  return (
    <button
      type="button"
      // The keyboard cursor (tests read it); pointer hover stays with the CSS.
      data-active={active || undefined}
      data-search-row={item.id}
      onClick={onActivate}
      onMouseMove={onHover}
      className={cn(ROW, active && "bg-menu-item-hover-bg")}
    >
      <Lead item={item} />

      {oneLine ? (
        <>
          <span className="text-small min-w-0 truncate font-medium text-text-primary">
            <Marked text={item.title} pattern={pattern} />
          </span>
          {item.subtitle ? (
            <span className="text-caption min-w-0 flex-1 truncate italic text-text-muted">
              <Marked text={item.subtitle} pattern={pattern} />
            </span>
          ) : (
            <span className="flex-1" aria-hidden />
          )}
        </>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-small truncate font-medium text-text-primary">
            <Marked text={item.title} pattern={pattern} />
          </span>
          {item.snippet ? (
            // The feature's only innerHTML: the sanitiser's output, never the wire string.
            <span
              className="text-caption truncate text-text-secondary"
              dangerouslySetInnerHTML={{ __html: sanitizeSnippet(item.snippet) }}
            />
          ) : item.subtitle ? (
            <span className="text-caption truncate text-text-muted">
              <Marked text={item.subtitle} pattern={pattern} />
            </span>
          ) : null}
        </span>
      )}

      {meta !== null && (
        <span className="text-micro shrink-0 whitespace-nowrap text-text-muted">{meta}</span>
      )}
      {active && <EnterHint />}
    </button>
  );
}

/** A remembered query; taking it puts it back in the field. */
export function RecentRow({ term, onTake }: { term: string; onTake: () => void }) {
  return (
    <button type="button" onClick={onTake} className={ROW}>
      <GlyphTile icon={Clock3} />
      <span className="text-small min-w-0 flex-1 truncate text-text-primary">{term}</span>
    </button>
  );
}
