"use client";

import type { TocEntry } from "./docs-primitives";
import { GettingStartedSection, TOC as gsToc } from "./sections/getting-started";
import { CanvasSection, TOC as canvasToc } from "./sections/canvas";
import { IngestionSection, TOC as ingestionToc } from "./sections/ingestion";
import { ClustersSection, TOC as clustersToc } from "./sections/clusters";
import { SearchBuildSection, TOC as searchToc } from "./sections/search-build";
import { McpServerSection, TOC as mcpToc } from "./sections/mcp-server";
import { ChromeExtensionSection, TOC as extensionToc } from "./sections/chrome-extension";
import { CommunitySection, TOC as communityToc } from "./sections/community";

export type { TocEntry };

export interface SectionDef {
  toc: TocEntry[];
  component: () => React.JSX.Element;
}

export const SECTIONS: Record<string, SectionDef> = {
  "getting-started": { toc: gsToc, component: GettingStartedSection },
  "the-canvas": { toc: canvasToc, component: CanvasSection },
  "ingestion": { toc: ingestionToc, component: IngestionSection },
  "clusters": { toc: clustersToc, component: ClustersSection },
  "search-and-build": { toc: searchToc, component: SearchBuildSection },
  "mcp-server": { toc: mcpToc, component: McpServerSection },
  "chrome-extension": { toc: extensionToc, component: ChromeExtensionSection },
  "community": { toc: communityToc, component: CommunitySection },
};
