/**
 * Every word in the Monitoring section, the left-column claim AND the strings
 * drawn inside the activity log, in one place so copy can change without
 * touching markup. Markup: ./control-section.tsx (shell), ./control-log.tsx
 * (the log).
 *
 * ⚠ `at` is ms from the moment the log starts playing (./use-visual-play.ts).
 */

export const CONTROL_COPY = {
  eyebrow: "Monitoring",
  heading: "Activity, approvals, and a full audit trail",
  /** ⚠ Order is the argument: see it → trace it → gate it → stop it. */
  bullets: [
    "Every identity always acts under a permission you chose",
    "You have a full record of every action",
    "Sensitive steps always wait for your approval",
    "Pause any identity at any time",
  ],
  primaryCta: "Learn more",
  secondaryCta: "Talk to the team",
} as const;

/** Who did it; also picks the face in control-log.tsx: `admin` = the
 *  Multiplayer section's Admin Assistant (multiplayer-content.ts › AGENT),
 *  `robot` = the Robots card's G1 (robot-chat-content.ts › ROBOT_AGENT), the
 *  rest = the Orchestration identities (ontology-content.ts › AGENTS). */
export type LogIdentity = "admin" | "robot" | "scout" | "liaison" | "booker";

/** `auto` = ran under the Auto level; `approval` = held for the user, then
 *  approved at `approvedAt`; `paused` = the identity was paused. */
export type LogPermission =
  | { readonly kind: "auto" }
  | { readonly kind: "approval"; readonly approvedAt: number }
  | { readonly kind: "paused" };

export interface LogRow {
  readonly id: string;
  readonly who: LogIdentity;
  readonly did: string;
  /** Where it happened; drawn muted after the action. */
  readonly where?: string;
  readonly time: string;
  readonly permission: LogPermission;
  /** When the row lands. */
  readonly at: number;
}

export const LOG_COPY = {
  title: "Activity",
  live: "Live",
  all: "All",
  /** Filter chips, in this order after "All". */
  names: {
    admin: "Admin Assistant",
    robot: "Unitree G1",
    scout: "Scout",
    liaison: "Liaison",
    booker: "Booker",
  } satisfies Record<LogIdentity, string>,
  permission: {
    auto: "Auto",
    waiting: "Waiting for you",
    approved: "Approved by you",
    paused: "Paused",
  },
  /** The identity whose chip shows the paused state at the end. */
  pausedWho: "booker" as LogIdentity,
} as const;

/** OLDEST FIRST, the order they land. The log draws newest on top. */
export const LOG_ROWS: readonly LogRow[] = [
  {
    id: "scout",
    who: "scout",
    did: "Compared 12 venues in Lisbon",
    where: "Knowledge",
    time: "2:09pm",
    permission: { kind: "auto" },
    at: 300,
  },
  {
    id: "liaison",
    who: "liaison",
    did: "Collected Grace's availability",
    where: "q1-offsite",
    time: "2:11pm",
    permission: { kind: "auto" },
    at: 1000,
  },
  {
    id: "admin",
    who: "admin",
    did: "Booked Jordan Lee for Thu 10am",
    where: "iMessage",
    time: "2:14pm",
    permission: { kind: "auto" },
    at: 1700,
  },
  {
    id: "robot",
    who: "robot",
    did: "Ran throw_away(soda_can)",
    where: "Living room",
    time: "2:16pm",
    permission: { kind: "approval", approvedAt: 3300 },
    at: 2400,
  },
  {
    id: "booker",
    who: "booker",
    did: "Booked 5 flights to Lisbon",
    where: "q1-offsite",
    time: "2:18pm",
    permission: { kind: "auto" },
    at: 3800,
  },
  {
    id: "booker-paused",
    who: "booker",
    did: "Paused by you",
    time: "2:19pm",
    permission: { kind: "paused" },
    at: 4600,
  },
];
