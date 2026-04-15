import { H2, P, Table, SectionHero, OL, type TocEntry } from "../docs-primitives";

export const TOC: TocEntry[] = [
  { id: "what-is-dopl", title: "What is Dopl", level: 2 },
  { id: "quick-start", title: "Quick start", level: 2 },
  { id: "key-concepts", title: "Key concepts", level: 2 },
];

/* ── Canvas illustration: floating panels on a grid ────────────── */
function CanvasIllustration() {
  return (
    <svg width="200" height="140" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Grid lines */}
      {[0, 40, 80, 120, 160, 200].map((x) => (
        <line key={`v${x}`} x1={x} y1="0" x2={x} y2="140" stroke="white" strokeOpacity="0.04" />
      ))}
      {[0, 35, 70, 105, 140].map((y) => (
        <line key={`h${y}`} x1="0" y1={y} x2="200" y2={y} stroke="white" strokeOpacity="0.04" />
      ))}
      {/* Panel 1 - Entry */}
      <rect x="12" y="16" width="72" height="52" rx="4" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.1" />
      <rect x="18" y="22" width="32" height="3" rx="1.5" fill="white" fillOpacity="0.2" />
      <rect x="18" y="30" width="60" height="2" rx="1" fill="white" fillOpacity="0.08" />
      <rect x="18" y="36" width="50" height="2" rx="1" fill="white" fillOpacity="0.08" />
      <rect x="18" y="42" width="55" height="2" rx="1" fill="white" fillOpacity="0.08" />
      {/* Panel 2 - Chat */}
      <rect x="96" y="8" width="68" height="60" rx="4" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.1" />
      <rect x="102" y="14" width="28" height="3" rx="1.5" fill="white" fillOpacity="0.15" />
      <rect x="102" y="24" width="56" height="12" rx="3" fill="white" fillOpacity="0.04" />
      <rect x="102" y="42" width="40" height="12" rx="3" fill="white" fillOpacity="0.06" />
      {/* Panel 3 - Browse */}
      <rect x="24" y="80" width="88" height="48" rx="4" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.1" />
      <rect x="30" y="86" width="76" height="3" rx="1.5" fill="white" fillOpacity="0.12" />
      <rect x="30" y="96" width="34" height="24" rx="2" fill="white" fillOpacity="0.04" />
      <rect x="68" y="96" width="34" height="24" rx="2" fill="white" fillOpacity="0.04" />
      {/* Cluster outline */}
      <rect x="6" y="4" width="168" height="72" rx="8" stroke="white" strokeOpacity="0.06" strokeDasharray="4 3" />
    </svg>
  );
}

export function GettingStartedSection() {
  return (
    <div className="max-w-[720px]">
      <SectionHero
        label="Getting Started"
        title="Welcome to Dopl"
        description="A knowledge base for AI and automation setups. Ingest URLs, get structured documentation, search and compose solutions."
      >
        <CanvasIllustration />
      </SectionHero>

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
      <OL>
        <li>Open a chat panel (click the + button or use the Browse panel&apos;s search)</li>
        <li>Paste a URL into the chat. Dopl ingests it and creates an entry panel with the results.</li>
        <li>Repeat with more URLs. Select multiple entry panels and click &quot;Cluster&quot; to group them.</li>
        <li>Export clusters as Claude Code skill files to use them in your workflow.</li>
      </OL>

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
    </div>
  );
}
