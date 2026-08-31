/**
 * THE ADDRESSABLE HANDLE OF ONE AGENT SESSION, AND THE SENTENCE THAT HAS TO
 * TRAVEL WITH IT.
 *
 * ⚠ ITS OWN FILE at the §2 500-line cap (2026-08-31) — `channel-session-render.ts`
 * was at 455 and this is ~70 lines of prose. The seam is also a real one:
 * that file answers "what STATE is this session in", this one answers "what may
 * I DO about it", and the second question changes when the WAKE RULES change,
 * which is a different clock entirely.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) and by the removed-vocabulary source scan
 * (channel-law.test.ts), which reads every non-test `channel-*.ts` here.
 */
/**
 * THE ADDRESSABLE HANDLE for one session row, or `null` when the row's name is
 * not an agent id this build can address.
 *
 * ⚠ **THE `agent-` PREFIXED FORM, AND ONLY THAT FORM.** The desktop parser takes
 * both `@<id>` and `@agent-<id>` (`main/session-dispatch.js › mentionedAgentIds`,
 * F-350's regex), and the web's own picker inserts the prefixed one
 * (`lib/agent-mentions.ts › agentMentionHandle`). Publishing the bare form here
 * while the renderer tints the prefixed one is exactly the tint-says-tagged /
 * stamp-says-nobody split F-266 cost a wave to close, one namespace over — so
 * this surface names ONE form and it is the one the product writes everywhere
 * else.
 *
 * ⚠ **A CUSTOM NAME IS NEVER A HANDLE HERE.** An operator may rename an agent
 * ("Research Bot" → the `@research-bot` slug door), but that rename lives in
 * `main/agent-names.js`, on ONE machine, keyed by an id minted on that machine.
 * No server holds it and this projection never carries it. So the id form is the
 * only handle an MCP caller can know, and the copy says so rather than letting a
 * caller infer that a name it saw in the Dopl app would work from here.
 */
export declare function addressableHandle(name: string): string | null;
/**
 * WHAT THE HANDLE IN EACH LINE IS, AND — THE HALF THAT WAS MISSING — HOW TO
 * SPEND IT (2026-08-31, from the live repro in ENGINEERING).
 *
 * ⚠ **THIS EXISTS BECAUSE THE PRODUCT PUBLISHED AN ADDRESS AND NOT ITS RULE.**
 * An external orchestrator asked for an agent, was handed an id, wrote `@<id>`
 * into five posts exactly as `launch_agent`'s result told it to, and woke
 * nothing — the loop fence refused every agent-authored message, its own
 * included. Nothing refused the posts, nothing warned, and the caller had no way
 * to learn it. TWO RULINGS FOLLOWED (both 2026-08-31, both Samuel's), and this
 * copy exists to state the surface they leave behind:
 *   1. **THE SAME-ACCOUNT CARVE.** An agent-authored message posted under the
 *      OPERATOR'S OWN user id may @-wake that operator's dormant agents. An MCP
 *      caller holds its operator's credential, so this handle IS spendable by
 *      the caller reading this line. A PEER's agent stays unreachable, and an
 *      UNADDRESSED post still starts nobody.
 *   2. **A LAUNCH WITH A GOAL RUNS.** So the common case needs no wake at all,
 *      and the copy says that FIRST — an orchestrator that reaches for the wake
 *      when it should have sent a goal has spent two calls and a turn.
 *
 * ⚠ **IT DESCRIBES THE FENCE THAT REMAINS, AND MUST NOT READ AS A WORKAROUND
 * FOR IT.** What is still refused — an unaddressed agent post, and anything
 * touching a peer's agent — is deliberate (INVARIANTS §11: two agents that can
 * wake each other on unaddressed prose is a loop with no operator in it). The
 * carve is narrow ON PURPOSE and the copy carries the boundary, not a hint.
 *
 * ⚠ **AND IT STILL MAY NOT PROMISE DELIVERY.** The wake is decided on the
 * operator's DESKTOP, over ids minted there; no server sees the outcome. It also
 * cannot say whether a given row is dormant — a session between turns and one
 * whose query was torn down both report `idle` — so the sentence says the wake
 * is ATTEMPTED and names the one observable that answers it.
 */
export declare const SESSION_HANDLE_NOTE = "The token in backticks after each name is that session's ADDRESSABLE HANDLE. The `@agent-<id>` form is the only one that means anything outside your operator's own machine \u2014 a friendly name they may have given the agent in the Dopl app is stored on that ONE machine, reaches no server, and can never be addressed from here. \u26A0 BEFORE YOU REACH FOR IT: a launch that carried a `goal` is ALREADY WORKING on it, so waking is for agents you need to REDIRECT, not for ones you just started. WRITING `@agent-<id>` IN A POST BODY WAKES THAT AGENT, and this is the one case where a handle addresses an agent rather than a person: the token is parsed on your operator's machine, never by the server's mention resolver, so it stamps nobody and lands in no Tags inbox. THREE LIMITS, and they are the fence rather than a knack: (1) it must NAME the agent \u2014 an unaddressed post of yours starts nobody, whatever it says, because agents do not wake each other by talking; (2) it works only for YOUR OWN operator's agents \u2014 you post under their account, which is what licenses it, and no post of yours can start a session on another member's machine; (3) delivery is not observable from here, because the wake happens on a desktop this server cannot see. So treat the post as a REQUEST: watch for the agent's own posts, or its state changing here, rather than assuming it woke.";
