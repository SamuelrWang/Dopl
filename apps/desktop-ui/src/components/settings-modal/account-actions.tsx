import { ExternalLink } from "lucide-react";
import { OpenScaleButton, OPEN_SCALE_ICON } from "@/shared/ui/open-scale-button";
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
            <OpenScaleButton onClick={() => void bridge?.signOut?.()}>Sign out</OpenScaleButton>
          </SettingsRow>
        )}
        <SettingsRow title="Delete account">
          {/* `/billing/{segment}` (`src/app/billing/[segment]/page.tsx`) carries the account danger zone. */}
          <OpenScaleButton
            onClick={() => openInBrowser(accountPagePath(workspaceSegment))}
            className="text-danger"
          >
            Open in browser
            <ExternalLink size={OPEN_SCALE_ICON} aria-hidden="true" />
          </OpenScaleButton>
        </SettingsRow>
      </SettingsRows>
    </SettingsPanel>
  );
}
