import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { Popover } from "@/shared/ui/popover-menu";
import { SelectMenu } from "@/shared/ui/select-menu";
import { FIELD_WELL } from "@/shared/ui/wells";
import { errorMessage } from "#/components/page-states";
import { displayUrl } from "./home-rows";
import {
  expiresAtFrom,
  useMintHomeLink,
  type LinkExpiryKey,
} from "./home-writes";

const EXPIRY: ReadonlyArray<{ value: LinkExpiryKey; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "24h", label: "24 hours" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "No expiry" },
];

/** The role the link GRANTS at claim. Default `guest` (chat only); `member` is
 *  the full-channel grant. Viewer is schema-valid but deliberately not offered
 *  (Samuel's ruling) — the two ends of the range are the choice worth making. */
type GrantRole = "guest" | "member";
const ROLE: ReadonlyArray<{ value: GrantRole; label: string }> = [
  { value: "guest", label: "Guest — chat only" },
  { value: "member", label: "Member — full channel" },
];

/**
 * ADD A PERSON to a channel that already exists. The link IS the invite: copy
 * it, send it anywhere; they join THIS channel when they claim it.
 *
 * ⚠ IT LIVES ON THE CHANNEL, NOT IN THE PAGE HEADER (Samuel, 2026-08-25). A
 * link is BOUND to its container, so the act belongs to the channel it acts on
 * — its Info tab — and `workspaceId` is required rather than nullable because
 * the only render site is a channel's own panel. The header's one primary
 * action is "New channel".
 *
 * ⚠ RENDERED ONLY FOR A SOLO CHANNEL. A container holds two people, so one that
 * already has a peer has no seat to offer and the mint would 409 — the caller
 * gates on `peer === null` (`person-info-tab.tsx`), and no disabled state is
 * kept here for a case that cannot be reached.
 *
 * ⚠ THE "USES" PICKER IS GONE, not disabled: a bound link fills the channel's
 * one free seat, so the server pins `maxUses: 1` and a multi-use choice names
 * an outcome the schema no longer has a field for.
 *
 * ⚠ `expiresAt` is computed HERE, as an absolute ISO instant, because that is
 * what the route validates (`schema.ts` refuses a past one). The picker's
 * windows are relative; the server never sees "7 days".
 */
export function AddPersonPopover({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [expiry, setExpiry] = useState<LinkExpiryKey>("7d");
  const [role, setRole] = useState<GrantRole>("guest");
  const [url, setUrl] = useState<string | null>(null);
  const mint = useMintHomeLink(setUrl);

  const create = () =>
    mint.mutate({
      workspaceId,
      grantedRole: role,
      expiresAt: expiresAtFrom(expiry),
    });

  const close = () => {
    setOpen(false);
    setUrl(null);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="auth-btn-3d flex h-9 cursor-pointer items-center rounded-full px-[15px] text-small font-semibold text-white"
      >
        Add person
      </button>
      <Popover open={open} onClose={close} align="left" className="w-[300px]">
        <div className="px-2.5 pb-2.5 pt-2">
          {url && (
            <div
              className={cn(
                FIELD_WELL,
                "mb-2.5 flex items-center gap-2 px-3 py-2 font-mono text-small text-text-primary"
              )}
            >
              <span className="min-w-0 flex-1 truncate">{displayUrl(url)}</span>
              <CopyButton text={url} label="Copy link" />
            </div>
          )}
          <SelectMenu
            ariaLabel="Access level"
            value={role}
            options={ROLE}
            onChange={setRole}
          />
          <div className="h-2" />
          <SelectMenu
            ariaLabel="Link expiry"
            value={expiry}
            options={EXPIRY}
            onChange={setExpiry}
          />
          {mint.error ? (
            <p className="mt-2 text-caption text-danger" role="alert">
              {errorMessage(mint.error)}
            </p>
          ) : null}
          <button
            type="button"
            onClick={create}
            disabled={mint.pending}
            className="auth-btn-3d mt-2.5 w-full rounded-[8px] px-3.5 py-1.5 text-small text-text-on-cta disabled:opacity-60"
          >
            {url ? "Create another" : "Create link"}
          </button>
        </div>
      </Popover>
    </div>
  );
}
