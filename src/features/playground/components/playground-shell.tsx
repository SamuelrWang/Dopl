"use client";

import { useState } from "react";
import type { ComponentType } from "react";
import {
  BookOpen,
  Hash,
  MessagesSquare,
  Network,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { PlaygroundSessionProvider } from "../session";
import type { PlaygroundSection } from "../types";
import { ConnectStrip } from "./connect-strip";
import styles from "./playground-shell.module.css";
import { OntologyPane } from "./panes/ontology-pane";
import { KnowledgePane } from "./panes/knowledge-pane";
import { SkillsPane } from "./panes/skills-pane";
import { ChatsPane } from "./panes/chats-pane";
import { ChannelsPane } from "./panes/channels-pane";
import { MembersPane } from "./panes/members-pane";

/**
 * The real shell's `NAV` minus Overview — same labels, icons and order
 * otherwise (`app-sidebar-core.tsx › NAV`). Kept local rather than filtered
 * from the real array so the playground never re-renders when the app's nav
 * grows a section the demo has no pane for.
 */
const NAV: ReadonlyArray<{
  label: string;
  icon: LucideIcon;
  section: PlaygroundSection;
}> = [
  { label: "Ontology", icon: Network, section: "ontology" },
  { label: "Knowledge", icon: BookOpen, section: "knowledge" },
  { label: "Skills", icon: Sparkles, section: "skills" },
  { label: "Chats", icon: MessagesSquare, section: "chats" },
  { label: "Channels", icon: Hash, section: "channels" },
  { label: "Members", icon: Users, section: "members" },
];

const PANES: Record<PlaygroundSection, ComponentType> = {
  ontology: OntologyPane,
  knowledge: KnowledgePane,
  skills: SkillsPane,
  chats: ChatsPane,
  channels: ChannelsPane,
  members: MembersPane,
};

/**
 * Mirror of the app shell for the public /playground page. Same chrome as
 * `AppSidebarCore` + `app-shell.module.css` (the module's classes are reused
 * directly, so the two cannot drift), with the routed parts swapped out: nav
 * chips are local-state buttons, the workspace switcher is a static brand
 * pill, and there is no settings gear. Panes render their static demo content
 * until a session starts (`../session`), then poll the guest workspace live.
 */
export function PlaygroundShell() {
  return (
    <PlaygroundSessionProvider>
      <ShellChrome />
    </PlaygroundSessionProvider>
  );
}

function ShellChrome() {
  const [section, setSection] = useState<PlaygroundSection>("ontology");
  const Pane = PANES[section];

  return (
    <div className={styles.frame}>
      <div className={shell.body}>
        <div className={shell.surface}>
          <aside className={shell.sidebar}>
            {/* Brand slot: static twin of the workspace-switcher pill. */}
            <div className={shell.brand}>
              <div className={cn(shell.brandPill, styles.brandStatic)}>
                <span className={shell.brandPillText}>
                  <span className={shell.brandPillName}>Dopl Playground</span>
                  <span className={shell.brandPillSub}>demo</span>
                </span>
              </div>
            </div>

            <nav className={shell.nav}>
              {NAV.map(({ label, icon: Icon, section: navSection }) => (
                <button
                  key={navSection}
                  type="button"
                  className={cn(
                    // Kit's ONE nav-chip recipe (globals.css); the shell
                    // module contributes column layout only.
                    "nav-chip",
                    navSection === section && "nav-chip-active raised-tab"
                  )}
                  aria-current={navSection === section || undefined}
                  onClick={() => setSection(navSection)}
                >
                  <Icon size={20} strokeWidth={1.8} />
                  {label}
                </button>
              ))}
            </nav>
          </aside>

          {/* Connect strip above the pane, both in a column so panes keep
              rendering bare and wrapping themselves in one `.page-float`,
              exactly like real pages in the app shell. */}
          <div className={styles.paneColumn}>
            <ConnectStrip />
            <Pane key={section} />
          </div>
        </div>
      </div>
    </div>
  );
}
