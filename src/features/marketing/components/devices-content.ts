import {
  BellRing,
  Footprints,
  MessagesSquare,
  Mic,
  Plug,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/** Copy for the Devices band (devices-section.tsx). Edit here only.
 *
 *  Glasses facts (2026-10-15): the Even Realities G2 plugin
 *  (~/Downloads/glasses-mcp/plugin/README.md — push-to-talk voice, notify /
 *  show / ask / screen on the lens) and the glasses MCP tools
 *  (src/features/glasses/core/mcp/tools.ts › glasses_show, glasses_render,
 *  glasses_ask, glasses_update). Framing (Samuel, 2026-10-22): connecting a
 *  device hands its FUNCTIONS to one of your agent IDENTITIES (a standing role
 *  of yours), which then works through it.
 *  Panel copy is GENERIC (Samuel, 2026-10-23): no named identities or use
 *  cases (those live only in the cards' demos), no single vendor framing (it
 *  works with display glasses generally), few words, all white on the band.
 *  ⚠ The G2 has no camera or speaker: never list them for glasses.
 *  Robots + "More" are PLANNED: keep them framed as coming ("will").
 *  Copy rules: no em/en dashes, full sentences. */

/** One short sentence beside an icon. At most three per panel. */
export interface DeviceFeature {
  readonly icon: LucideIcon;
  readonly text: string;
}

export interface DevicePanel {
  readonly id: string;
  readonly eyebrow: string;
  readonly heading: string;
  readonly lede: string;
  readonly features: readonly DeviceFeature[];
  /** Live layer over the media: the G2 lens (glasses-hud.tsx) or the agent
   *  chat card (robot-chat.tsx). */
  readonly overlay?: "glasses-hud" | "robot-chat";
  /** `null` renders a neutral block of the same shape in the media slot.
   *  `pending: true` = the file is expected but not in public/ yet: the block
   *  shows instead (no 404). Drop the flag when the photo lands. */
  readonly image: { readonly src: string; readonly alt: string; readonly pending?: boolean } | null;
}

export const DEVICES: readonly DevicePanel[] = [
  {
    id: "glasses",
    eyebrow: "Display glasses",
    heading: "Your identities, right on your lens",
    lede: "Your identities put custom displays on your glasses and reach you there the moment work needs you.",
    features: [
      { icon: Plug, text: "Connect your glasses to Dopl in one click." },
      { icon: BellRing, text: "Updates from every channel arrive in one place." },
      { icon: Mic, text: "Reply out loud and your identities hear you, hands free." },
    ],
    image: { src: "/img/devices/glasses-grain.webp", alt: "Display glasses" },
    overlay: "glasses-hud",
  },
  {
    id: "robots",
    eyebrow: "Robots, coming soon",
    heading: "Your identities, in the physical world",
    lede: "Connect a robot and your identities will be able to move, handle objects and work alongside you.",
    features: [
      { icon: Footprints, text: "Every movement will be a tool call your identity makes." },
      { icon: ShieldCheck, text: "Anything you cannot undo will wait for your approval." },
      { icon: MessagesSquare, text: "You will direct the work from the channels you already use." },
    ],
    image: { src: "/img/devices/robot-v2.webp", alt: "Unitree G1 humanoid robot" },
    overlay: "robot-chat",
  },
  {
    id: "more",
    eyebrow: "Roadmap",
    heading: "Any device you connect",
    lede: "Every device you connect hands its functions to your identities as tools they can call.",
    features: [
      { icon: Plug, text: "Connecting a device takes a single step." },
      { icon: Sparkles, text: "Your requests decide which devices we support next." },
    ],
    image: { src: "/img/devices/devices-lineup-v4.webp", alt: "Car, robot, drone, glasses, watch, ring and other devices" },
  },
];
