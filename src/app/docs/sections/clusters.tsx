import { H2, P, SectionHero, type TocEntry } from "../docs-primitives";

export const TOC: TocEntry[] = [
  { id: "creating-clusters", title: "Creating clusters", level: 2 },
  { id: "skill-files", title: "Skill files", level: 2 },
];

/* ── Cluster diagram: entry panels grouped ─────────────────────── */
function ClusterIllustration() {
  return (
    <svg width="200" height="110" viewBox="0 0 200 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Cluster outline */}
      <rect x="4" y="14" width="120" height="88" rx="10" fill="white" fillOpacity="0.02" stroke="white" strokeOpacity="0.08" strokeWidth="1.5" />
      {/* Entry panel 1 */}
      <rect x="14" y="28" width="46" height="32" rx="3" fill="white" fillOpacity="0.04" stroke="white" strokeOpacity="0.1" />
      <rect x="19" y="33" width="20" height="2" rx="1" fill="white" fillOpacity="0.2" />
      <rect x="19" y="39" width="36" height="1.5" rx="0.75" fill="white" fillOpacity="0.07" />
      <rect x="19" y="44" width="30" height="1.5" rx="0.75" fill="white" fillOpacity="0.07" />
      {/* Entry panel 2 */}
      <rect x="68" y="28" width="46" height="32" rx="3" fill="white" fillOpacity="0.04" stroke="white" strokeOpacity="0.1" />
      <rect x="73" y="33" width="24" height="2" rx="1" fill="white" fillOpacity="0.2" />
      <rect x="73" y="39" width="36" height="1.5" rx="0.75" fill="white" fillOpacity="0.07" />
      <rect x="73" y="44" width="28" height="1.5" rx="0.75" fill="white" fillOpacity="0.07" />
      {/* Entry panel 3 */}
      <rect x="14" y="66" width="46" height="28" rx="3" fill="white" fillOpacity="0.04" stroke="white" strokeOpacity="0.1" />
      <rect x="19" y="71" width="18" height="2" rx="1" fill="white" fillOpacity="0.2" />
      <rect x="19" y="77" width="36" height="1.5" rx="0.75" fill="white" fillOpacity="0.07" />
      {/* Cluster label */}
      <text x="64" y="10" textAnchor="middle" fill="white" fillOpacity="0.2" fontSize="8" fontFamily="monospace">CLUSTER</text>
    </svg>
  );
}

export function ClustersSection() {
  return (
    <div className="max-w-[720px]">
      <SectionHero
        label="Clusters"
        title="Group your setups"
        description="Organize related entries into clusters — a named group of panels you can reference and publish together."
      >
        <ClusterIllustration />
      </SectionHero>

      <H2 id="creating-clusters">Creating clusters</H2>
      <P>
        Select two or more panels on the canvas, then click &quot;Cluster&quot; in the floating
        menu. Dopl groups them with a visual outline and auto-layouts them for readability.
      </P>
      <P>
        Panels can belong to one cluster at a time. If you drag a panel close to a cluster,
        it automatically joins. Drag it away and it leaves. A cluster dissolves if it drops
        below two members.
      </P>
      <P>
        Connection panels and Browse panels cannot be clustered.
      </P>
    </div>
  );
}
