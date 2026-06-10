import {
  BookOpen,
  MessageSquare,
  Sparkles,
  SquarePlus,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type MenuItemId =
  | "new-cluster"
  | "new-node"
  | "new-chat"
  | "open-knowledge"
  | "open-skills";

export interface MenuItem {
  id: MenuItemId;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

/**
 * Canvas context-menu items (right-click / double-click on empty canvas).
 * Every item dispatches a real store action via the onAction callback in
 * CanvasContextMenu — no decorative entries. The node-block item joins
 * this list with the node panel type (workflow builder phase 2).
 */
export const MENU_SECTIONS: MenuItem[][] = [
  [
    {
      id: "new-cluster",
      label: "New cluster",
      icon: Workflow,
    },
    {
      id: "new-node",
      label: "New node",
      icon: SquarePlus,
    },
  ],
  [
    {
      id: "new-chat",
      label: "New chat",
      icon: MessageSquare,
    },
  ],
  [
    {
      id: "open-knowledge",
      label: "Knowledge bases",
      icon: BookOpen,
    },
    {
      id: "open-skills",
      label: "Skills",
      icon: Sparkles,
    },
  ],
];
