/**
 * 🔒 THE AVATAR SCALE (Samuel, 2026-10-28; KB orchestration-guidelines › Audits/avatar-sizes-2026-10-28).
 * Every person face, agent face and stack in the app is one of these. Before this there were 13
 * fixed px values (14–44) and the smallest faces (task assignees, subtask owners) read as dots.
 *
 * - `xs` 16 — ONLY a face sitting inline in a line of text (a meta line), so the line keeps its height.
 * - `s` 20 — rows, lists, stacks, dialogs.
 * - `m` 30 — cards and headers; task assignees and subtask owners.
 * - `l` 40 — the hero face of a page or dialog (identity cards, member header).
 *
 * ⚠ ONE OUTER SIZE FOR PEOPLE AND AGENTS. An agent face's ring and frame sit INSIDE this box, so
 * its photo is smaller than a person's at the same scale; that is the ruling, do not enlarge agents.
 * The runtime badge is half the diameter (`identity-face.tsx`).
 */
export const AVATAR_PX = { xs: 16, s: 20, m: 30, l: 40 } as const;

export type AvatarScale = keyof typeof AVATAR_PX;
