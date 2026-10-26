"use client";

/**
 * STAGING COPY of `marketing/components/banner-demo/demo-home-faces.tsx › DemoTopBar`.
 *
 * Copied, not imported, because the original hard-codes the selected tab to
 * "channels" and renders every tab as an inert `<span>`. Here the selected tab is
 * a prop and each staged face is a real link to its staging route, so Samuel can
 * hop between the staged pages. The search and profile pills are buttons: search swaps in the
 * desktop's search field + popup (`popups-staging › StagingSearchField`) in place, profile opens
 * Settings (both wired by `staging-frame.tsx` through `staging-popups-provider.tsx`). Markup and
 * class names are otherwise identical (`marketing.css › .lp-demo-top*`).
 */

import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { HOME_TABS, type HomeTab } from "@/features/home/tabs";
import type { AvatarPerson } from "@/shared/ui/avatar";
import { StagingSearchField } from "@/features/popups-staging/staging-popups";

/** DEFAULT staged route for each /home face (overridable via `tabHrefs`). A tab
 *  with no href renders as an inert span. */
export const STAGING_ROUTES: Partial<Record<HomeTab, string>> = {
  // The PUBLIC aliases (`src/app/playground/<face>/page.tsx`): `/playground` is a public
  // prefix, so tab hops never bounce a signed-out visitor to /login. The top-level routes
  // (`/overview`, `/channels`, …) still exist and render the same pages when signed in.
  overview: "/playground/overview",
  channels: "/playground/channels",
  knowledge: "/playground/knowledge",
  identities: "/playground/identities",
  ontology: "/playground/ontology",
};

export function StagingTopBar({
  viewer,
  tab,
  onNew,
  newLabel = "New channel",
  tabHrefs = STAGING_ROUTES,
  searchOpen = false,
  onSearch,
  onSearchClose,
  onProfile,
}: {
  viewer: AvatarPerson;
  /** The face this staging page shows; its tab is underlined. */
  tab: HomeTab;
  /** Optional handler for the lead pill (the demo's "New channel"). */
  onNew?: () => void;
  newLabel?: string;
  /** Where each tab links. Default `STAGING_ROUTES`; pass `{}` for inert tabs. */
  tabHrefs?: Partial<Record<HomeTab, string>>;
  /** STAGING: the search field is open in place of the pill. */
  searchOpen?: boolean;
  /** STAGING: the search pill's click (absent = inert pill). */
  onSearch?: () => void;
  onSearchClose?: () => void;
  /** STAGING: the profile pill's click (absent = inert pill). */
  onProfile?: () => void;
}) {
  const first = (viewer.displayName ?? "").split(/\s+/)[0] || "Profile";
  return (
    <div className="lp-demo-top">
      <div className="lp-demo-top-lead">
        <span className="lp-demo-top-cell">
          {onNew ? (
            <button type="button" className="lp-demo-top-new" onClick={onNew}>
              <Plus size={14} strokeWidth={2.2} aria-hidden />
              {newLabel}
            </button>
          ) : (
            <span className="lp-demo-top-new">
              <Plus size={14} strokeWidth={2.2} aria-hidden />
              {newLabel}
            </span>
          )}
        </span>
        <span className="lp-demo-top-tabs">
          {HOME_TABS.map((t) => {
            const href = tabHrefs[t.key];
            const selected = t.key === tab ? "true" : undefined;
            return href ? (
              <Link
                key={t.key}
                href={href}
                className="lp-demo-top-tab"
                data-selected={selected}
              >
                {t.label}
              </Link>
            ) : (
              <span
                key={t.key}
                className="lp-demo-top-tab"
                data-selected={selected}
                data-disabled="true"
                title="No staging page for this face"
              >
                {t.label}
              </span>
            );
          })}
        </span>
      </div>
      {/* `uis-top-trail` makes this `home-header.tsx`'s positioned action group: the search
          popup spans pill-left to Profile-right. */}
      <div className="lp-demo-top-trail uis-top-trail">
        {searchOpen && onSearchClose ? (
          <StagingSearchField onClose={onSearchClose} />
        ) : onSearch ? (
          <button type="button" className="lp-demo-top-search" onClick={onSearch}>
            <Search size={14} strokeWidth={2} aria-hidden />
            Search…
          </button>
        ) : (
          <span className="lp-demo-top-search">
            <Search size={14} strokeWidth={2} aria-hidden />
            Search…
          </span>
        )}
        {onProfile ? (
          <button type="button" className="lp-demo-top-profile" title="Profile" onClick={onProfile}>
            <ProfileFace viewer={viewer} first={first} />
          </button>
        ) : (
          <span className="lp-demo-top-profile" title="Profile">
            <ProfileFace viewer={viewer} first={first} />
          </span>
        )}
      </div>
    </div>
  );
}

function ProfileFace({ viewer, first }: { viewer: AvatarPerson; first: string }) {
  return (
    <>
      {viewer.avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- bundled avatar
        <img src={viewer.avatarUrl} alt="" draggable={false} />
      )}
      {first}
    </>
  );
}
