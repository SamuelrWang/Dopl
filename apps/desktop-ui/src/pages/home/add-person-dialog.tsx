import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { SelectMenu } from "@/shared/ui/select-menu";
import {
  DialogActions,
  DialogField,
  DIALOG_BTN_PRIMARY,
  DIALOG_BTN_SECONDARY,
  StandardDialog,
} from "@/shared/ui/standard-dialog";
import { RAISED_WELL } from "@/shared/ui/wells";
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
 * ⚠ A DIALOG, NOT A POPOVER (Samuel, 2026-08-27 — this file was
 * `add-person-popover.tsx`). It is one of the four /home creation surfaces, and
 * they share ONE chrome: `shared/ui/standard-dialog.tsx › StandardDialog` — the
 * narrow width, the centered uppercase heading, the raised dropdown face and
 * the fully-rounded footer pair. A menu card hanging off the button was the
 * only one of the four that read as chrome rather than as a form.
 *
 * ⚠ IT LIVES ON THE CHANNEL, NOT IN THE PAGE HEADER (Samuel, 2026-08-25). A
 * link is BOUND to its container, so the act belongs to the channel it acts on
 * — its Info tab — and `workspaceId` is required rather than nullable because
 * the only render site is a channel's own panel. The header's one primary
 * action is "New channel".
 *
 * ⚠ RENDERED AT EVERY ROSTER SIZE (2026-08-26, Samuel's ruling: a home channel
 * takes MORE THAN TWO people). It used to render only for a SOLO channel, when
 * a container held two members and a mint against a full one 409'd; the caller
 * (`person-members.tsx`) no longer gates on `peer`, and there is still no
 * disabled state here because there is still no reachable refusal to show. What
 * the caller DOES gate on is an already-open invitation — one section, two
 * states, never both.
 *
 * ⚠ THE "USES" PICKER IS GONE, not disabled: a bound link admits ONE named
 * person, so the server pins `maxUses: 1` and a multi-use choice names an
 * outcome the schema no longer has a field for. **Adding the next person is
 * pressing this button again**, which is why it says "Create another" once a
 * link is on screen.
 *
 * ⚠ `expiresAt` is computed HERE, as an absolute ISO instant, because that is
 * what the route validates (`schema.ts` refuses a past one). The picker's
 * windows are relative; the server never sees "7 days".
 */
export function AddPersonDialog({ workspaceId }: { workspaceId: string }) {
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
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="auth-btn-3d flex h-9 cursor-pointer items-center rounded-full px-[15px] text-small font-semibold text-white"
      >
        Add person
      </button>
      <StandardDialog open={open} onClose={close} title="Add person">
        {url && (
          <div
            className={cn(
              RAISED_WELL,
              "flex items-center gap-2 px-3 py-2 font-mono text-small text-text-primary"
            )}
          >
            <span className="min-w-0 flex-1 truncate">{displayUrl(url)}</span>
            <CopyButton text={url} label="Copy link" />
          </div>
        )}

        <DialogField label="Access level">
          <SelectMenu
            ariaLabel="Access level"
            value={role}
            options={ROLE}
            onChange={setRole}
            variant="raised"
            className="w-full justify-between"
          />
        </DialogField>

        <DialogField label="Link expiry">
          <SelectMenu
            ariaLabel="Link expiry"
            value={expiry}
            options={EXPIRY}
            onChange={setExpiry}
            variant="raised"
            className="w-full justify-between"
          />
        </DialogField>

        {/* ⚠ A TERNARY, not `&&`: the hook types `error` as `unknown`, and
            `unknown && <jsx/>` is `unknown` — not a ReactNode. */}
        {mint.error ? (
          <p className="text-caption text-danger" role="alert">
            {errorMessage(mint.error)}
          </p>
        ) : null}

        <DialogActions>
          <button
            type="button"
            className={DIALOG_BTN_SECONDARY}
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={create}
            disabled={mint.pending}
            className={DIALOG_BTN_PRIMARY}
          >
            {url ? "Create another" : "Create link"}
          </button>
        </DialogActions>
      </StandardDialog>
    </>
  );
}
