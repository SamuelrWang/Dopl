/** The run the Devices band's robots card plays (robot-chat.tsx). Edit here only.
 *
 *  ⚠ PLANNED, NOT SHIPPED: Unitree robots over a ROS 2 / MCP bridge are on the
 *  roadmap (the card stays "Coming soon", devices-content.ts). Tool names are
 *  illustrative.
 *
 *  The story (Samuel, 2026-10-22): connecting the robot lets one of the user's
 *  agent IDENTITIES inhabit it. House Cleaner is a standing role of the user,
 *  not a one-off task; the Unitree G1 is just the device it runs on, the same
 *  way the user's messages come from their smart glasses. Physical actions
 *  still wait for a person: it asks before throwing something out. */

export type RobotBeat =
  /** Links the robot: the connect pill reveals ROBOT_CONNECTION's functions one chip at a time. */
  | { readonly kind: "connect"; readonly id: string; readonly hold: number }
  /** A message from the user, posted at once, with its sent-from device pill. */
  | { readonly kind: "user"; readonly id: string; readonly text: string; readonly hold: number }
  /** A tool call: spinner for `run` ms, then ✓. */
  | { readonly kind: "tool"; readonly id: string; readonly call: string; readonly run: number; readonly hold: number }
  /** The agent's reply, typed in word by word, with its sent-from device pill. */
  | { readonly kind: "agent"; readonly id: string; readonly text: string; readonly hold: number };

/** The identity in the robot: the user's own photo (an identity is a role OF
 *  the user) ringed in agent colour slot `color`, its runtime (Claude) inset —
 *  onboarding/components/paired-avatar.tsx's recipe. What it runs on is stated
 *  once, by its replies' device pill (ROBOT_AGENT_DEVICE). */
export const ROBOT_AGENT = {
  name: "House Cleaner",
  runtimeLogo: "/img/onboarding/claude-logo.svg",
  color: 3,
} as const;

/** The user — the same photo the hero demo gives Samuel (banner-demo/demo-data.ts). */
export const ROBOT_USER = { name: "You", photo: "/img/avatars/daniel.jpg" } as const;

/** Every robot action is a Dopl tool call (the onboarding transcript's tool row). */
export const ROBOT_VIA = { name: "Dopl", mark: "/img/onboarding/dopl-mark.png" } as const;

/** Where the user's messages are sent from — drawn as the channels device
 *  pill (channels/components/device-pill.tsx). `kind` picks its glyph. */
export const ROBOT_USER_DEVICE = { kind: "glasses", label: "Smart glasses" } as const;

/** Where the identity's replies come from — the same pill, naming the device.
 *  DeviceKind has no humanoid kind; robot-chat.tsx passes its glyph directly. */
export const ROBOT_AGENT_DEVICE = { label: "Unitree G1" } as const;

/** What connecting the robot would hand to agents. Tool calls below are
 *  named by these namespaces so the run reads as the agent driving them. */
export const ROBOT_CONNECTION = {
  device: "Unitree G1",
  takeover: "House Cleaner is now in control.",
  functions: ["walk", "arm", "camera", "speak"],
} as const;

/** Chip cadence for the connect pill, ms. */
export const ROBOT_CONNECT_MS = 260;

export const ROBOT_FEED: readonly RobotBeat[] = [
  { kind: "connect", id: "connect", hold: 700 },
  {
    kind: "user",
    id: "ask",
    text: "I'm coming home with some guests, can you clean up the living room?",
    hold: 900,
  },
  { kind: "tool", id: "scan", call: "camera.scan(living_room)", run: 1200, hold: 350 },
  { kind: "tool", id: "pick", call: "arm.pick_up(soda_can)", run: 1200, hold: 350 },
  {
    kind: "agent",
    id: "ask-soda",
    text: "Looks like your soda's still half full. Should I still throw it away?",
    hold: 1200,
  },
  { kind: "user", id: "toss", text: "Yeah, toss it.", hold: 800 },
  { kind: "tool", id: "walk-trash", call: "walk.to(trash_can)", run: 1300, hold: 350 },
  { kind: "tool", id: "throw", call: "arm.throw_away(soda_can)", run: 1000, hold: 350 },
  { kind: "agent", id: "done", text: "Done. The living room's ready for your guests.", hold: 2800 },
];

/** Word cadence for the agent's typed reply, ms. */
export const ROBOT_WORD_MS = 110;

/** Fade-out before the run restarts, ms (matches robot-chat.css). */
export const ROBOT_LOOP_FADE_MS = 450;
