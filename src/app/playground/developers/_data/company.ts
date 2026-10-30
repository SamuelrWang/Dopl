/**
 * The demo's one fictional customer. Every id, count and name on every page of
 * `/playground/developers` hangs off these files; nothing here is real and nothing is fetched.
 */
export const DEMO_NOW = "2026-10-29T16:40:00.000Z";

export const COMPANY = { id: "org_larkfield", name: "Larkfield Field Service" } as const;

export const PROJECTS = [
  { value: "prj_assist", label: "Larkfield Assist" },
  { value: "prj_dispatch", label: "Larkfield Dispatch" },
] as const;

export type Env = "test" | "live";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: "Owner" | "Admin" | "Developer" | "Viewer";
  lastActive: string;
}

export const MEMBERS: Member[] = [
  { id: "mem_1", name: "Priya Halloran", email: "priya@larkfield.example", role: "Owner", lastActive: "2026-10-29T16:12:00.000Z" },
  { id: "mem_2", name: "Jonas Eklund", email: "jonas@larkfield.example", role: "Admin", lastActive: "2026-10-29T14:48:00.000Z" },
  { id: "mem_3", name: "Mei Tanaka-Ross", email: "mei@larkfield.example", role: "Developer", lastActive: "2026-10-29T16:31:00.000Z" },
  { id: "mem_4", name: "Dario Vance", email: "dario@larkfield.example", role: "Developer", lastActive: "2026-10-27T18:05:00.000Z" },
  { id: "mem_5", name: "Ruth Adeyemi", email: "ruth@larkfield.example", role: "Viewer", lastActive: "2026-10-21T09:20:00.000Z" },
];

export const minsAgo = (m: number): string => new Date(Date.parse(DEMO_NOW) - m * 60_000).toISOString();
