"use client";

import { useId, useState, useSyncExternalStore } from "react";
import {
  Check,
  Rocket,
  ShieldQuestion,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { getDesktopChannelFolders } from "@/shared/lib/desktop";
import { getDesktopPermissionPresets } from "../hooks/use-channel-permission-preset";
import { RequestPermissionRow } from "./permission-preset-row";
import { RequestFolderRow } from "./request-folder-row";
import type { ChannelConsentRequest } from "../types";

interface Props {
  request: ChannelConsentRequest;
  /** Launch (inbound) / Send (outbound). ⚠ The SAME consent decision the
   *  retired card's Allow made — `PATCH /consent/[id]` with `"allow"`. */
  onLaunch: () => void;
  /** Decline (inbound) / Cancel (outbound) — the `"deny"` decision. */
  onDecline: () => void;
  busy?: boolean;
}

/** Shown when a requester has no hydrated name — used for BOTH the avatar
 *  initial and the headline so they can never disagree (no "?" next to a
 *  named line). */
const UNKNOWN_REQUESTER = "A teammate";

/**
 * ⚠ THE HEADING OVER THE LAUNCH SETTINGS, and it is a rule, not a caption.
 * The permission preset underneath is an ARM, not a setting: single use,
 * expiring, one consumer (`main/channel-prefs.js`; INVARIANTS §11). A panel
 * called "launch settings" is exactly the surface that drifts into presenting
 * it as a stored preference, and one card's `bypass` silently re-arming every
 * later session on the channel is the bug that rule exists to stop.
 * **Never "for this channel", never "always".** `launch-panel.test.tsx` pins
 * both halves.
 */
export const LAUNCH_SETTINGS_HEADING = "For the next request you allow";

/**
 * Is there anything for the disclosure to open ONTO? Both launch settings are
 * desktop-only and each renders nothing without its own bridge, so this asks
 * the SAME two feature detectors the rows themselves ask — it does not mount a
 * second copy of their state, and it does not invent a third way to decide
 * whether the desktop is present.
 *
 * ⚠ Window-only, so the caller reads it AFTER mount: SSR and the first client
 * render must agree, exactly as `use-channel-folder.ts` and
 * `use-channel-permission-preset.ts` do it.
 */
function desktopLaunchSettingsExist(): boolean {
  return (
    getDesktopChannelFolders() !== null || getDesktopPermissionPresets() !== null
  );
}

/** A preload either exposed the bridges before the page ran or it never will —
 *  there is nothing to subscribe to, so the store never notifies. */
const NEVER_CHANGES = () => () => {};

/** What the SERVER (and the hydrating first client render) sees: no desktop.
 *  Same answer the sibling hooks give on their first paint. */
const NO_SETTINGS_ON_THE_SERVER = () => false;

/**
 * A pending human-in-the-loop decision, as the ADDRESSEE sees it: **Launch
 * agent**, not Allow (INVARIANTS §6 — the verb is the launch, because what a
 * yes does is start somebody's agent on this machine; the ruling arrived in the
 * port's intent doc, deleted at the Phase 12 cutover).
 *
 * ⚠ THE SURFACE CHANGED; THE AUTHORIZATION MODEL DID NOT (INVARIANTS §6). This
 * panel writes the SAME consent decision `consent-card.tsx` wrote — the same
 * server-side row, the same 24h TTL, the same compare-and-swap on
 * `status = 'pending'`, the same `(operator, channel, kind, message_seq)`
 * de-dupe key, and the same `consent-service.ts › revalidateAutoAllow` on the
 * way out. Nothing about consent was replaced or relaxed; a different word sits
 * on the button and the desktop-only rows moved behind a disclosure.
 *
 * ⚠ NO TRUST, ANYWHERE IN HERE. "Auto-launch with saved settings for this
 * person" is the shape trust would take in this flow and Samuel has put it ON
 * HOLD (INVARIANTS §6). `POST /trust` / `DELETE /trust` stay
 * `sessionOnly` and stay unreferenced by this file — the seam is left open and
 * nothing is built into it.
 *
 * Inbound = a teammate's agent is asking to run something on your machine
 * (launch or decline before it spawns); outbound = your own agent drafted a
 * reply awaiting Send before it leaves. The verbatim summary + full body are
 * shown so the decision is informed, never a blind yes: the body sits in a
 * scrollable well rather than a clamp, because approving text you cannot read
 * is not consent.
 *
 * ⚠ TWO CLICKS, AND THAT IS THE DESIGN. The first "Launch agent" EXPANDS the
 * panel into the launch settings (MAPPING: "clicking it EXPANDS the panel into
 * launch settings … then a launch"); the second, made with the settings on
 * screen, is the decision. When there are no settings to show — a plain
 * browser, or an older desktop build without either bridge — there is no
 * disclosure and the FIRST click decides, because a disclosure that opens onto
 * nothing is worse than none.
 *
 * ⚠ THE SETTINGS ARE THE TWO EXISTING AXES PLUS THE FOLDER, and no more. Tool
 * use and message-sending permissions are `permission-preset-row.tsx`'s two
 * axes ({@link RequestPermissionRow}); the working folder is
 * {@link RequestFolderRow}. The mock imagines a wider set ("permission bypass"
 * as its own control); `bypass` is a VALUE on the tools axis, not a third axis,
 * and no new permission axis is invented here — a control the desktop cannot
 * consume would be a claim about containment that nothing enforces.
 */
export function LaunchPanel({ request, onLaunch, onDecline, busy }: Props) {
  const isInbound = request.kind === "inbound";
  const requester = request.requesterName || UNKNOWN_REQUESTER;
  const preview = isInbound ? request.bodyPreview : request.proposedReply ?? "";
  const settingsId = useId();
  const [expanded, setExpanded] = useState(false);
  // ⚠ Hydration-safe by the SAME rule the sibling hooks follow — the server
  // (and the hydrating first client render) is told there is no desktop, and
  // the real answer lands after. The MECHANISM differs on purpose:
  // `use-channel-folder.ts` and `use-channel-permission-preset.ts` do it with
  // `useState` + a mount effect, which `react-hooks/set-state-in-effect`
  // rejects in a component this simple. `useSyncExternalStore` is React's own
  // answer for reading a value that lives outside React and never changes —
  // no cascading render, and the server snapshot is explicit rather than an
  // initial-state coincidence.
  const hasSettings = useSyncExternalStore(
    NEVER_CHANGES,
    desktopLaunchSettingsExist,
    NO_SETTINGS_ON_THE_SERVER
  );

  const disclosable = isInbound && hasSettings;

  return (
    <div className="rounded-[10px] border border-warning/25 bg-warning/10 px-3.5 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        {isInbound ? (
          <Avatar
            person={{
              userId: request.requesterUserId ?? requester,
              email: null,
              displayName: requester,
              avatarUrl: request.requesterAvatarUrl,
            }}
            size="xs"
          />
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-inset text-text-secondary">
            <Sparkles size={12} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-caption font-medium text-text-primary">
          {isInbound
            ? `${requester}'s agent is asking`
            : "Your agent wants to reply"}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
          <ShieldQuestion size={11} />
          {isInbound ? "To launch" : "To send"}
        </span>
      </div>

      {request.summary && (
        <p className="mb-1 text-body leading-relaxed text-text-primary">
          {request.summary}
        </p>
      )}
      {preview && (
        <div className="concave-field mb-2 max-h-[200px] overflow-y-auto rounded-[8px] px-2.5 py-2">
          <p className="whitespace-pre-wrap break-words text-caption leading-relaxed text-text-secondary">
            {preview}
          </p>
        </div>
      )}

      {isInbound && (
        <p className="mb-2.5 flex items-start gap-1.5 text-caption leading-relaxed text-text-secondary">
          <TerminalSquare size={12} className="mt-0.5 shrink-0" />
          <span>Launching runs a Claude session on this machine.</span>
        </p>
      )}

      {disclosable && (
        <LaunchSettings id={settingsId} channelId={request.channelId} open={expanded} />
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          aria-expanded={disclosable ? expanded : undefined}
          aria-controls={disclosable ? settingsId : undefined}
          onClick={() => {
            if (disclosable && !expanded) {
              setExpanded(true);
              return;
            }
            onLaunch();
          }}
          className={cn(
            "btn-light flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-small font-medium text-text-primary disabled:opacity-60"
          )}
        >
          {isInbound ? <Rocket size={14} /> : <Check size={14} />}
          {isInbound ? "Launch agent" : "Send"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          className="flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-small font-medium text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary disabled:opacity-60"
        >
          <X size={14} />
          {isInbound ? "Decline" : "Cancel"}
        </button>
        <span className="flex-1" />
        <span className="shrink-0 text-micro text-text-muted">
          {formatChannelTimestamp(request.createdAt)}
        </span>
      </div>
    </div>
  );
}

/**
 * The expanding launch settings: WHAT the session may do (the two permission
 * axes) and WHERE it runs (the working folder), chosen BEFORE the launch so the
 * spawned session starts on the posture that was approved, instead of the
 * operator only being able to correct it once the agent is already running.
 *
 * Height animates through the grid-rows 0fr→1fr idiom borrowed from the v2
 * composer's agent panel — the content decides how far the panel grows and no
 * layout number is hardcoded. `motion-reduce` snaps, and a closed region is
 * `inert`, so a collapsed dropdown is not tabbable.
 *
 * ⚠ Both children are desktop-only and each renders nothing without its bridge;
 * the caller only mounts this region once at least one of them exists.
 */
function LaunchSettings({
  id,
  channelId,
  open,
}: {
  id: string;
  channelId: string;
  open: boolean;
}) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className="overflow-hidden" inert={!open}>
        <section id={id} aria-label="Launch settings">
          {/* ⚠ THE ARM'S HEADING — see LAUNCH_SETTINGS_HEADING. */}
          <p className="mb-1.5 text-micro font-medium uppercase tracking-wide text-text-secondary">
            {LAUNCH_SETTINGS_HEADING}
          </p>
          {/* `items-start` because each child carries its own bottom margin —
              the pills top-align regardless. */}
          <div className="flex flex-wrap items-start gap-x-2">
            <RequestPermissionRow channelId={channelId} />
            <RequestFolderRow channelId={channelId} />
          </div>
        </section>
      </div>
    </div>
  );
}
