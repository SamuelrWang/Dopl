import {
  Image,
  PlaySquare,
  AudioLines,
  Scan,
  CirclePlus,
  Clipboard,
  MessageSquare,
  Flag,
  type LucideIcon,
} from "lucide-react";

export type MenuItemId =
  | "create-image"
  | "create-video"
  | "create-audio"
  | "new-frame"
  | "upload-media"
  | "paste"
  | "cursor-chat"
  | "report";

export interface MenuItem {
  id: MenuItemId;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  submenu?: Submenu;
}

export interface Submenu {
  title: string;
  groups: string[][];
}

export const MENU_SECTIONS: MenuItem[][] = [
  [
    {
      id: "create-image",
      label: "Create Image",
      icon: Image,
      submenu: {
        title: "Create Image",
        groups: [
          ["Flux 1.1", "Flux Kontext"],
          ["Imagen 4", "Imagen 4 Ultra"],
          ["Ideogram 3.0", "Recraft V3"],
          ["Nano Banana"],
        ],
      },
    },
    {
      id: "create-video",
      label: "Create Video",
      icon: PlaySquare,
      submenu: {
        title: "Create Video",
        groups: [
          ["Ray3.14", "Ray3.14 HDR"],
          ["Veo 3", "Veo 3.1"],
          ["Kling 2.6", "Kling 3.0", "Kling Omni"],
          ["Seedance 2.0"],
        ],
      },
    },
    {
      id: "create-audio",
      label: "Create Audio",
      icon: AudioLines,
      submenu: {
        title: "Create Audio",
        groups: [
          ["ElevenLabs v3"],
          ["Suno 4.5", "Udio 1.5"],
          ["MMAudio"],
        ],
      },
    },
  ],
  [
    { id: "new-frame", label: "New Frame", icon: Scan, shortcut: "F" },
    { id: "upload-media", label: "Upload Media", icon: CirclePlus, shortcut: "⌘U" },
    { id: "paste", label: "Paste", icon: Clipboard, shortcut: "⌘V" },
  ],
  [{ id: "cursor-chat", label: "Cursor Chat", icon: MessageSquare, shortcut: "/" }],
  [{ id: "report", label: "Report", icon: Flag }],
];
