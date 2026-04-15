import { H2, P, SectionHero, type TocEntry } from "../docs-primitives";

export const TOC: TocEntry[] = [
  { id: "publishing", title: "Publishing clusters", level: 2 },
  { id: "browsing-community", title: "Browsing shared setups", level: 2 },
];

function CommunityIllustration() {
  return (
    <svg width="160" height="80" viewBox="0 0 160 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Cards grid */}
      <rect x="4" y="4" width="46" height="34" rx="4" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.08" />
      <rect x="10" y="10" width="34" height="12" rx="2" fill="white" fillOpacity="0.04" />
      <rect x="10" y="26" width="24" height="2" rx="1" fill="white" fillOpacity="0.12" />
      <rect x="10" y="32" width="34" height="1.5" rx="0.75" fill="white" fillOpacity="0.06" />

      <rect x="56" y="4" width="46" height="34" rx="4" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.08" />
      <rect x="62" y="10" width="34" height="12" rx="2" fill="white" fillOpacity="0.04" />
      <rect x="62" y="26" width="28" height="2" rx="1" fill="white" fillOpacity="0.12" />
      <rect x="62" y="32" width="34" height="1.5" rx="0.75" fill="white" fillOpacity="0.06" />

      <rect x="108" y="4" width="46" height="34" rx="4" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.08" />
      <rect x="114" y="10" width="34" height="12" rx="2" fill="white" fillOpacity="0.04" />
      <rect x="114" y="26" width="20" height="2" rx="1" fill="white" fillOpacity="0.12" />
      <rect x="114" y="32" width="34" height="1.5" rx="0.75" fill="white" fillOpacity="0.06" />

      <rect x="4" y="44" width="46" height="34" rx="4" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.08" />
      <rect x="10" y="50" width="34" height="12" rx="2" fill="white" fillOpacity="0.04" />
      <rect x="10" y="66" width="30" height="2" rx="1" fill="white" fillOpacity="0.12" />

      <rect x="56" y="44" width="46" height="34" rx="4" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.08" />
      <rect x="62" y="50" width="34" height="12" rx="2" fill="white" fillOpacity="0.04" />
      <rect x="62" y="66" width="26" height="2" rx="1" fill="white" fillOpacity="0.12" />
    </svg>
  );
}

export function CommunitySection() {
  return (
    <div className="max-w-[720px]">
      <SectionHero
        label="Community"
        title="Shared knowledge"
        description="Browse published clusters from other users. Publish your own to share what you have built."
      >
        <CommunityIllustration />
      </SectionHero>

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
