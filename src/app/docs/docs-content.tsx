"use client";

import type { TocEntry } from "./docs-primitives";
import { GettingStartedSection, TOC as gsToc } from "./sections/getting-started";
import { CanvasSection, TOC as canvasToc } from "./sections/canvas";
import { ClustersSection, TOC as clustersToc } from "./sections/clusters";
import { McpServerSection, TOC as mcpToc } from "./sections/mcp-server";

export type { TocEntry };

export interface SectionDef {
  toc: TocEntry[];
  component: () => React.JSX.Element;
}

export const SECTIONS: Record<string, SectionDef> = {
  "getting-started": { toc: gsToc, component: GettingStartedSection },
  "the-canvas": { toc: canvasToc, component: CanvasSection },
  "clusters": { toc: clustersToc, component: ClustersSection },
  "mcp-server": { toc: mcpToc, component: McpServerSection },
};
