import { Plus } from "lucide-react";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { SearchItem } from "@/features/search/contracts";
import type { BootPayload } from "#/pages/boot/use-boot-state";
import { HomeHeaderRow } from "./home-frame";
import { HomeSettingsControl, type HomeViewer } from "./home-settings-control";
import { HomeSearch } from "./home-search";
import { HOME_TABS, type HomeTab } from "./home-tabs";

/** The page's one primary action: the flat ink pill, hugging its label at the column's head. */
const NEW_CHANNEL_BTN =
  "raise-ink flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-surface-cta pl-3 pr-[15px] text-small font-medium text-text-on-cta";

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
          <HomeSearch
            query={query}
            onQueryChange={onQueryChange}
            onNavigate={onSearchNavigate}
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
