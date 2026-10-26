import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { PAGE_ACTION_BTN } from "@/shared/ui/page-action-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { SearchItem } from "@/features/search/contracts";
import { HeaderSearch } from "@/features/search/components/header-search";
import { apiSearchFetcher } from "@/features/search/search-client";
import type { BootPayload } from "#/pages/boot/use-boot-state";
import { HomeHeaderRow } from "./home-frame";
import { HomeSettingsControl, type HomeViewer } from "./home-settings-control";
import { HOME_TABS, type HomeTab } from "./home-tabs";

const NEW_CHANNEL_BTN = cn(PAGE_ACTION_BTN, "gap-1.5 pl-3");

/**
 * /home's header strip: New channel over the channel column, the face tabs, then search and the
 * operator's Profile pill. No state lives here; every value is the page's.
 */
export function HomeHeader({
  identity,
  viewer,
  onWorkspaceChanged,
  tab,
  onTabChange,
  query,
  onQueryChange,
  onSearchNavigate,
  onNewChannel,
}: {
  identity: BootPayload;
  viewer: HomeViewer | null;
  onWorkspaceChanged: () => void;
  tab: HomeTab;
  onTabChange: (next: HomeTab) => void;
  query: string;
  onQueryChange: (next: string) => void;
  /** A search-popup row was taken; the page opens what it names. */
  onSearchNavigate: (item: SearchItem) => void;
  onNewChannel: () => void;
}) {
  return (
    <HomeHeaderRow
      lead={
        <button type="button" onClick={onNewChannel} className={NEW_CHANNEL_BTN}>
          <Plus size={14} strokeWidth={2.2} aria-hidden />
          New channel
        </button>
      }
      tabs={
        <SegmentedControl<HomeTab>
          options={HOME_TABS}
          value={tab}
          onChange={onTabChange}
          variant="underline"
          size="lg"
        />
      }
      trail={
        <>
          <HeaderSearch
            query={query}
            onQueryChange={onQueryChange}
            onNavigate={onSearchNavigate}
            fetcher={apiSearchFetcher}
            userId={identity.userId}
          />
          <HomeSettingsControl
            identity={identity}
            viewer={viewer}
            onWorkspaceChanged={onWorkspaceChanged}
          />
        </>
      }
    />
  );
}
