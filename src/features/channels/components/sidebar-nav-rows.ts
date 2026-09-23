/**
 * The sidebar's hardcoded nav rows: no backing data of any kind yet, so the one consumer carries the
 * `// HARDCODED — no backing data yet` marker (INVARIANTS §5). Never render zeros from missing data.
 */

import { Bookmark, FileText, Sparkles, type LucideIcon } from "lucide-react";

export interface NavRowSpec {
  id: string;
  label: string;
  icon: LucideIcon;
  isNew?: boolean;
}

export const HARDCODED_NAV_ROWS: NavRowSpec[] = [
  { id: "assistant", label: "Assistant", icon: Sparkles, isNew: true },
  { id: "drafts", label: "Drafts", icon: FileText },
  { id: "saved", label: "Saved items", icon: Bookmark },
];
