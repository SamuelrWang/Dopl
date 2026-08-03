/**
 * Locked tour copy — 7 step cards + the finish card. Titles match the
 * sidebar labels; `section` is the route section each step navigates to
 * (reused with the `sectionPath` helper). Pure data — no React.
 *
 * Copy here is FINAL and verbatim. No em dashes anywhere in this file's
 * user-facing strings (owner explicitly banned them).
 */

// Deep import, never the `app-shell` barrel: the barrel re-exports the
// Next-bound `AppShell`, and this module is in the desktop renderer's graph.
import type { NavSection } from "@/shared/layout/app-shell/app-sidebar-core";

export type TourStep = {
  section: NavSection;
  title: string;
  body: string;
};

export const TOUR_STEPS: readonly TourStep[] = [
  {
    section: "ontology",
    title: "Ontology",
    body: "The ontology holds the things your agent works with: people, projects, accounts, and tools, stored as structured objects with attributes and connections. Structure is what makes your agent effective. It finds the exact object it needs, sees what's connected, and acts without loading piles of context. Add objects here yourself, or just tell your agent what exists and it will build them for you.",
  },
  {
    section: "canvas",
    title: "Canvas",
    body: "Canvas is the same ontology, shown as a graph. Every object is a node and every relationship is a line, so you can see how everything connects, and what's missing or out of date. Drag nodes to arrange them, click one to inspect it.",
  },
  {
    section: "workflows",
    title: "Workflows",
    body: "A workflow is a step-by-step process your agent runs the same way every time. Each step is a node, with branches where decisions happen, and steps can pull in your skills and knowledge along the way. Build one here, then tell your agent to run it. It walks the steps in order.",
  },
  {
    section: "knowledge",
    title: "Knowledge",
    body: "Knowledge holds the facts that don't change often: your tools, your customers, your rules. It works like folders of documents that both you and your agent can read and write. Your agent pulls the right entry when it starts a task, and saves new facts as it learns them, so every future session already knows what this one figured out.",
  },
  {
    section: "skills",
    title: "Skills",
    body: "A skill is a procedure for how you do something, like how you write outreach or how you review code. It tells your agent when to use it and which steps to follow, so the work gets done your way every time. Write one here, or finish a task with your agent and tell it to save the method as a skill.",
  },
  {
    section: "chats",
    title: "Chats",
    body: "Chats is the archive of your agent conversations. Save a session when it produced decisions or context worth keeping. A future session can read it and continue where this one stopped. Just tell your agent to save the chat to Dopl at the end of a good session.",
  },
  {
    section: "members",
    title: "Members",
    body: "Workspaces are shared. Invite your team here, give each person a role, and group them into teams. Everyone's agents then work from the same ontology, knowledge, and skills, and an agent's permissions always match its user's. One set of data for the whole team.",
  },
];

export type TourFinish = {
  section: NavSection;
  title: string;
  body: string;
  prompt: string;
};

export const TOUR_FINISH: TourFinish = {
  section: "overview",
  title: "That's the tour!",
  body: "Your agent can read this whole workspace, so ask it anything you want to go deeper on.",
  prompt:
    "You're connected to my Dopl workspace over MCP. Explore it and tell me what's in the ontology, workflows, knowledge, skills, and chats. Explain how the pieces fit together and how I should use them day to day.",
};
