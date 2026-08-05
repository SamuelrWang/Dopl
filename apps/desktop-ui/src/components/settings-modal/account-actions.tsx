import { ExternalLink } from "lucide-react";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { cn } from "@/shared/lib/utils";
import { getBridge } from "#/lib/dopl-bridge";
import { accountPagePath, openInBrowser } from "#/lib/open-in-browser";

/**
 * The desktop Account pane's footer — what replaces the web section's
 * `DeleteAccount`.
 *
 * Sign-out belongs to MAIN: it holds the session and the renderer holds no
 * token it could drop, so the button is a thin call to `window.dopl.signOut()`
 * and HIDES ITSELF when that op is absent (an older main) rather than
 * pretending to have signed the user out. Deletion stays web-only — it is
 * irreversible, and the flow it runs (Supabase sign-out + redirect) is not
 * reproducible here — so it links out instead.
 */
export function AccountActions({ workspaceSegment }: { workspaceSegment: string }) {
  const bridge = getBridge();
  const canSignOut = typeof bridge?.signOut === "function";

  return (
    <section className="w-full overflow-hidden rounded-[14px] border border-border-strong">
      <div className="flex items-center bg-card-surface-subtle px-4 py-1.5">
        <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
          Session
        </span>
      </div>
      <div className={cn(SECTION_BOX_INSET, "space-y-3 p-4")}>
        {canSignOut && (
          <button
            type="button"
            onClick={() => void bridge?.signOut?.()}
            className="btn-light cursor-pointer rounded-md px-2.5 py-1.5 text-small font-medium text-text-primary"
          >
            Sign out
          </button>
        )}
        <p className="text-caption text-text-secondary">
          Deleting your account is permanent, so it stays in the browser. The
          button below opens the page that does it.
        </p>
        <button
          type="button"
          // `/billing/{segment}` — the post-retirement billing + account page
          // (`src/app/billing/[segment]/page.tsx`), which carries the account
          // danger zone. It used to open `/{segment}/canvas` and ask the user
          // to find Settings → Account in a modal; that whole tree is being
          // deleted (docs/migration-research/website-retirement-plan.md, D4).
          onClick={() => openInBrowser(accountPagePath(workspaceSegment))}
          className="btn-light flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-small font-medium text-danger"
        >
          Delete account in browser
          <ExternalLink size={12} />
        </button>
      </div>
    </section>
  );
}
