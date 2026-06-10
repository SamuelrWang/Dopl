import { H2, H3, P, Table, CodeBlock, SectionHero, type TocEntry } from "../docs-primitives";

export const TOC: TocEntry[] = [
  { id: "mcp-setup", title: "Setup", level: 2 },
  { id: "mcp-claude-code", title: "Claude Code", level: 3 },
  { id: "mcp-claude-desktop", title: "Claude Desktop & Claude.ai", level: 3 },
  { id: "mcp-other", title: "Cursor & other clients", level: 3 },
  { id: "mcp-tools", title: "Available tools", level: 2 },
  { id: "mcp-access", title: "Managing access", level: 2 },
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
        description="The Dopl MCP server bridges your knowledge base to Claude Code, Codex, and any MCP-compatible tool."
      >
        <ConnectionIllustration />
      </SectionHero>

      <H2 id="mcp-setup">Setup</H2>
      <P>
        Dopl is a hosted, remote MCP server. You connect by pointing your MCP
        client at one URL — there is nothing to install. The first time you
        connect, a browser window opens so you can sign in to Dopl; after that
        your client stays authorized and server updates roll out automatically.
      </P>
      <CodeBlock title="MCP server URL">{`https://www.usedopl.com/api/mcp`}</CodeBlock>

      <H3 id="mcp-claude-code">Claude Code</H3>
      <P>
        Run this command in your terminal, then follow the browser sign-in:
      </P>
      <CodeBlock title="Terminal">{`claude mcp add --transport http dopl https://www.usedopl.com/api/mcp`}</CodeBlock>
      <P>
        Dopl tools appear in your tool list once you&rsquo;ve signed in.
      </P>

      <H3 id="mcp-claude-desktop">Claude Desktop & Claude.ai</H3>
      <P>
        In Claude.ai, use &ldquo;Add custom connector&rdquo; and paste the URL.
        For Claude Desktop, add this to your config file:
      </P>
      <CodeBlock title="claude_desktop_config.json">{`{
  "mcpServers": {
    "dopl": {
      "type": "http",
      "url": "https://www.usedopl.com/api/mcp"
    }
  }
}`}</CodeBlock>
      <P>
        Restart Claude Desktop, then sign in when prompted.
      </P>

      <H3 id="mcp-other">Cursor & other clients</H3>
      <P>
        Any MCP-compatible client that supports remote (HTTP / streamable) servers
        works: add Dopl as an HTTP server pointed at the URL above. The same tools
        and capabilities are available regardless of which client you connect from.
      </P>

      <H2 id="mcp-tools">Available tools</H2>
      <P>
        The MCP server exposes tools across knowledge bases, skills, clusters,
        and the canvas. Here are the most commonly used:
      </P>
      <Table
        headers={["Tool", "Description"]}
        rows={[
          ["dopl_cluster(op=list)", "List all your clusters."],
          ["dopl_cluster(op=get)", "Get cluster details with attached knowledge bases and skills."],
          ["dopl_cluster(op=read_knowledge_entry)", "Read a knowledge-base entry inside a cluster."],
          ["dopl_cluster(op=read_skill)", "Read the full body of a skill attached to a cluster."],
          ["dopl_cluster(op=create)", "Create a new cluster by name."],
          ["dopl_kb", "Browse, read, and write your workspace knowledge bases."],
          ["dopl_skill", "List, read, and author your workspace skills."],
          ["dopl_packs", "Browse curated, version-pinned knowledge packs."],
          ["dopl_canvas(op=list)", "List the panels on your canvas."],
        ]}
      />

      <H2 id="mcp-access">Managing access</H2>
      <P>
        Connecting authorizes your MCP client through Dopl&rsquo;s sign-in — there
        are no API keys to copy or rotate. Each connected client shows up under
        &ldquo;Connected apps&rdquo; in your workspace settings.
      </P>
      <P>
        Revoke a client there at any time to immediately cut off its access.
        Requests are rate-limited per minute based on your plan.
      </P>
    </div>
  );
}
