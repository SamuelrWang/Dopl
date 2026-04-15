import { H2, P, SectionHero, type TocEntry } from "../docs-primitives";

export const TOC: TocEntry[] = [
  { id: "semantic-search", title: "Semantic search", level: 2 },
  { id: "solution-builder", title: "Solution builder", level: 2 },
];

function SearchIllustration() {
  return (
    <svg width="160" height="90" viewBox="0 0 160 90" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Search bar */}
      <rect x="8" y="8" width="144" height="24" rx="4" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.1" />
      <circle cx="22" cy="20" r="6" stroke="white" strokeOpacity="0.2" strokeWidth="1.2" />
      <path d="M26 24L29 27" stroke="white" strokeOpacity="0.2" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="36" y="16" width="60" height="3" rx="1.5" fill="white" fillOpacity="0.1" />
      {/* Result 1 */}
      <rect x="8" y="40" width="144" height="18" rx="3" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.06" />
      <rect x="14" y="46" width="40" height="2" rx="1" fill="white" fillOpacity="0.15" />
      <rect x="60" y="46" width="80" height="2" rx="1" fill="white" fillOpacity="0.06" />
      {/* Result 2 */}
      <rect x="8" y="62" width="144" height="18" rx="3" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.06" />
      <rect x="14" y="68" width="36" height="2" rx="1" fill="white" fillOpacity="0.15" />
      <rect x="56" y="68" width="86" height="2" rx="1" fill="white" fillOpacity="0.06" />
    </svg>
  );
}

export function SearchBuildSection() {
  return (
    <div className="max-w-[720px]">
      <SectionHero
        label="Search & Build"
        title="Find and compose"
        description="Search your knowledge base with natural language. Compose multi-source solutions from what you find."
      >
        <SearchIllustration />
      </SectionHero>

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
    </div>
  );
}
