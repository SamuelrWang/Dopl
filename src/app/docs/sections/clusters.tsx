import { H2, P, Code, SectionHero, UL, type TocEntry } from "../docs-primitives";

export const TOC: TocEntry[] = [
  { id: "creating-clusters", title: "Creating clusters", level: 2 },
  { id: "cluster-brain", title: "Cluster brain", level: 2 },
  { id: "skill-files", title: "Skill files", level: 2 },
];

/* ── Cluster diagram: panels grouped with brain ────────────────── */
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
      {/* Connection line to brain */}
      <path d="M126 58 L140 58" stroke="white" strokeOpacity="0.12" strokeWidth="1" strokeDasharray="3 2" />
      {/* Brain panel */}
      <rect x="142" y="28" width="52" height="60" rx="4" fill="white" fillOpacity="0.03" stroke="white" strokeOpacity="0.12" />
      <rect x="148" y="34" width="16" height="2" rx="1" fill="white" fillOpacity="0.25" />
      <rect x="148" y="42" width="40" height="1.5" rx="0.75" fill="white" fillOpacity="0.08" />
      <rect x="148" y="48" width="36" height="1.5" rx="0.75" fill="white" fillOpacity="0.08" />
      <rect x="148" y="54" width="38" height="1.5" rx="0.75" fill="white" fillOpacity="0.08" />
      <rect x="148" y="60" width="32" height="1.5" rx="0.75" fill="white" fillOpacity="0.08" />
      {/* Brain icon */}
      <circle cx="188" cy="34" r="4" fill="white" fillOpacity="0.06" />
      {/* Cluster label */}
      <text x="64" y="10" textAnchor="middle" fill="white" fillOpacity="0.2" fontSize="8" fontFamily="monospace">CLUSTER</text>
      <text x="168" y="80" textAnchor="middle" fill="white" fillOpacity="0.2" fontSize="7" fontFamily="monospace">BRAIN</text>
    </svg>
  );
}

export function ClustersSection() {
  return (
    <div className="max-w-[720px]">
      <SectionHero
        label="Clusters"
        title="Group and synthesize"
        description="Organize related entries into clusters. Dopl generates a brain that merges their knowledge into one set of instructions."
      >
        <ClusterIllustration />
      </SectionHero>

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
      <UL>
        <li>A <Code>SKILL.md</Code> file with the cluster brain instructions and entry references.</li>
        <li>A <Code>references/</Code> directory with individual markdown files per entry (README + agents.md).</li>
        <li>An update to <Code>~/.claude/CLAUDE.md</Code> indexing the cluster for discovery.</li>
      </UL>
      <P>
        Once synced, Claude Code can find and use the skill automatically when working on
        related tasks.
      </P>
    </div>
  );
}
