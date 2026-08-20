"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Building2, Folder, History, Plus } from "lucide-react";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { usePlaygroundPoll, usePlaygroundSession } from "../../session";
import {
  LiveSkillsPane,
  PANE_FILTERS,
  SkillRow,
  type LiveSkillSummary,
  type PaneFilter,
} from "./skills-pane-live";

/**
 * Playground Skills pane — a clone of
 * `src/features/skills/components/skills-browser-core.tsx` (two-pane
 * .page-float browser: scope-filtered list left, skill body right) in two
 * halves. Until a playground session exists AND `GET /api/skills` answers
 * with real rows, `StaticSkillsPane` shows the seeded starter corpus
 * (`src/features/skills/server/seed.ts`), abridged, as inert demo content.
 * Once the guest workspace has skills, `./skills-pane-live.tsx` renders them
 * for real (list + per-slug body) over `usePlaygroundPoll`. Selection is
 * local state in both halves.
 */
export function SkillsPane() {
  const { session } = usePlaygroundSession();
  const list = usePlaygroundPoll<{ skills: LiveSkillSummary[] }>(
    session ? "/api/skills" : null
  );
  const skills = list.data?.skills;
  // Empty workspace (agent hasn't written a skill yet) keeps the demo corpus
  // on screen — the poll flips this live as soon as the first skill lands.
  if (!session || !skills || skills.length === 0) return <StaticSkillsPane />;
  return <LiveSkillsPane skills={skills} />;
}

interface DemoSkill {
  id: string;
  name: string;
  description: string;
  folder: string;
  updated: string;
  body: ReactNode;
}

/* ---------------------------------------------------------------------------
 * Static body typography — mirrors PROSE_CLASSES in
 * `src/shared/editor/doc-editor.tsx` (the real detail pane's Tiptap prose),
 * which is why these px values exist: they are that recipe, not new ones.
 * ------------------------------------------------------------------------ */

function P({ children }: { children: ReactNode }) {
  return (
    <p className="my-3 text-[16px] leading-[1.7] text-text-primary/90">
      {children}
    </p>
  );
}

function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-1.5 mt-6 text-[19px] font-semibold tracking-tight text-text-primary">
      {children}
    </h2>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded border border-border-subtle bg-surface-raised-3 px-1 py-px font-mono text-[12.5px] text-text-primary">
      {children}
    </code>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-text-primary">{children}</strong>;
}

const DEMO_SKILLS: DemoSkill[] = [
  {
    id: "archive-a-session-to-chats",
    name: "Archive a session to Chats",
    description:
      "Exports the working session to Dopl Chats so the next session (yours or a teammate's) can pick up where it left off.",
    folder: "Dopl",
    updated: "Aug 14",
    body: (
      <>
        <P>
          Export with <Code>dopl_chats</Code> op=<Code>export</Code>. The
          transcript is <Strong>summary-per-message</Strong> — one concise line
          per turn — and you exfiltrate the decisions, deliverables, learnings,
          and next steps that a future agent needs.
        </P>
        <H2>Step 1 — Summarize each message</H2>
        <P>
          Write one tight summary line per turn (<Code>role</Code> = user or
          agent). Capture what was decided and <em>why</em>, not blow-by-blow.
          Keep <Code>verbatim</Code> empty unless the user asked to preserve
          exact wording — then include it on that message only.
        </P>
        <H2>Step 2 — Exfiltrate deliverables and learnings</H2>
        <P>
          Fill <Code>deliverables</Code> as checklist items: concrete outputs
          and whether each landed. Fill <Code>learnings</Code> with durable
          takeaways worth surfacing later (&ldquo;staging DB resets
          nightly&rdquo;). Put next steps in the overview or as unchecked
          deliverables.
        </P>
        <H2>Step 3 — Set a stable session id</H2>
        <P>
          Pass <Code>client_session_id</Code> (a stable handle for this
          session) so a re-export updates the same chat instead of duplicating
          it. Give the chat a specific <Code>title</Code> and a one-paragraph{" "}
          <Code>overview</Code>.
        </P>
        <H2>Step 4 — Promote what will matter</H2>
        <P>
          If a learning will matter next week, don&apos;t leave it only in the
          export — file it as a Knowledge entry. The export is the session
          record; the KB is the durable memory.
        </P>
      </>
    ),
  },
  {
    id: "file-knowledge-well",
    name: "File knowledge well",
    description:
      "Turns a durable learning into a well-placed, well-named knowledge base entry — without duplicating what's already filed.",
    folder: "Dopl",
    updated: "Aug 11",
    body: (
      <>
        <P>
          A learning becomes a KB entry when it&apos;s{" "}
          <em>true and reusable</em> — you&apos;ll want to reread it.
          Procedures become Skills; session records become Chat exports.
        </P>
        <H2>Step 1 — Check it isn&apos;t already filed</H2>
        <P>
          Run <Code>dopl_kb</Code> op=<Code>search</Code> (or{" "}
          <Code>dopl_search</Code>) for the topic first. If an entry exists,{" "}
          <Strong>update it</Strong> rather than adding a near-duplicate —
          split knowledge only when the topics are genuinely distinct.
        </P>
        <H2>Step 2 — Pick the base and folder</H2>
        <P>
          Choose the base whose subject matches, and a folder that groups the
          entry with its siblings. If no base fits, create one with{" "}
          <Code>op=create_base</Code> — a clear name beats a catch-all
          &ldquo;Misc&rdquo;.
        </P>
        <H2>Step 3 — Write it tight</H2>
        <P>
          Title it as the thing it answers (&ldquo;How staging resets&rdquo;,
          not &ldquo;Notes&rdquo;). Write it with <Code>op=write_file</Code> —
          and lead with the takeaway in the first line, since the list summary
          is auto-derived from the body.
        </P>
        <H2>Step 4 — Link it back</H2>
        <P>
          If an ontology object relates to this entry, point that object&apos;s{" "}
          <Code>knowledge</Code> attribute at the new entry so the graph stays
          navigable.
        </P>
      </>
    ),
  },
  {
    id: "author-the-ontology",
    name: "Author the ontology",
    description:
      "Models things and their connections as objects — short attributes, template fields on columns, refs and edges over prose.",
    folder: "Dopl",
    updated: "Aug 8",
    body: (
      <>
        <P>
          The ontology holds <em>structure</em>, not paragraphs. Objects are
          index cards; the connections between them are the value.
        </P>
        <H2>Step 1 — Object or entry?</H2>
        <P>
          If you&apos;re about to write prose, stop — it belongs in a KB entry,
          and the object should <em>reference</em> it with a{" "}
          <Code>knowledge</Code> attribute. Make an object only for a discrete
          thing with attributes and links.
        </P>
        <H2>Step 2 — Create in a column</H2>
        <P>
          Objects live in columns inside a cluster (<Code>dopl_ontology</Code>{" "}
          op=<Code>create_cluster</Code> / <Code>create_column</Code> /{" "}
          <Code>create_object</Code>). Set the column&apos;s{" "}
          <Code>template</Code> fields so every new card inherits sensible
          empty attributes.
        </P>
        <H2>Step 3 — Attributes short, refs explicit</H2>
        <P>
          Set attributes with <Code>op=set_attribute</Code>: keep values to a
          phrase. Add labelled edges with <Code>op=set_relationship</Code>{" "}
          (&ldquo;account&rdquo; —owned by→ &ldquo;rep&rdquo;) — the label
          carries the meaning a sentence would only describe.
        </P>
        <H2>Step 4 — Keep it current</H2>
        <P>
          When a project ships or a person changes role, update the object in
          the same session. A wrong graph misleads; a thin-but-true one is
          fine.
        </P>
      </>
    ),
  },
];

function StaticSkillsPane() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PaneFilter>("all");
  const [selectedId, setSelectedId] = useState<string>(DEMO_SKILLS[0].id);

  // Seeded corpus is all workspace-public, so scope filters other than
  // "all"/"workspace" empty the list — same behaviour as the real browser.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DEMO_SKILLS.filter((s) => {
      if (filter !== "all" && filter !== "workspace") return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    });
  }, [query, filter]);

  const selected =
    visible.find((s) => s.id === selectedId) ?? visible[0] ?? null;

  return (
    <div className="page-float flex antialiased">
      {/* List pane */}
      <div className="flex w-[372px] shrink-0 flex-col border-r border-border-default">
        <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
          <h1 className="text-title font-semibold tracking-tight text-text-primary">
            Skills
          </h1>
          <span className="text-caption text-text-muted">
            {DEMO_SKILLS.length}
          </span>
          <span className="flex-1" />
          <span
            title="New skill"
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary"
          >
            <Plus size={16} />
          </span>
        </div>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search skills"
          className="mx-3.5 mb-3"
        />

        <SegmentedControl
          options={PANE_FILTERS}
          value={filter}
          onChange={setFilter}
          className="mx-3.5 mb-3"
        />

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-default pb-4">
          {visible.length === 0 ? (
            <p className="px-4 py-2.5 text-caption leading-relaxed text-text-muted">
              {query.trim()
                ? "No skills match."
                : "No skills in this scope yet."}
            </p>
          ) : (
            <>
              <p className="px-4 pb-1 pt-3 text-label font-medium uppercase tracking-wider text-text-muted">
                Dopl
              </p>
              {visible.map((skill) => (
                <SkillRow
                  key={skill.id}
                  name={skill.name}
                  description={skill.description}
                  updated={skill.updated}
                  scope="workspace"
                  selected={selected?.id === skill.id}
                  onSelect={() => setSelectedId(skill.id)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Detail pane */}
      {selected && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col antialiased">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-title font-semibold tracking-tight text-text-primary">
                {selected.name}
              </span>
              <span className="btn-light flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-caption text-text-secondary">
                <Folder size={11} />
                {selected.folder}
              </span>
              <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border-strong bg-bg-inset px-2.5 text-caption font-medium text-text-secondary">
                <Building2 size={11} />
                Public
              </span>
            </div>
            <span className="text-small text-text-secondary/60">Saved</span>
            <span className="btn-light flex h-7 items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary">
              <History size={12} />
              History
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8">
              {selected.body}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
