import { useState } from "react";
import { Link2 } from "lucide-react";
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

const USES = [
  { value: "single", label: "Single use" },
  { value: "multi", label: "Multi use" },
] as const;

type UsesKey = (typeof USES)[number]["value"];

/**
 * Mint-a-link — Home's one primary action. The link IS the invite: copy it,
 * send it anywhere; the relationship opens when it is claimed.
 *
 * ⚠ `expiresAt` is computed HERE, as an absolute ISO instant, because that is
 * what the route validates (`schema.ts` refuses a past one). The picker's
 * windows are relative; the server never sees "7 days".
 */
export function NewLinkPopover() {
  const [open, setOpen] = useState(false);
  const [expiry, setExpiry] = useState<LinkExpiryKey>("7d");
  const [uses, setUses] = useState<UsesKey>("single");
  const [url, setUrl] = useState<string | null>(null);
  const mint = useMintHomeLink(setUrl);

  const create = () =>
    mint.mutate({
      expiresAt: expiresAtFrom(expiry),
      maxUses: uses === "single" ? 1 : null,
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
        className="auth-btn-3d flex items-center gap-2 rounded-[9px] px-4 py-2 text-small text-text-on-cta"
      >
        <Link2 size={14} strokeWidth={2} />
        New link
      </button>
      <Popover open={open} onClose={close} align="right" className="w-[300px]">
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
          <div className="flex items-center gap-2">
            <SelectMenu
              ariaLabel="Link expiry"
              value={expiry}
              options={EXPIRY}
              onChange={setExpiry}
            />
            <SelectMenu
              ariaLabel="Link uses"
              value={uses}
              options={USES}
              onChange={setUses}
            />
          </div>
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
