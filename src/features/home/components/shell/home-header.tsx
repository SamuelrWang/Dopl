import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { SearchItem } from "@/features/search/contracts";
import { HeaderSearch } from "@/features/search/components/header-search";
import { apiSearchFetcher } from "@/features/search/search-client";
import { HomeHeaderRow } from "./home-frame";
import {
  HomeSettingsControl,
  type HomeIdentity,
  type HomeViewer,
} from "./home-settings-control";
import { HOME_TABS, type HomeTab } from "@/features/home/tabs";

const NEW_CHANNEL_BTN = cn(pillButton("ink", "lg"), "pl-3");

/**
 * /home's header strip: New channel over the channel column, the face tabs, then search and the
 * operator's Profile pill. No state lives here; every value is the page's. Declared in `src/` so
 * the UI-staging playground mounts the same header.
 */
export function HomeHeader<T extends string = HomeTab>({
  identity,
  viewer,
  onWorkspaceChanged,
  tab,
  onTabChange,
  query,
  onQueryChange,
  onSearchNavigate,
  onNewChannel,
  onNavigate,
  tabOptions,
}: {
  identity: HomeIdentity;
  viewer: HomeViewer | null;
  onWorkspaceChanged: () => void;
  tab: T;
  onTabChange: (next: T) => void;
  /** The tab set; absent = {@link HOME_TABS}. The UI-staging playground mocks a page here
   *  before it joins the product's set. */
  tabOptions?: ReadonlyArray<{ key: T; label: string }>;
  query: string;
  onQueryChange: (next: string) => void;
  /** A search-popup row was taken; the page opens what it names. */
  onSearchNavigate: (item: SearchItem) => void;
  onNewChannel: () => void;
  /** The host router's navigate (the settings modal's workspace switches). */
  onNavigate: (path: string) => void;
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
        <SegmentedControl<T>
          options={tabOptions ?? (HOME_TABS as unknown as ReadonlyArray<{ key: T; label: string }>)}
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
            onNavigate={onNavigate}
          />
        </>
      }
    />
  );
}
