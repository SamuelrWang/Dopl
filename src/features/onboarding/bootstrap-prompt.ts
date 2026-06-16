/**
 * The paste-into-your-agent BOOTSTRAP prompt + the static HTML card
 * template the agent fills and renders. Pure data — no React, no server
 * code, no AI keys. Dopl never generates the card itself: it hands the
 * agent this template and (from each write) an access-checked URL; the
 * agent fills the template and renders it inline.
 *
 * Copy here must stay MODEL-AGNOSTIC: no "Claude", "Codex", "Cursor",
 * etc. Address "your AI agent" / "your environment" only.
 */

import { MCP_SERVER_NAME } from "./constants";

/**
 * Self-contained HTML card (inline styles only, no external deps) so it
 * renders in any agent's HTML/artifact surface. The agent replaces the
 * `{{SLOT}}` placeholders with the content it just wrote:
 *   {{TITLE}}     entry/skill name
 *   {{TYPE}}      "Knowledge" | "Skill"
 *   {{SCOPE}}     the knowledge base or skill it belongs to
 *   {{BODY_HTML}} the entry/skill body, converted to HTML by the agent
 *   {{URL}}       the "View in Dopl" URL returned by the write tool
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
  <div style="padding:10px 16px;border-top:1px solid #f0f0f0;font-size:12px">
    <a href="{{URL}}" style="color:#4f46e5;text-decoration:none">view in Dopl →</a>
  </div>
</div>`;

/**
 * The bootstrap prompt. Drives an agent-led interview that fills the
 * user's workspace with genuinely useful, durable knowledge — and shows
 * each write as a rendered card. The agent supplies all content and does
 * all rendering; Dopl supplies the tools, the template, and the URLs.
 */
export function buildBootstrapPrompt(url: string): string {
  return `You are connected (or about to connect) to my Dopl workspace over MCP. Dopl stores three things my future agents read and write: KNOWLEDGE BASES (durable facts), SKILLS (repeatable procedures), and WORKFLOWS (multi-step pipelines that chain skills + knowledge). Your job right now is to help me build out genuinely useful, durable knowledge — by interviewing me, not by guessing.

CONNECT
- Server name: ${MCP_SERVER_NAME}. Transport: HTTP (streamable). URL: ${url}.
- It uses OAuth — a browser window opens once for me to sign in; no API key.
- Silently confirm the connection and my active workspace, and inspect your Dopl write tools (the dopl_kb / dopl_skill admin ops) so you know their operations. Don't write anything yet.

Then run this loop:

PHASE 1 — PROPOSE (once, first):
- Review what you ALREADY know about me: this conversation, your memory, my open project/files, my connected tools, recent tasks you've done for me.
- Surface 3–5 HIGH-VALUE topics worth recording. Bias hard toward things that are RECURRING (I do them repeatedly) and NON-OBVIOUS (you'd otherwise re-derive them every time). Skip anything trivial or easily looked up.
- Show them as a short ranked menu, one line each on WHY it's worth it.
- End with: "Pick one, or name your own." Then STOP and wait for me.

PHASE 2 — CLASSIFY:
When I pick a topic, classify it and tell me which it is:
- KB     = durable facts ("what is true": my stack, my customers, my rules)
- SKILL  = a procedure ("how I do X": how I run outreach)
- WORKFLOW = a multi-step pipeline (lead → email → follow-up)
State the type and which rubric you'll fill.

PHASE 3 — INTERVIEW (the core):
- Take the matching rubric below.
- FILL every slot you can from what you already know or can look up. Do NOT ask me anything you could answer yourself or find by opening a file/tool — go look instead of asking.
- Then ask me ONLY the genuinely empty/uncertain slots. 1–3 focused questions at a time, highest-value first. Every question must obviously feed the artifact.

PHASE 4 — WRITE + SHOW (do this every time you write):
- Write or update the artifact in Dopl with the admin tool, in the schema below. Keep each entry atomic (one topic).
- The write tool returns a line "View in Dopl: <url>". Use that URL.
- Then RENDER a visual card of what you wrote, INLINE, using your environment's HTML/artifact capability. Do NOT paste the raw text. Fill this template (replace every {{SLOT}}; convert the body to HTML yourself; self-contained, no external libraries):

${DOPL_CARD_TEMPLATE}

- Also surface the same URL as a plain clickable link, so I can open it even if the card can't render.
- If your environment can't render inline HTML, fall back to clean formatted markdown — never a raw text dump.
- Continue with more gap questions, or say: "This one looks solid — go deeper, or move to the next topic?"

PHASE 5 — NEXT:
When I say move on, return to the menu (refresh it if you've learned something new). Loop until I stop.

RULES:
- Fill-from-memory-first, ask-only-gaps. Never ask what you can infer or look up.
- Batch ≤3 questions. Always let me say "good enough, move on."
- Capture the NEGATIVES: what I removed, what I DON'T do, disqualifiers, gotchas. Half the value is anti-knowledge.
- Never write secrets, credentials, financial, or private personal data into the workspace.
- Don't finalize silently — every write gets a rendered card + the link.

RUBRICS:

KB (facts):
  Title · Purpose (1 line) · Facts (durable truths, bulleted) · Why (what breaks if ignored) · Related entries to link.
  Cover: scope, key facts, current state, rationale, gotchas/negatives.

SKILL (procedure):
  Name (verb phrase) · When-to-use (trigger) · Inputs · Steps (ordered) · Constraints/voice · Output · Gotchas.
  Cover: trigger, target, the steps, tone/constraints, success criteria, disqualifiers, one real example.

WORKFLOW (pipeline):
  Name · Trigger · Ordered stages (each → the skill/KB it uses) · Decision points/branches · End state.

Start PHASE 1 now.`;
}
