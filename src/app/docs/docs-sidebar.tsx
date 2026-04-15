"use client";

import { useState } from "react";

export interface DocSection {
  id: string;
  title: string;
  items: { id: string; title: string }[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    items: [
      { id: "what-is-dopl", title: "What is Dopl" },
      { id: "quick-start", title: "Quick start" },
      { id: "key-concepts", title: "Key concepts" },
    ],
  },
  {
    id: "the-canvas",
    title: "The Canvas",
    items: [
      { id: "navigating", title: "Navigating" },
      { id: "panels", title: "Panels" },
      { id: "multi-select", title: "Multi-select" },
      { id: "keyboard-shortcuts", title: "Keyboard shortcuts" },
    ],
  },
  {
    id: "ingestion",
    title: "Ingestion",
    items: [
      { id: "supported-sources", title: "Supported sources" },
      { id: "how-ingestion-works", title: "How ingestion works" },
      { id: "generated-artifacts", title: "Generated artifacts" },
    ],
  },
  {
    id: "clusters",
    title: "Clusters",
    items: [
      { id: "creating-clusters", title: "Creating clusters" },
      { id: "cluster-brain", title: "Cluster brain" },
      { id: "skill-files", title: "Skill files" },
    ],
  },
  {
    id: "search-and-build",
    title: "Search & Build",
    items: [
      { id: "semantic-search", title: "Semantic search" },
      { id: "solution-builder", title: "Solution builder" },
    ],
  },
  {
    id: "mcp-server",
    title: "MCP Server",
    items: [
      { id: "mcp-setup", title: "Setup" },
      { id: "mcp-tools", title: "Available tools" },
      { id: "api-keys", title: "API keys" },
    ],
  },
  {
    id: "chrome-extension",
    title: "Chrome Extension",
    items: [
      { id: "extension-install", title: "Installation" },
      { id: "omnibox", title: "Omnibox search" },
      { id: "context-menu", title: "Context menu" },
    ],
  },
  {
    id: "community",
    title: "Community",
    items: [
      { id: "publishing", title: "Publishing clusters" },
      { id: "browsing-community", title: "Browsing shared setups" },
    ],
  },
];

interface DocsSidebarProps {
  activeId: string;
  onNavigate: (id: string) => void;
}

export function DocsSidebar({ activeId, onNavigate }: DocsSidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function toggle(sectionId: string) {
    setCollapsed((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }

  return (
    <nav className="w-[240px] shrink-0 h-full overflow-y-auto py-8 pr-4 pl-6 border-r border-white/[0.06] scrollbar-discreet">
      <div className="space-y-1">
        {DOC_SECTIONS.map((section) => {
          const isCollapsed = collapsed[section.id];
          const hasActiveChild = section.items.some((item) => item.id === activeId);

          return (
            <div key={section.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggle(section.id)}
                className={`w-full flex items-center justify-between py-1.5 text-[13px] font-semibold tracking-wide transition-colors ${
                  hasActiveChild ? "text-white" : "text-white/60 hover:text-white/80"
                }`}
              >
                {section.title}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                >
                  <path d="M3 4.5L6 7.5L9 4.5" />
                </svg>
              </button>

              {!isCollapsed && (
                <ul className="ml-2 border-l border-white/[0.06] space-y-0.5 pb-2">
                  {section.items.map((item) => {
                    const isActive = item.id === activeId;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => onNavigate(item.id)}
                          className={`block w-full text-left pl-3 py-1 text-[13px] transition-colors rounded-r-sm ${
                            isActive
                              ? "text-white bg-white/[0.06] border-l border-white/40 -ml-px"
                              : "text-white/45 hover:text-white/70"
                          }`}
                        >
                          {item.title}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
