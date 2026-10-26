"use client";

import type { ReactNode } from "react";
import { PanelRight, Pin } from "lucide-react";
import { Breadcrumb } from "@/shared/ui/breadcrumb";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { cn } from "@/shared/lib/utils";
import { IconButton } from "./bits";

/**
 * The center column's header in both chromes: the shared `Breadcrumb` at the title step (channel,
 * then the open thread, the channel crumb being the way back out). A lone channel name wears
 * `IDENTITY_NAME_TEXT` by import, never re-typed; the pop-out `h1` keeps its own type.
 */
export function PaneHeader({
  channelName,
  hideChannelCrumb = false,
  threadTitle,
  infoOpen = false,
  favorited,
  popOut,
  chrome,
  viewSelect,
  transcriptFilter,
  onToggleInfo,
  onToggleFavorite,
  onExitThread,
}: {
  channelName: string;
  /** Hides the visible channel crumb only (the pin's label still names the channel); ignored in a
   *  thread, where the crumb is the way back out. */
  hideChannelCrumb?: boolean;
  threadTitle: string | null;
  infoOpen?: boolean;
  favorited: boolean;
  popOut?: ReactNode;
  chrome: "page" | "window";
  /** The web's view dropdown; present replaces the info toggle rather than sitting beside it. */
  viewSelect?: ReactNode;
  /** Transcript filter slot (`transcript-filter.tsx › TranscriptFilterSelect`), right of `popOut` and
   *  left of the toggle; a slot because it needs rows this header doesn't hold. */
  transcriptFilter?: ReactNode;
  onToggleInfo?: () => void;
  onToggleFavorite: () => void;
  onExitThread: () => void;
}) {
  // Pop-out window: the title only; every page control acts on something this window lacks.
  if (chrome === "window") {
    return (
      <header className="flex h-[56px] shrink-0 items-center gap-1.5 border-b border-border-default px-4">
        <h1 className="truncate text-body font-semibold text-text-primary">
          {threadTitle ?? channelName}
        </h1>
      </header>
    );
  }

  return (
    <header className="flex h-[56px] shrink-0 items-center gap-1 border-b border-border-default px-4">
      <Breadcrumb
        className="text-title"
        items={
          threadTitle === null
            ? hideChannelCrumb
              ? []
              : [
                  {
                    key: "channel",
                    label: <span className={IDENTITY_NAME_TEXT}>{channelName}</span>,
                  },
                ]
            : [
                { key: "channel", label: channelName, onSelect: onExitThread },
                { key: "thread", label: threadTitle },
              ]
        }
      />
      {/* The pin IS the channel favourite (`channel_members.favorited_at`); its label names the channel.
          `bare` drops the button face; `className` wins in `cn` for the 24px box and the `text-warning` token. */}
      <IconButton
        icon={Pin}
        label={favorited ? `Unpin ${channelName}` : `Pin ${channelName}`}
        size={14}
        bare
        className={cn("h-6 w-6", favorited && "text-warning")}
        active={favorited}
        filled={favorited}
        onClick={onToggleFavorite}
      />
      <span className="flex-1" />
      {/* Thread view only — it pops out the open thread. */}
      {threadTitle !== null && popOut}
      {transcriptFilter}
      {/* Label stays "Channel info": tests address the toggle by that name. */}
      {viewSelect ?? (
        <IconButton
          icon={PanelRight}
          label="Channel info"
          bare
          active={infoOpen}
          onClick={onToggleInfo}
        />
      )}
    </header>
  );
}
