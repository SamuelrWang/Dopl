"use client";

/* ------------------------------------------------------------------ *
 * DocsContent — every documentation section rendered as React.       *
 *                                                                    *
 * Writing rules (from soul.md):                                      *
 *  - No em dashes. Commas, full stops, or restructure.               *
 *  - No filler ("absolutely", "great question", etc.)                *
 *  - No bullet points when a sentence works fine.                    *
 *  - Don't start sections with "I".                                  *
 *  - Answer first, context after.                                    *
 *  - No false enthusiasm or engagement bait.                         *
 * ------------------------------------------------------------------ */

export interface TocEntry {
  id: string;
  title: string;
  level: number;
}

// Static TOC entries. Defined once, not during render.
export const TOC_ENTRIES: TocEntry[] = [
  { id: "what-is-dopl", title: "What is Dopl", level: 2 },
  { id: "quick-start", title: "Quick start", level: 2 },
  { id: "key-concepts", title: "Key concepts", level: 2 },
  { id: "navigating", title: "Navigating the canvas", level: 2 },
  { id: "panels", title: "Panels", level: 2 },
  { id: "panel-entry", title: "Entry panel", level: 3 },
  { id: "panel-chat", title: "Chat panel", level: 3 },
  { id: "panel-browse", title: "Browse panel", level: 3 },
  { id: "panel-connection", title: "Connection panel", level: 3 },
  { id: "panel-brain", title: "Cluster brain panel", level: 3 },
  { id: "multi-select", title: "Multi-select", level: 2 },
  { id: "keyboard-shortcuts", title: "Keyboard shortcuts", level: 2 },
  { id: "supported-sources", title: "Supported sources", level: 2 },
  { id: "how-ingestion-works", title: "How ingestion works", level: 2 },
  { id: "generated-artifacts", title: "Generated artifacts", level: 2 },
  { id: "creating-clusters", title: "Creating clusters", level: 2 },
  { id: "cluster-brain", title: "Cluster brain", level: 2 },
  { id: "skill-files", title: "Skill files", level: 2 },
  { id: "semantic-search", title: "Semantic search", level: 2 },
  { id: "solution-builder", title: "Solution builder", level: 2 },
  { id: "mcp-setup", title: "MCP server setup", level: 2 },
  { id: "mcp-tools", title: "Available MCP tools", level: 2 },
  { id: "api-keys", title: "API keys", level: 2 },
  { id: "extension-install", title: "Chrome Extension", level: 2 },
  { id: "omnibox", title: "Omnibox search", level: 2 },
  { id: "context-menu", title: "Context menu", level: 2 },
  { id: "publishing", title: "Publishing clusters", level: 2 },
  { id: "browsing-community", title: "Browsing shared setups", level: 2 },
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-[22px] font-semibold text-white/95 mt-14 mb-4 scroll-mt-24">
      {children}
    </h2>
  );
}

function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-[17px] font-semibold text-white/90 mt-10 mb-3 scroll-mt-24">
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[14.5px] leading-[1.75] text-white/60 mb-4">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 text-[13px] bg-white/[0.06] border border-white/[0.08] rounded text-white/80 font-mono">
      {children}
    </code>
  );
}

function CodeBlock({ children, title }: { children: string; title?: string }) {
  return (
    <div className="mb-5 rounded-lg overflow-hidden border border-white/[0.08]">
      {title && (
        <div className="px-4 py-2 bg-white/[0.03] border-b border-white/[0.06] font-mono text-[11px] text-white/40 uppercase tracking-wider">
          {title}
        </div>
      )}
      <pre className="p-4 bg-white/[0.02] overflow-x-auto">
        <code className="text-[13px] leading-relaxed text-white/75 font-mono">{children}</code>
      </pre>
    </div>
  );
}

function Callout({ children, type = "info" }: { children: React.ReactNode; type?: "info" | "tip" }) {
  const border = type === "tip" ? "border-[color:var(--mint)]/30" : "border-white/10";
  const label = type === "tip" ? "Tip" : "Note";
  const labelColor = type === "tip" ? "text-[color:var(--mint)]" : "text-white/50";
  return (
    <div className={`mb-5 p-4 rounded-lg bg-white/[0.03] border ${border}`}>
      <span className={`font-mono text-[10px] uppercase tracking-widest ${labelColor} block mb-1.5`}>
        {label}
      </span>
      <div className="text-[14px] leading-[1.7] text-white/60">{children}</div>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mb-5 overflow-x-auto rounded-lg border border-white/[0.08]">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-b border-white/[0.08] bg-white/[0.03]">
            {headers.map((h) => (
              <th key={h} className="text-left px-4 py-2.5 font-semibold text-white/70">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-white/[0.04] last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-white/55">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Sections ──────────────────────────────────────────────────────

export function DocsContent() {
  return (
    <div className="max-w-[720px]">
      {/* ── Getting Started ────────────────────────────────── */}

      <H2 id="what-is-dopl">What is Dopl</H2>
      <P>
        Dopl is a knowledge base for AI and automation setups. Paste a URL, and Dopl extracts
        everything: text, images, linked resources, GitHub repos, code. It generates structured
        documentation (README, agents.md, manifest) and makes the whole thing searchable.
      </P>
      <P>
        The core loop: ingest a URL, get structured artifacts, search and compose solutions from
        your collected knowledge. Everything lives on an infinite canvas where you can arrange,
        group, and connect related setups.
      </P>
      <P>
        Dopl also connects to Claude Code and other AI tools through an MCP server, so your
        knowledge base becomes a live resource your AI agent can search, query, and use while
        coding.
      </P>

      <H2 id="quick-start">Quick start</H2>
      <P>
        Sign in and you land on the canvas. You will see a Connection panel (your API key
        and setup instructions) and a Browse panel (the knowledge base browser). From here:
      </P>
      <ol className="list-decimal list-inside space-y-2 text-[14.5px] text-white/60 mb-5 ml-1">
        <li>Open a chat panel (click the + button or use the Browse panel&apos;s search)</li>
        <li>Paste a URL into the chat. Dopl ingests it and creates an entry panel with the results.</li>
        <li>Repeat with more URLs. Select multiple entry panels and click &quot;Cluster&quot; to group them.</li>
        <li>Export clusters as Claude Code skill files to use them in your workflow.</li>
      </ol>

      <H2 id="key-concepts">Key concepts</H2>
      <Table
        headers={["Concept", "What it is"]}
        rows={[
          ["Entry", "A single piece of ingested knowledge. Has a README, agents.md, manifest, and tags."],
          ["Panel", "A card on the canvas. Can be an entry, chat, browse window, or cluster brain."],
          ["Cluster", "A named group of panels. Has a brain that synthesizes instructions from its members."],
          ["Cluster brain", "AI-generated instructions that combine all agents.md files in a cluster."],
          ["Memory", "A user correction or preference saved to a cluster brain. Persists across sessions."],
          ["Skill file", "A Claude Code skill exported from a cluster. Lives in ~/.claude/skills/."],
          ["MCP server", "The bridge between Dopl and AI tools like Claude Code."],
        ]}
      />

      {/* ── The Canvas ─────────────────────────────────────── */}

      <H2 id="navigating">Navigating the canvas</H2>
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
          ["Backspace / Delete", "Delete all selected panels."],
          ["Cmd+Z (Mac) / Ctrl+Z (Windows)", "Undo the last panel deletion. Works for multiple undos."],
        ]}
      />
      <Callout type="info">
        Keyboard shortcuts only fire when you are not typing in an input field, text area,
        or editable element. They will not interfere with chat or search input.
      </Callout>

      {/* ── Ingestion ──────────────────────────────────────── */}

      <H2 id="supported-sources">Supported sources</H2>
      <P>
        Dopl can ingest content from a wide range of platforms:
      </P>
      <Table
        headers={["Platform", "What gets extracted"]}
        rows={[
          ["GitHub repos", "README, package.json, config files, file tree structure, repo metadata (stars, language)."],
          ["X (Twitter) posts", "Tweet text, images (including code screenshots via vision AI), linked URLs, quote tweets, threads."],
          ["Instagram posts", "Post text, images (analyzed via vision AI), linked URLs from captions."],
          ["Reddit threads", "Post body, comments, linked URLs."],
          ["Web pages", "Full page content via Firecrawl, Jina, or direct HTML extraction. Follows linked resources up to 3 levels deep."],
        ]}
      />
      <P>
        For any source, Dopl follows linked URLs (up to 30 per entry, 3 levels deep) to gather
        full context. A GitHub link in a tweet? Dopl fetches the repo too.
      </P>

      <H2 id="how-ingestion-works">How ingestion works</H2>
      <P>
        When you paste a URL into a chat panel, Dopl runs a multi-step pipeline in the
        background. Progress streams live to the chat panel so you can watch each step
        complete.
      </P>
      <ol className="list-decimal list-inside space-y-2 text-[14.5px] text-white/60 mb-5 ml-1">
        <li>Fetch content from the source platform.</li>
        <li>Analyze text and images using AI (code screenshots are read via vision).</li>
        <li>Follow linked URLs to gather full context.</li>
        <li>Classify content sections as executable, tactical, or context.</li>
        <li>Generate a structured manifest (tools, complexity, tags).</li>
        <li>Generate a human-readable README.</li>
        <li>Generate agents.md (AI-executable setup instructions).</li>
        <li>Extract searchable tags.</li>
        <li>Create vector embeddings for semantic search.</li>
      </ol>
      <P>
        The whole process typically takes 30 to 120 seconds depending on how many links
        need following.
      </P>

      <H2 id="generated-artifacts">Generated artifacts</H2>

      <H3 id="artifact-readme">README</H3>
      <P>
        A human-readable reference document. Covers what the setup does, the tools involved,
        architecture, and key implementation details. Technical specifics are preserved.
        Marketing copy and filler are condensed.
      </P>

      <H3 id="artifact-agentsmd">agents.md</H3>
      <P>
        Setup instructions written for an AI coding agent. Terse by design. Includes
        prerequisites, environment variables, install commands, architecture overview, and
        step-by-step setup. Source code files are referenced by path, not reproduced inline.
        Only includes inline code for configs the user must create and small modifications.
      </P>

      <H3 id="artifact-manifest">Manifest</H3>
      <P>
        Structured JSON metadata. Contains the title, description, tools used, integrations,
        primary and secondary use cases, complexity level (simple, moderate, complex, advanced),
        and auto-generated tags. Powers search filters and the knowledge base browser.
      </P>

      {/* ── Clusters ───────────────────────────────────────── */}

      <H2 id="creating-clusters">Creating clusters</H2>
      <P>
        Select two or more panels on the canvas, then click &quot;Cluster&quot; in the floating
        menu. Dopl groups them with a visual outline, auto-layouts them for readability,
        and spawns a cluster brain panel to the right.
      </P>
      <P>
        Panels can belong to one cluster at a time. If you drag a panel close to a cluster,
        it automatically joins. Drag it away and it leaves. A cluster dissolves if it drops
        below two members.
      </P>
      <P>
        Connection panels and Browse panels cannot be clustered.
      </P>

      <H2 id="cluster-brain">Cluster brain</H2>
      <P>
        When a cluster is created, Dopl reads all agents.md files from the member entries
        and synthesizes them into a single set of cohesive instructions. This is the
        cluster brain. You can edit these instructions directly.
      </P>
      <P>
        Memories are user corrections saved to the brain. If you tell Dopl &quot;always use Resend
        instead of SendGrid for this cluster&quot; or &quot;skip the Slack notification step,&quot; that
        becomes a persistent memory. Memories override the base instructions in future
        interactions.
      </P>

      <H2 id="skill-files">Skill files</H2>
      <P>
        Export a cluster as a Claude Code skill using the MCP server&apos;s <Code>sync_skills</Code>{" "}
        tool. This creates files in <Code>~/.claude/skills/</Code>:
      </P>
      <ul className="list-disc list-inside space-y-1.5 text-[14.5px] text-white/60 mb-5 ml-1">
        <li>A <Code>SKILL.md</Code> file with the cluster brain instructions and entry references.</li>
        <li>A <Code>references/</Code> directory with individual markdown files per entry (README + agents.md).</li>
        <li>An update to <Code>~/.claude/CLAUDE.md</Code> indexing the cluster for discovery.</li>
      </ul>
      <P>
        Once synced, Claude Code can find and use the skill automatically when working on
        related tasks.
      </P>

      {/* ── Search & Build ─────────────────────────────────── */}

      <H2 id="semantic-search">Semantic search</H2>
      <P>
        Type a natural language query and Dopl finds relevant entries using vector similarity.
        Results are ranked by relevance and can be filtered by tags, use case, or complexity.
      </P>
      <P>
        Pro users get AI-powered synthesis: a summary that explains how the top results
        relate to your query and which ones to start with.
      </P>

      <H2 id="solution-builder">Solution builder</H2>
      <P>
        Describe what you want to build, and Dopl combines multiple knowledge base entries
        into one solution. It generates a composite README and agents.md that covers the
        complete setup.
      </P>
      <P>
        You can constrain results with preferred tools, excluded tools, and a max complexity
        level. This is a Pro feature.
      </P>

      {/* ── MCP Server ─────────────────────────────────────── */}

      <H2 id="mcp-setup">MCP server setup</H2>
      <P>
        The Dopl MCP server connects your knowledge base to Claude Code, Claude Desktop,
        or any MCP-compatible AI tool.
      </P>

      <H3 id="mcp-claude-code">Claude Code</H3>
      <P>
        Run this command in your terminal:
      </P>
      <CodeBlock title="Terminal">{`claude mcp add dopl --scope user --transport stdio \\
  -e DOPL_BASE_URL=https://usedopl.com -- \\
  npx @dopl/mcp-server --api-key YOUR_API_KEY`}</CodeBlock>
      <P>
        Restart Claude Code afterwards. Dopl tools will appear in your tool list.
      </P>

      <H3 id="mcp-claude-desktop">Claude Desktop</H3>
      <P>
        Add this to your Claude Desktop config file:
      </P>
      <CodeBlock title="claude_desktop_config.json">{`{
  "mcpServers": {
    "dopl": {
      "command": "npx",
      "args": ["@dopl/mcp-server", "--api-key", "YOUR_API_KEY"],
      "env": {
        "DOPL_BASE_URL": "https://usedopl.com"
      }
    }
  }
}`}</CodeBlock>
      <P>
        Restart Claude Desktop to pick up the changes.
      </P>

      <H2 id="mcp-tools">Available MCP tools</H2>
      <P>
        The MCP server exposes 24 tools. Here are the most commonly used:
      </P>
      <Table
        headers={["Tool", "Description"]}
        rows={[
          ["search_setups", "Search the knowledge base with natural language. Returns ranked results with optional AI synthesis."],
          ["get_setup", "Get full details for an entry: README, agents.md, manifest."],
          ["build_solution", "Compose a multi-source solution from a brief description of what you want to build."],
          ["ingest_url", "Ingest a URL into the knowledge base. Processes in the background (30 to 120 seconds)."],
          ["list_clusters", "List all your clusters."],
          ["get_cluster", "Get cluster details with member entries, READMEs, and brain."],
          ["query_cluster", "Semantic search scoped to a single cluster."],
          ["sync_skills", "Export all clusters as Claude Code skill files to ~/.claude/skills/."],
          ["save_cluster_memory", "Save a preference or correction to a cluster brain."],
          ["canvas_add_entry", "Add a knowledge base entry to your canvas."],
          ["canvas_search_and_add", "Search and add top results to your canvas in one step."],
          ["canvas_create_cluster", "Group canvas entries into a named cluster."],
          ["check_entry_updates", "Check if a GitHub-sourced entry has upstream changes since ingestion."],
        ]}
      />

      <H2 id="api-keys">API keys</H2>
      <P>
        Generate API keys in Settings. Each key gets a name (for your reference) and is
        displayed once at creation. Save it somewhere safe.
      </P>
      <P>
        You can create multiple keys (one per device or workspace) and revoke any key at
        any time. Keys are rate-limited per minute based on your plan.
      </P>

      {/* ── Chrome Extension ───────────────────────────────── */}

      <H2 id="extension-install">Chrome Extension installation</H2>
      <P>
        Install the Dopl Chrome Extension from the Chrome Web Store (or load it unpacked
        from <Code>packages/chrome-extension/</Code> for development). The extension adds a
        side panel, omnibox search, and right-click context menu actions.
      </P>

      <H2 id="omnibox">Omnibox search</H2>
      <P>
        Type <Code>dopl</Code> followed by a space in your browser address bar, then type
        your query. Results appear as suggestions with title and summary. Click a result to
        open it, or press Enter to search in the side panel.
      </P>

      <H2 id="context-menu">Context menu</H2>
      <P>
        Right-click on any web page for these options:
      </P>
      <Table
        headers={["Action", "What it does"]}
        rows={[
          ["Ingest this page", "Sends the current page URL to Dopl for ingestion."],
          ["Ingest linked page", "Right-click a link to ingest the linked URL."],
          ["Search Dopl for selected text", "Highlight text, right-click, and search your knowledge base."],
          ["Save snippet to Dopl chat", "Send selected text to an active Dopl chat."],
        ]}
      />

      {/* ── Community ──────────────────────────────────────── */}

      <H2 id="publishing">Publishing clusters</H2>
      <P>
        Share your clusters with other Dopl users by publishing them to the Community hub.
        Published clusters include the cluster name, description, brain instructions, and
        all member entries (READMEs and agents.md files).
      </P>
      <P>
        You can assign a category (marketing, development, automation, etc.) and the cluster
        gets a public URL that anyone can browse.
      </P>

      <H2 id="browsing-community">Browsing shared setups</H2>
      <P>
        The Community page shows all published clusters, sorted by popularity or recency.
        Filter by category or search by keyword. Click a cluster to view its contents,
        then import it into your own workspace.
      </P>
    </div>
  );
}
