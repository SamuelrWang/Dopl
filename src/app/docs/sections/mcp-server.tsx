import { H2, H3, P, Table, CodeBlock, SectionHero, type TocEntry } from "../docs-primitives";

export const TOC: TocEntry[] = [
  { id: "mcp-setup", title: "Setup", level: 2 },
  { id: "mcp-claude-code", title: "Claude Code", level: 3 },
  { id: "mcp-claude-desktop", title: "Claude Desktop", level: 3 },
  { id: "mcp-openclaw", title: "OpenClaw", level: 3 },
  { id: "mcp-tools", title: "Available tools", level: 2 },
  { id: "api-keys", title: "API keys", level: 2 },
];

function ConnectionIllustration() {
  return (
    <svg width="200" height="80" viewBox="0 0 200 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Laptop */}
      <rect x="8" y="16" width="52" height="36" rx="3" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.1" />
      <rect x="14" y="22" width="40" height="24" rx="1" fill="white" fillOpacity="0.02" />
      <rect x="4" y="52" width="60" height="4" rx="2" fill="white" fillOpacity="0.05" />
      <text x="34" y="68" textAnchor="middle" fill="white" fillOpacity="0.2" fontSize="7" fontFamily="monospace">YOUR AI</text>
      {/* Arrow */}
      <path d="M72 36 L112 36" stroke="white" strokeOpacity="0.15" strokeWidth="1.2" strokeDasharray="4 3" />
      <text x="92" y="30" textAnchor="middle" fill="white" fillOpacity="0.2" fontSize="7" fontFamily="monospace">MCP</text>
      {/* Cloud */}
      <rect x="120" y="12" width="72" height="48" rx="6" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.1" />
      <text x="156" y="34" textAnchor="middle" fill="white" fillOpacity="0.3" fontSize="11" fontFamily="monospace" fontWeight="600">Dopl</text>
      <text x="156" y="48" textAnchor="middle" fill="white" fillOpacity="0.15" fontSize="7" fontFamily="monospace">Knowledge Base</text>
      <text x="156" y="72" textAnchor="middle" fill="white" fillOpacity="0.2" fontSize="7" fontFamily="monospace">usedopl.com</text>
    </svg>
  );
}

export function McpServerSection() {
  return (
    <div className="max-w-[720px]">
      <SectionHero
        label="MCP Server"
        title="Connect your AI tools"
        description="The Dopl MCP server bridges your knowledge base to Claude Code, OpenClaw, and any MCP-compatible tool."
      >
        <ConnectionIllustration />
      </SectionHero>

      <H2 id="mcp-setup">Setup</H2>
      <P>
        The Dopl MCP server connects your knowledge base to Claude Code, Claude Desktop,
        or any MCP-compatible AI tool.
      </P>

      <H3 id="mcp-claude-code">Claude Code</H3>
      <P>
        Run this command in your terminal:
      </P>
      <CodeBlock title="Terminal">{`claude mcp add dopl --scope user --transport stdio -- \\
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
      "args": ["@dopl/mcp-server", "--api-key", "YOUR_API_KEY"]
    }
  }
}`}</CodeBlock>
      <P>
        Restart Claude Desktop to pick up the changes.
      </P>

      <H3 id="mcp-openclaw">OpenClaw</H3>
      <P>
        Add the Dopl server to your OpenClaw MCP config:
      </P>
      <CodeBlock title="~/.openclaw/config/mcporter.json">{`{
  "mcp": {
    "servers": {
      "dopl": {
        "command": "npx",
        "args": ["@dopl/mcp-server", "--api-key", "YOUR_API_KEY"]
      }
    }
  }
}`}</CodeBlock>
      <P>
        Or add via the OpenClaw CLI:
      </P>
      <CodeBlock title="Terminal">{`openclaw mcp add dopl -- npx @dopl/mcp-server --api-key YOUR_API_KEY`}</CodeBlock>
      <P>
        The same tools and capabilities are available regardless of which platform you connect from.
      </P>

      <H2 id="mcp-tools">Available tools</H2>
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
          ["sync_skills", "Export all clusters as skill files to ~/.claude/skills/ or ~/.openclaw/workspace/data/dopl/."],
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
    </div>
  );
}
