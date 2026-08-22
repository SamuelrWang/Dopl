import { useState } from "react";
import { Link2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { Popover } from "@/shared/ui/popover-menu";
import { SelectMenu } from "@/shared/ui/select-menu";
import { FIELD_WELL } from "@/shared/ui/wells";

const EXPIRY = ["7 days", "24 hours", "30 days", "No expiry"] as const;
const USES = ["Single use", "Multi use"] as const;

/**
 * Mint-a-link — Home's one primary action. The link IS the invite: copy it,
 * send it anywhere; the channel opens when it's claimed. Hardcoded link value
 * until account-owned channels exist server-side.
 */
export function NewLinkPopover() {
  const [open, setOpen] = useState(false);
  const [expiry, setExpiry] = useState<string>(EXPIRY[0]);
  const [uses, setUses] = useState<string>(USES[0]);

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="auth-btn-3d flex items-center gap-2 rounded-[9px] px-4 py-2 text-small text-text-on-cta"
      >
        <Link2 size={14} strokeWidth={2} />
        New link
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="right" className="w-[300px]">
        <div className="px-2.5 pt-2 pb-2.5">
          <div
            className={cn(
              FIELD_WELL,
              "flex items-center gap-2 px-3 py-2 font-mono text-small text-text-primary"
            )}
          >
            <span className="min-w-0 flex-1 truncate">dopl.link/c/nB4tR7wZ</span>
            <CopyButton text="https://dopl.link/c/nB4tR7wZ" label="Copy link" />
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <SelectMenu
              ariaLabel="Link expiry"
              value={expiry}
              options={EXPIRY.map((v) => ({ value: v, label: v }))}
              onChange={setExpiry}
            />
            <SelectMenu
              ariaLabel="Link uses"
              value={uses}
              options={USES.map((v) => ({ value: v, label: v }))}
              onChange={setUses}
            />
          </div>
        </div>
      </Popover>
    </div>
  );
}
