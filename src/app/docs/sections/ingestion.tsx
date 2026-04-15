import { H2, H3, P, Table, SectionHero, OL, type TocEntry } from "../docs-primitives";

export const TOC: TocEntry[] = [
  { id: "supported-sources", title: "Supported sources", level: 2 },
  { id: "how-ingestion-works", title: "How ingestion works", level: 2 },
  { id: "generated-artifacts", title: "Generated artifacts", level: 2 },
  { id: "artifact-readme", title: "README", level: 3 },
  { id: "artifact-agentsmd", title: "agents.md", level: 3 },
  { id: "artifact-manifest", title: "Manifest", level: 3 },
];

/* ── Pipeline flow illustration ────────────────────────────────── */
function PipelineIllustration() {
  const steps = ["URL", "Extract", "Classify", "Generate", "Embed"];
  return (
    <svg width="220" height="56" viewBox="0 0 220 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      {steps.map((s, i) => {
        const x = i * 45 + 4;
        return (
          <g key={s}>
            <rect x={x} y="8" width="38" height="28" rx="4" fill="white" fillOpacity="0.04" stroke="white" strokeOpacity="0.1" />
            <text x={x + 19} y="26" textAnchor="middle" fill="white" fillOpacity="0.4" fontSize="8" fontFamily="monospace">{s}</text>
            {i < steps.length - 1 && (
              <path d={`M${x + 40} 22 L${x + 43} 22`} stroke="white" strokeOpacity="0.15" strokeWidth="1.2" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Source platform icons ──────────────────────────────────────── */
function SourceIcons() {
  const sources = [
    { label: "GitHub", letter: "G" },
    { label: "X", letter: "X" },
    { label: "Reddit", letter: "R" },
    { label: "IG", letter: "I" },
    { label: "Web", letter: "W" },
  ];
  return (
    <div className="flex gap-2 mb-6">
      {sources.map((s) => (
        <div key={s.label} className="w-10 h-10 rounded-lg border border-white/[0.08] bg-white/[0.03] flex items-center justify-center">
          <span className="font-mono text-[11px] font-bold text-white/25">{s.letter}</span>
        </div>
      ))}
    </div>
  );
}

export function IngestionSection() {
  return (
    <div className="max-w-[720px]">
      <SectionHero
        label="Ingestion"
        title="From URL to knowledge"
        description="Paste a link. Dopl fetches content, follows linked resources, and generates structured documentation."
      >
        <PipelineIllustration />
      </SectionHero>

      <H2 id="supported-sources">Supported sources</H2>
      <SourceIcons />
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
      <OL>
        <li>Fetch content from the source platform.</li>
        <li>Analyze text and images using AI (code screenshots are read via vision).</li>
        <li>Follow linked URLs to gather full context.</li>
        <li>Classify content sections as executable, tactical, or context.</li>
        <li>Generate a structured manifest (tools, complexity, tags).</li>
        <li>Generate a human-readable README.</li>
        <li>Generate agents.md (AI-executable setup instructions).</li>
        <li>Extract searchable tags.</li>
        <li>Create vector embeddings for semantic search.</li>
      </OL>
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
    </div>
  );
}
