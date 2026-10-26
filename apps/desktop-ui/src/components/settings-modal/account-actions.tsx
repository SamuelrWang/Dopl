import { ExternalLink } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SMALL_PILL_BUTTON, SMALL_PILL_ICON } from "@/shared/ui/small-action-button";
import {
  SettingsPanel,
  SettingsRow,
  SettingsRows,
} from "@/shared/layout/settings-modal/sections/settings-panel";
import { getBridge } from "#/lib/dopl-bridge";
import { accountPagePath, openInBrowser } from "#/lib/open-in-browser";

/**
 * Desktop Account pane footer — replaces the web section's `DeleteAccount`.
 *
 * ⚠ Sign-out belongs to MAIN (it holds the session; the renderer holds no token
 * it could drop), so the row HIDES ITSELF when `signOut` is absent rather
 * than pretending. Deletion stays web-only: irreversible, and its Supabase
 * sign-out + redirect is not reproducible here.
 */
export function AccountActions({ workspaceSegment }: { workspaceSegment: string }) {
  const bridge = getBridge();
  const canSignOut = typeof bridge?.signOut === "function";

  return (
    <SettingsPanel id="settings-account-session" label="Session">
      <SettingsRows label="Session">
        {canSignOut && (
          <SettingsRow title="Sign out">
            <button
              type="button"
              onClick={() => void bridge?.signOut?.()}
              className={SMALL_PILL_BUTTON}
            >
              Sign out
            </button>
          </SettingsRow>
        )}
        <SettingsRow title="Delete account">
          {/* `/billing/{segment}` (`src/app/billing/[segment]/page.tsx`) carries the account danger zone. */}
          <button
            type="button"
            onClick={() => openInBrowser(accountPagePath(workspaceSegment))}
            className={cn(SMALL_PILL_BUTTON, "text-danger")}
          >
            Open in browser
            <ExternalLink size={SMALL_PILL_ICON} aria-hidden="true" />
          </button>
        </SettingsRow>
      </SettingsRows>
    </SettingsPanel>
  );
}
