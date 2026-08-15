/**
 * Paste-into-your-agent BOOTSTRAP prompt + the HTML card template the agent
 * fills and renders itself. Pure data — no React, no server code, no AI keys.
 *
 * ⚠ Copy must stay MODEL-AGNOSTIC: no "Claude"/"Codex"/"Cursor". Address
 * "your AI agent" / "your environment" only.
 */

import { MCP_SERVER_NAME } from "./constants";

/**
 * ⚠ Self-contained: inline styles only, no external deps — must render in any
 * agent's HTML/artifact surface. Agent fills the slots:
 *   {{TITLE}} entry/skill name · {{TYPE}} "Knowledge" | "Skill"
 *   {{SCOPE}} owning KB/skill · {{BODY_HTML}} body, HTML-converted by agent
 */
export const DOPL_CARD_TEMPLATE = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;border:1px solid #e6e6e6;border-radius:12px;overflow:hidden;background:#fff;color:#1a1a1a">
  <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #f0f0f0">
    <div style="flex:1;min-width:0">
      <div style="font-weight:500;font-size:15px">{{TITLE}}</div>
      <div style="font-size:12px;color:#8a8a8a">{{TYPE}} · {{SCOPE}}</div>
    </div>
    <span style="font-size:11px;background:#eef0ff;color:#4f46e5;padding:4px 9px;border-radius:6px;white-space:nowrap">written by your agent</span>
  </div>
  <div style="padding:14px 16px;font-size:14px;line-height:1.6">
    {{BODY_HTML}}
  </div>
</div>`;

/** Connect prompt (onboarding step 2) — MCP handshake only; the seeding
 *  prompt comes on the next step. */
export function buildConnectPrompt(url: string): string {
  return `Connect to the Dopl MCP server using HTTP (streamable) at ${url}. If your environment can't add MCP servers via CLI or command, walk me through adding it manually using the server name and URL above and authenticating via OAuth.`;
}

/** Agent-led interview that seeds the workspace. Agent supplies all content
 *  and rendering; Dopl supplies tools, template, URLs. */
export function buildBootstrapPrompt(url: string): string {
  return `You are connected (or about to connect) to my Dopl workspace over MCP. Dopl stores two things my future agents read and write: KNOWLEDGE BASES (durable facts) and SKILLS (repeatable procedures). Your job right now is to help me build out genuinely useful, durable knowledge — by interviewing me, not by guessing.

CONNECT
- Server name: ${MCP_SERVER_NAME}. Transport: HTTP (streamable). URL: ${url}.
- It uses OAuth — a browser window opens once for me to sign in; no API key.
- Silently confirm the connection and my active workspace, and inspect your Dopl write tools (the dopl_kb / dopl_skill admin ops) so you know their operations. Don't write anything yet.

PHASE 0 — INSTANT SEED (do immediately, before anything else):
- From what you ALREADY know (your memory, this conversation, my open project/files), write ONE small, high-confidence KB entry right now. Ask nothing first.
- Render its card (PHASE 3), then tell me in one line: "Here's a first entry so you can see how this works; correct anything that's wrong."
- Then go to PHASE 1.

PHASE 1 — PROPOSE (once):
- Review what you already know about me: this conversation, your memory, my open project/files, connected tools, recent tasks.
- Surface exactly 3 high-value topics worth recording. Bias hard toward RECURRING and NON-OBVIOUS things; skip anything trivial or easily looked up. One line each on WHY it's worth it.
- End with "Pick one, or name your own." Then STOP and wait.

PHASE 2 — INTERVIEW:
- Open with one line naming the type: "This is a KB / SKILL; filling that rubric." (KB = durable facts; SKILL = how I do X.)
- Take the matching rubric below and FILL every slot you can from what you know or can look up. Never ask what you could answer yourself or find by opening a file/tool.
- Then ask ONLY the genuinely empty slots, ≤3 focused questions at a time, highest-value first.

PHASE 3 — WRITE + SHOW (every time you write):
- Write or update the artifact with the admin tool, in the schema below, one atomic topic per entry.
- RENDER a visual card of what you wrote, inline, using your environment's HTML/artifact capability — fill this template (replace every {{SLOT}}, convert the body to HTML, self-contained, no external libraries):

${DOPL_CARD_TEMPLATE}

- If you can't render inline HTML, fall back to clean markdown — never a raw text dump.
- Then continue with more gap questions, or ask: "Go deeper, or move to the next topic?"

PHASE 4 — NEXT:
- When I move on, return to the menu (refresh it if you've learned something new). Loop until I stop.

RULES:
- Fill from memory first; ask only real gaps. Batch ≤3 questions and always let me say "good enough, move on."
- Capture the NEGATIVES: what I removed, what I DON'T do, disqualifiers, gotchas. Half the value is anti-knowledge.
- Never write secrets, credentials, or private personal data.
- Every write gets a rendered card. Keep entries atomic.

RUBRICS:

KB (facts): Title · Purpose (1 line) · Facts (durable truths, bulleted) · Why (what breaks if ignored) · Related entries to link.

SKILL (procedure): Name (verb phrase) · When-to-use (trigger) · Inputs · Steps (ordered) · Constraints/voice · Output · Gotchas.

Start PHASE 0 now.`;
}
