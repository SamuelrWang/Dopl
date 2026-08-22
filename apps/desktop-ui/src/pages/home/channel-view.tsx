import { useState } from "react";
import { AtSign, Clock3, Expand, Paperclip, Smile } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { IconButton } from "@/features/channels/components/channels-v2/bits";
import { Avatar } from "@/shared/ui/avatar";
import { CopyButton } from "@/shared/ui/copy-button";
import { FIELD_WELL, RAISED_WELL } from "@/shared/ui/wells";
import { InfoPanel } from "./info-panel";
import { ME, type ExchangeItem, type HomeChannel } from "./mock";

/**
 * Home's right pane — one relationship's RECORD. Not the workspace transcript:
 * this reads as a ledger of what the two agents exchanged, attributed line by
 * line, with the human interjecting from below. Glass first, keyboard second.
 */
export function ChannelView({ channel }: { channel: HomeChannel }) {
  const [draft, setDraft] = useState("");

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
      {channel.status === "pending" && channel.link ? (
        <PendingLinkBody channel={channel} />
      ) : (
        <>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {channel.feed.map((item, i) => (
              <ExchangeRow key={i} item={item} channel={channel} />
            ))}
          </div>
          {/* THE channels-page composer card, faithfully: `.bento` on pure
              white (Samuel's 2026-08-19 ruling), text row + icon row, black
              Send. Centered with a max width here — Home's record pane is
              wider than the workspace message column. No hairline above. */}
          <div className="shrink-0 px-4 pb-4 pt-1">
            <div className="bento mx-auto flex w-full max-w-[720px] flex-col bg-white px-3 py-2.5">
              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={1}
                    spellCheck={false}
                    aria-label="Message"
                    placeholder="Interject"
                    className="min-w-0 flex-1 resize-none bg-transparent py-1 text-lead text-text-primary outline-none placeholder:text-text-muted"
                  />
                  <IconButton icon={Expand} label="Expand composer" size={14} className="h-6 w-6" />
                </div>
                <div className="flex items-center gap-0.5">
                  <IconButton icon={AtSign} label="Mention" size={15} className="h-6 w-6" />
                  <IconButton icon={Smile} label="Emoji" size={15} className="h-6 w-6" />
                  <IconButton icon={Paperclip} label="Attach file" size={15} className="h-6 w-6" />
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => setDraft("")}
                    className="rounded-[8px] px-2.5 py-1.5 text-caption font-medium text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft("")}
                    disabled={!draft.trim()}
                    className={cn(
                      "auth-btn-3d ml-1 rounded-[8px] px-3.5 py-1.5 text-caption font-semibold text-text-on-cta",
                      !draft.trim() && "cursor-not-allowed opacity-60"
                    )}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      </div>

      <InfoPanel channel={channel} />
    </div>
  );
}

function ExchangeRow({
  item,
  channel,
}: {
  item: ExchangeItem;
  channel: HomeChannel;
}) {
  const first = channel.name.split(" ")[0];

  if (item.kind === "event") {
    return (
      <div className="flex items-center gap-2.5 py-0.5">
        <span className="h-px flex-1 bg-border-subtle" />
        <span className="text-micro text-text-muted">
          {item.text} · {item.time}
        </span>
        <span className="h-px flex-1 bg-border-subtle" />
      </div>
    );
  }

  if (item.kind === "approval") {
    return (
      <div className={cn(RAISED_WELL, "border-warning/40 px-4 py-3")}>
        <div className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
          <Clock3 size={12} className="text-warning" />
          Approval
          <span className="ml-auto font-normal text-micro text-text-muted">
            {item.time}
          </span>
        </div>
        <p className="mt-1 text-body font-medium text-text-primary">{item.text}</p>
        <p className="mt-0.5 text-caption text-text-secondary">{item.detail}</p>
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            className="auth-btn-3d rounded-[8px] px-3.5 py-1.5 text-small text-text-on-cta"
          >
            Approve
          </button>
          <button type="button" className="btn-light rounded-[8px] px-3.5 py-1.5 text-small">
            Decline
          </button>
        </div>
      </div>
    );
  }

  const isAgent = item.kind === "agent";
  const mine = isAgent ? item.side === "yours" : item.side === "you";
  const who = isAgent
    ? mine
      ? "Your agent"
      : `${first}'s agent`
    : mine
      ? ME.name
      : channel.name;

  // Every turn wears its PRINCIPAL's face — an agent line is that person's
  // avatar with an "agent" attribution, never a bot glyph.
  const person = mine
    ? { userId: "me", email: ME.email, displayName: ME.name, avatarUrl: null }
    : {
        userId: channel.id,
        email: channel.email,
        displayName: channel.name,
        avatarUrl: null,
      };

  return (
    <div className="flex gap-2.5">
      <Avatar person={person} size="md" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-body font-semibold text-text-primary">{who}</span>
          {isAgent && (
            <span className="rounded-full border border-border-default bg-bg-inset px-1.5 text-micro text-text-secondary">
              Agent
            </span>
          )}
          {isAgent && item.source && (
            <span className="rounded-full border border-border-default bg-bg-inset px-1.5 text-micro text-text-secondary">
              {item.source}
            </span>
          )}
          <span className="text-micro text-text-muted">{item.time}</span>
        </div>
        <p className="mt-0.5 text-lead leading-relaxed text-text-primary">
          {item.text}
        </p>
      </div>
    </div>
  );
}

function PendingLinkBody({ channel }: { channel: HomeChannel }) {
  const link = channel.link!;
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="bento w-[380px] rounded-[14px] px-5 py-4">
        <div className="text-label font-semibold uppercase tracking-wide text-text-muted">
          Channel link
        </div>
        <div
          className={cn(
            FIELD_WELL,
            "mt-2.5 flex items-center gap-2 px-3 py-2 font-mono text-small text-text-primary"
          )}
        >
          <span className="min-w-0 flex-1 truncate">{link.url}</span>
          <CopyButton text={`https://${link.url}`} label="Copy link" />
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-caption text-text-muted">
          <span>{link.expires}</span>
          <span aria-hidden>·</span>
          <span>{link.uses}</span>
          <span aria-hidden>·</span>
          <span>Sent {channel.lastTime}</span>
        </div>
        <div className="mt-3.5 flex items-center gap-2">
          <button type="button" className="btn-light rounded-[8px] px-3.5 py-1.5 text-small">
            Renew
          </button>
          <button
            type="button"
            className="btn-light rounded-[8px] px-3.5 py-1.5 text-small text-danger"
          >
            Revoke
          </button>
        </div>
      </div>
    </div>
  );
}
