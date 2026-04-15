import { H2, H3, P, Table, Callout, SectionHero, type TocEntry } from "../docs-primitives";

export const TOC: TocEntry[] = [
  { id: "navigating", title: "Navigating", level: 2 },
  { id: "panels", title: "Panels", level: 2 },
  { id: "panel-entry", title: "Entry panel", level: 3 },
  { id: "panel-chat", title: "Chat panel", level: 3 },
  { id: "panel-browse", title: "Browse panel", level: 3 },
  { id: "panel-connection", title: "Connection panel", level: 3 },
  { id: "panel-brain", title: "Cluster brain panel", level: 3 },
  { id: "multi-select", title: "Multi-select", level: 2 },
  { id: "keyboard-shortcuts", title: "Keyboard shortcuts", level: 2 },
];

/* ── Panel type cards illustration ─────────────────────────────── */
function PanelTypesIllustration() {
  const panels = [
    { label: "Entry", icon: "M4 2h8l4 4v12a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z", color: "0.15" },
    { label: "Chat", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z", color: "0.12" },
    { label: "Browse", icon: "M3 3h18v18H3V3zm2 4h14M7 3v18", color: "0.10" },
    { label: "Connect", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", color: "0.12" },
    { label: "Brain", icon: "M12 2a8 8 0 018 8c0 3-1.5 5-4 6.5V20h-8v-3.5C5.5 15 4 13 4 10a8 8 0 018-8z", color: "0.15" },
  ];
  return (
    <div className="flex gap-2">
      {panels.map((p) => (
        <div key={p.label} className="w-[72px] rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeOpacity={p.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2">
            <path d={p.icon} />
          </svg>
          <span className="font-mono text-[9px] uppercase tracking-wider text-white/35">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Navigation gesture illustration ───────────────────────────── */
function NavigationIllustration() {
  return (
    <svg width="180" height="120" viewBox="0 0 180 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Canvas area */}
      <rect x="4" y="4" width="172" height="112" rx="6" fill="white" fillOpacity="0.02" stroke="white" strokeOpacity="0.06" />
      {/* Two-finger gesture arrows */}
      <g opacity="0.3">
        <circle cx="60" cy="50" r="6" fill="white" fillOpacity="0.1" />
        <circle cx="80" cy="50" r="6" fill="white" fillOpacity="0.1" />
        <path d="M60 42V32M80 42V32" stroke="white" strokeWidth="1.2" strokeLinecap="round" markerEnd="url(#arrow)" />
        <text x="70" y="72" textAnchor="middle" fill="white" fillOpacity="0.25" fontSize="8" fontFamily="monospace">PAN</text>
      </g>
      {/* Pinch gesture */}
      <g opacity="0.3">
        <circle cx="130" cy="40" r="5" fill="white" fillOpacity="0.1" />
        <circle cx="150" cy="60" r="5" fill="white" fillOpacity="0.1" />
        <path d="M133 43L138 48M147 57L142 52" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
        <text x="140" y="80" textAnchor="middle" fill="white" fillOpacity="0.25" fontSize="8" fontFamily="monospace">ZOOM</text>
      </g>
      {/* Minimap */}
      <rect x="140" y="88" width="30" height="22" rx="2" fill="white" fillOpacity="0.04" stroke="white" strokeOpacity="0.1" />
      <rect x="148" y="92" width="10" height="7" rx="1" stroke="white" strokeOpacity="0.2" strokeWidth="0.8" />
      <text x="155" y="118" textAnchor="middle" fill="white" fillOpacity="0.2" fontSize="7" fontFamily="monospace">MAP</text>
    </svg>
  );
}

export function CanvasSection() {
  return (
    <div className="max-w-[720px]">
      <SectionHero
        label="The Canvas"
        title="Your infinite workspace"
        description="Pan, zoom, drag panels, select groups, and organize your knowledge visually."
      >
        <NavigationIllustration />
      </SectionHero>

      <H2 id="navigating">Navigating</H2>
      <P>
        The canvas is an infinite, zoomable workspace. Three ways to move around:
      </P>
      <Table
        headers={["Method", "How"]}
        rows={[
          ["Trackpad pan", "Two-finger drag (parallel swipe) moves the camera."],
          ["Trackpad zoom", "Pinch to zoom in/out. The zoom anchors to your cursor position."],
          ["Scroll wheel", "Scroll to pan vertically. Hold Shift + scroll to pan horizontally."],
          ["Minimap", "The small overview in the bottom-right corner. Click or drag inside it to jump to that area."],
        ]}
      />
      <P>
        Zoom range is 25% to 400%. The grid in the background adapts its density as you zoom,
        so it stays readable at any level.
      </P>

      <H2 id="panels">Panels</H2>
      <P>
        Everything on the canvas is a panel. There are five types:
      </P>
      <div className="mb-6">
        <PanelTypesIllustration />
      </div>

      <H3 id="panel-entry">Entry panel</H3>
      <P>
        Displays a single knowledge base entry with its README, agents.md, manifest, and tags.
        Entry panels are created automatically when you ingest a URL through a chat panel.
        You can also add entries from the Browse panel. Default size is 520 by 700 pixels.
      </P>

      <H3 id="panel-chat">Chat panel</H3>
      <P>
        A conversation interface for interacting with Dopl. Paste a URL to ingest it, ask
        questions about your knowledge base, or search for setups. Chat panels expire after
        7 days unless you pin them. Pinned chats persist indefinitely.
      </P>

      <H3 id="panel-browse">Browse panel</H3>
      <P>
        A resizable knowledge base browser. Search, filter, and add entries to your canvas
        from here. You can resize it by dragging any edge or corner. Minimum size is 700 by
        400 pixels.
      </P>

      <H3 id="panel-connection">Connection panel</H3>
      <P>
        Shows your API key and MCP server connection instructions. This panel is always
        present on your canvas and cannot be deleted. It is created automatically on first
        login.
      </P>

      <H3 id="panel-brain">Cluster brain panel</H3>
      <P>
        The persistent brain of a cluster. Displays synthesized instructions from all
        member entries, plus any memories you have added. Auto-spawned when you create a
        cluster, positioned to the right of the group.
      </P>

      <H2 id="multi-select">Multi-select</H2>
      <P>
        Select multiple panels to move, cluster, or delete them as a group.
      </P>
      <Table
        headers={["Action", "How"]}
        rows={[
          ["Marquee select", "Click and drag on the canvas background to draw a selection box. Every panel it touches gets selected."],
          ["Shift-click", "Hold Shift and click individual panels to add or remove them from the selection."],
          ["Shift-marquee", "Hold Shift while drawing a marquee to add to the existing selection instead of replacing it."],
          ["Group drag", "When multiple panels are selected, drag any one of them and all selected panels move together."],
          ["Cluster from selection", "With 2+ panels selected, a floating menu appears. Click \"Cluster\" to group them."],
        ]}
      />

      <H2 id="keyboard-shortcuts">Keyboard shortcuts</H2>
      <Table
        headers={["Shortcut", "Action"]}
        rows={[
          ["W / Arrow Up", "Pan camera up."],
          ["A / Arrow Left", "Pan camera left."],
          ["S / Arrow Down", "Pan camera down."],
          ["D / Arrow Right", "Pan camera right."],
          ["Backspace / Delete", "Delete all selected panels."],
          ["Cmd+Z (Mac) / Ctrl+Z (Windows)", "Undo the last panel deletion. Works for multiple undos."],
        ]}
      />
      <Callout type="info">
        Keyboard shortcuts only fire when you are not typing in an input field, text area,
        or editable element. They will not interfere with chat or search input.
      </Callout>
    </div>
  );
}
