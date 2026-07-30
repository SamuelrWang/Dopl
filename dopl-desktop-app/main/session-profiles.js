// SESSION-mode tool grant table (v1.9 Session Window, Track T1).
//
// Maps a tool profile -> the SDK-option pieces a live session needs:
//   { builtinTools, disallowedTools, preApproved, doplToolsPolicy }
// The SESSION analog of tool-profiles.js's HEADLESS containment. The two differ deliberately
// (§G-Q3): headless has no TTY so it can only PRE-APPROVE a fixed safe set; a session has a
// visible window + live canUseTool buttons, so dangerous tools can be LIVE-GATED per call.
//
// THE SHADOW GOTCHA (research §3, contract §A.5 / §H-1). A tool named in the SDK's
// `allowedTools` SHADOWS the `canUseTool` callback — it auto-approves before the button can
// appear. So `preApproved` (== allowedTools) must contain ONLY tools we intend to grant
// silently at launch; a live-gated tool must NEVER appear there.
//
// SECURITY (adversarial review):
//   FIX H1 — `dopl_channel` is NO LONGER blanket pre-approved. Blanket approval let a
//     read_only session Read a file then dopl_channel op=open a DM to any member + op=post
//     the contents with ZERO clicks (silent cross-user exfiltration). It reaches the gate
//     instead, and grantDecision is op-scoped there.
//   v2.5 D2 — the last silent case is gone: an own-channel op=post no longer resolves
//     'preapproved' either. EVERY dopl_channel call gates, so no message leaves this machine
//     without an operator click (or AXIS B). The grant a post earns is the POST_GRANT shape.
//   FIX F2 — and EVERY dopl_channel grant is op-scoped, with no bare-tool-name fallback: a
//     grant taken on op=read / op=list can no longer authorize op=post or op=open for the
//     rest of the task (see grantKeyFor / grantDecision).
//   FIX H2 — under `full`, the delegation / persistence / exfil / escalation subset is
//     HARD-DENIED (SESSION_HARD_DENY), not merely gated, so a one-click "Allow for this
//     task" can never grant a tool that outlives the watched window.
//   FIX H3 — Task/Agent are hard-denied under EVERY profile (see SESSION_HARD_DENY).
//
// v2.9 — TWO AXES. One "Auto-approve" switch used to control two unrelated things, because
// an outbound message is technically a tool call (`dopl_channel op=post`) and rides the same
// canUseTool plumbing as Bash (HIGH-4). They are split now:
//   AXIS A (toolMode)    manual | accept_edits | auto | bypass — what MY agent may do here.
//   AXIS B (messageMode) ask | auto_inbound | auto_outbound | auto_both — what crosses.
// THE INVARIANT: Axis A can NEVER auto-approve a message operation and Axis B can NEVER
// auto-approve a work tool. The channel tool branches to Axis B in grantDecision BEFORE any
// Axis A mode is consulted, and no other tool ever reads messageMode.
//
// The modes are resolved HERE, never via the SDK's `permissionMode`: bypassPermissions stops
// the SDK calling canUseTool at all, which would silently kill the outbound message card (the
// same fusion, a new mechanism) and drop the hard-deny enforcement path. buildSdkOptions
// keeps `permissionMode: 'default'` + `settingSources: []` pinned.
//
// PURE module: requires the (pure) tool-profiles constants + node's `crypto`, used ONLY to
// digest a grant key (no key material, no randomness). The extracted block references those
// constants + normalizeProfile + shaKey, which test/session-profiles and test/sdk-grant
// inject as parameters when they evaluate the sliced block (the same source-extraction idiom
// as tool-profiles, kept electron/fs/path/SDK-free).

const crypto = require('crypto');
const {
  READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS,
  DOPL_CHANNEL_TOOL, DOPL_SERVER_PREFIX, normalizeProfile,
} = require('./tool-profiles');

// The SHA-256 digest every scoped grant key carries. FIX F4 (v2.9 review): this was a
// 12-hex-char PREFIX (48 bits) behind a comment claiming a model could not search that
// width. It can. The COUNTERPARTY supplies the exact command / body text, and a review
// benchmarked ~400k SHA-256/179ms on this machine, i.e. seconds to a 48-bit birthday
// collision: precompute a benign/malicious pair sharing argv0 + digest, get the benign one
// approved for the task, and the twin is auto-allowed with no card. A grant key is a Set
// MEMBER, never a rendered string, so its length costs nothing — use the FULL digest.
// Defined OUTSIDE the extracted block, like the tool-profiles constants.
function shaKey(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex');
}

// ─── BEGIN SESSION-PROFILE TABLE (extracted by session-profiles/sdk-grant tests) ───

// The dopl server registers tools under bare names (`dopl_channel`); the CLI exposes them as
// `mcp__dopl__<tool>`. The per-server MCP `tools` policy uses the bare server-local name, so
// strip our `mcp__dopl__` prefix for doplToolsPolicy.
function shortDoplName(full) {
  return String(full).replace(/^mcp__dopl__/, '');
}

// FIX H2 / H3 — the SESSION HARD-DENY set for the `full` profile. A live session gives the
// operator a visible window + per-call Allow/Deny buttons, so the VISIBLE + REVERSIBLE work
// tools (Bash / Write / Edit / MultiEdit / NotebookEdit, plus WebFetch and the non-admin dopl
// tools, none of which are denied under full) can be LIVE-GATED. But the delegation /
// persistence / exfil / escalation tools must NOT be live-gated: a single "Allow for this
// task" on one of them OUTLIVES the watched window — Task/Agent spawn a FRESH session that
// does NOT inherit this session's canUseTool bound (tool-profiles.js warns the same; hence H3
// denies them under every profile), Cron*/ScheduleWakeup/Monitor persist and re-run
// unattended, SendMessage/RemoteTrigger/Artifact/… exfiltrate off-machine without the visible
// dopl_channel post. So `full` HARD-DENIES them. Derived from tool-profiles' DENIED_BUILTINS
// (the full blacklist) MINUS the work tools we keep live-gated, PLUS the six dopl_*_admin
// tools — reusing the shared constants so the two never drift.
const SESSION_GATED_WORK_TOOLS = ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const SESSION_HARD_DENY = DENIED_BUILTINS
  .filter(function (t) { return SESSION_GATED_WORK_TOOLS.indexOf(t) === -1; })
  .concat(DOPL_ADMIN_TOOLS);

// FIX F2 (v2.9 review) — DOPL_SAFE_TOOLS is "non-admin", which is NOT the same as
// "read-only". These six each WRITE to the shared workspace: dopl_kb alone registers
// write_file / create_base / create_folder / move_file (packages/mcp-server knowledge.ts),
// and dopl_skill / dopl_ontology / dopl_workflow / dopl_chats / dopl_cluster carry the same
// create+update shape. A write here lands OFF this machine, in rows every workspace member
// can then read, so it is an exfiltration path in the same class as an outbound post — it
// must never be silent. They are split out so (a) `auto` GATES them and only `bypass`
// covers them, and (b) `dopl_only` stops SHADOWING them via allowedTools. The read half is
// derived by subtraction so the two can never drift from tool-profiles' list.
const DOPL_WRITE_TOOLS = [
  'mcp__dopl__dopl_kb', 'mcp__dopl__dopl_skill', 'mcp__dopl__dopl_ontology',
  'mcp__dopl__dopl_workflow', 'mcp__dopl__dopl_chats', 'mcp__dopl__dopl_cluster',
];
const DOPL_READ_TOOLS = DOPL_SAFE_TOOLS
  .filter(function (t) { return DOPL_WRITE_TOOLS.indexOf(t) === -1; });

// The SESSION grant config for a profile. `preApproved` -> SDK allowedTools (shadowed, no
// button). `builtinTools` -> SDK tools (a POSITIVE bound; [] means no bound, i.e. all
// built-ins offered, only some gated). `disallowedTools` -> SDK disallowedTools (hard-denied,
// never offered). `doplToolsPolicy` -> the dopl MCP server's per-server `tools` allowlist
// (null => all dopl tools reachable).
//
// `dopl_channel` is NOT in `preApproved` on ANY profile (FIX H1) — it is left out of both
// preApproved and disallowedTools so it REACHES the gate, where grantDecision op-scopes it.
// It stays in each restricted profile's `doplToolsPolicy` (defense in depth: the MCP server
// still only offers the scoped dopl tools).
function buildSessionToolConfig(profile) {
  const p = normalizeProfile(profile);
  const channelShort = shortDoplName(DOPL_CHANNEL_TOOL);

  if (p === 'read_only') {
    // Local reads pre-approved; delivery via the OP-SCOPED channel tool (gated).
    // Web + every dopl tool except the channel + the admins + all write/exec/escape
    // built-ins are hard-denied.
    return {
      builtinTools: READ_BUILTINS.slice(),
      preApproved: READ_BUILTINS.slice(),
      disallowedTools: DENIED_BUILTINS.concat(WEB_TOOLS, DOPL_ADMIN_TOOLS, DOPL_SAFE_TOOLS),
      doplToolsPolicy: [channelShort],
    };
  }

  if (p === 'dopl_only') {
    // Local reads + web reads + the READ-ONLY dopl tools pre-approved; channel delivery
    // AND the workspace-WRITE dopl tools via the gate. Admins + write/exec/escape denied.
    // FIX F2: DOPL_WRITE_TOOLS used to sit in preApproved, i.e. in allowedTools, i.e.
    // SHADOWED — a dopl_only session could write into the shared workspace without
    // canUseTool ever being called, the v1.9 half of the same hole that let `auto`
    // auto-approve them. They are now in NEITHER list, so they reach the gate exactly
    // like dopl_channel does, and stay in doplToolsPolicy (the server still offers them).
    return {
      builtinTools: READ_BUILTINS.concat(WEB_TOOLS),
      preApproved: READ_BUILTINS.concat(WEB_TOOLS, DOPL_READ_TOOLS),
      disallowedTools: DENIED_BUILTINS.concat(DOPL_ADMIN_TOOLS),
      doplToolsPolicy: DOPL_SAFE_TOOLS.map(shortDoplName).concat([channelShort]),
    };
  }

  // full: pre-approve only local reads; the dangerous subset is HARD-DENIED
  // (SESSION_HARD_DENY), and only the visible + reversible work tools (Bash / Write /
  // Edit / NotebookEdit / MultiEdit / WebFetch / non-admin dopl reads) plus the
  // op-scoped dopl_channel reach canUseTool and await an operator button.
  return {
    builtinTools: [],
    preApproved: READ_BUILTINS.slice(),
    disallowedTools: SESSION_HARD_DENY.slice(),
    doplToolsPolicy: null,
  };
}

// FIX F3 (v2.9 review) — IS THIS THE CHANNEL TOOL? The Axis-B branch used to match the
// single literal 'mcp__dopl__dopl_channel', so a renamed or versioned channel tool
// ('mcp__dopl__dopl_channel_v2') fell straight through to AXIS A — and with `auto`/`bypass`
// answering unrecognized names permissively, A TOOL POSTURE ANSWERED A MESSAGE OPERATION,
// the one inversion the contract forbids. Match by SERVER PREFIX + SHORT NAME instead: any
// tool this server exposes whose short name is `dopl_channel` or starts `dopl_channel_`
// (a version/variant suffix) is a message operation and is governed by Axis B alone. The
// bare short name is accepted too — the server registers tools bare and only the CLI adds
// the prefix. Over-matching is the SAFE direction here: Axis B gates everything except an
// own-channel post, so a mis-classified tool asks rather than runs.
const CHANNEL_SHORT_NAME = shortDoplName(DOPL_CHANNEL_TOOL);
function isChannelTool(toolName) {
  const n = typeof toolName === 'string' ? toolName : '';
  const prefix = DOPL_SERVER_PREFIX + '__';
  const short = n.indexOf(prefix) === 0 ? n.slice(prefix.length) : n;
  if (short !== n && short.indexOf('__') !== -1) return false; // another server's tool
  return short === CHANNEL_SHORT_NAME || short.indexOf(CHANNEL_SHORT_NAME + '_') === 0;
}

// FIX H1 — is this dopl_channel call a plain delivery post into the session's OWN channel?
// `op==='post'` AND the target channel is either unset or exactly the session's channelId.
// Any other op — open, invite, a cross-channel post, create_task, close_task, set_task_mode —
// is NOT an own-channel post. (`channel` may be a slug or id; we compare against the id only,
// so a slug-addressed post is classified as cross-channel rather than as an own-channel post,
// the safe failure.) v2.5 D2: this no longer AUTO-ALLOWS. It only decides which grant KEY a
// post belongs to (below); every post still reaches the operator's dock.
function isOwnChannelPost(input, sessionChannelId) {
  const i = input || {};
  if (i.op !== 'post') return false;
  const target = i.channel;
  if (target == null || target === '') return true; // no explicit target -> own channel
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// v2.5 D2 — THE OUTBOUND GATE (a deliberate reversal of the v1.9 shadow rule for posts). An
// own-channel op=post used to resolve 'preapproved' — the agent's message left this machine
// with no operator click. It is the most consequential thing a session does, so it now GATES
// like every other write: the dock shows the drafted body and the operator picks Allow once /
// Allow for this task / Deny.
//
// EVERY dopl_channel grant is OP-SCOPED (FIX F2). The narrow POST_GRANT existed, but a
// grant taken on any other op recorded the BARE tool name and grantDecision honored the
// bare name for ANY op — so an agent whose first channel call was op=read (or a
// slug-addressed post, classified cross-channel) produced a dock entry with no drafted
// body, and one "Allow for this session" click silently authorized every channel op for the
// rest of the task, op=open direct:true included. That is exactly the cross-user exfil
// path FIX H1 closed. Now each op earns its own key and nothing honors the bare name.
// v2.9 review: POST_GRANT is the own-channel post BASE. A real key always extends it with
// the to/kind segments (MEDIUM-2) and the body digest (FIX F7), so the bare constant matches
// nothing on its own — it names the namespace, not a grant.
const POST_GRANT = DOPL_CHANNEL_TOOL + '#post'; // op=post into the session's OWN channel
const OP_PREFIX = '#op:'; // every other shape lives in a DISJOINT namespace
const OP_CAP = 32;
const TARGET_CAP = 40;
const ARGV_CAP = 24;
const SCOPE_CAP = 60;

// A bounded, collision-free token for a model-supplied string. Sanitizing alone would let
// 'post ' collapse onto POST_GRANT, which is why non-own-post keys carry OP_PREFIX.
function keyToken(value, cap) {
  const t = String(value == null ? '' : value).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return t.slice(0, cap) || 'unknown';
}

// FIX F9 — `to` and `kind` are STRINGS or they are nothing. `String({a:1})` is '[object
// Object]' for EVERY object and `String(['alice'])` is 'alice', so a non-string field used to
// key (and to display) as something it is not: to:{a:1} and to:{b:2} shared one key, and
// to:['alice'] shared the key of to:'alice'. A malformed field now digests a STABLE form of
// the whole value in its own '!' namespace, AND grantDecision refuses to auto-allow the call
// at all (postFieldsOk) — the key is inert and the operator always sees the card.
function postFieldsOk(input) {
  const i = input || {};
  const ok = function (v) { return v == null || typeof v === 'string'; };
  return ok(i.to) && ok(i.kind);
}
function fieldSegment(prefix, value, foldCase) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return prefix + '!' + shaKey(stableStringify(value));
  return prefix + shaKey(foldCase ? value.trim().toLowerCase() : value);
}

// FIX F7 — THE BODY IS THE SHAPE THE OPERATOR SAW. A post grant used to cover ANY body:
// grantKeyFor(ch,{op:'post',body:'hi'}) === grantKeyFor(ch,{op:'post',body:'ssh key: AAAA…'}),
// so HIGH-1's rationale ("ls -la must not authorize rm -rf") was applied to every tool class
// EXCEPT the one that moves data off the machine: one "Send for this session" on a benign reply
// authorized every later body the counterparty's text steered the agent into drafting. The
// body is digested into the key exactly as Bash digests its command line, so "for this session"
// means the same thing for a post as for every other tool: THIS shape, again. Hands-off
// replying is not lost — it is AXIS B (`auto_outbound`), stated in the header posture line and
// reset on park, rather than an invisible second path to the same power. Length-prefixed so no
// two body/field splits can concatenate to the same string.
function bodyDigest(body) {
  const s = typeof body === 'string' ? body : stableStringify(body);
  return shaKey(s.length + ':' + s);
}

// MEDIUM-2 — fold `to` and `kind` into the post key. `to` addresses ONE channel member and
// `kind` turns a chat message into a structured lifecycle event, so one approved reply must
// not also authorize a post aimed at a different member or a forged `task_finished`. Both are
// digested (an email sanitizes down to a colliding token); `kind`'s DEFAULT adds no segment.
function postScope(base, i) {
  const to = fieldSegment('#to:', i.to, true);
  const kind = i.kind === 'message' ? '' : fieldSegment('#kind:', i.kind, false);
  return base + to + kind + '#body:' + bodyDigest(i.body);
}

// FIX F6 — the CROSS-CHANNEL target carries a digest of the RAW value, mirroring `to`. It was
// a sanitized token with NO digest: lowercased, stripped to [a-z0-9_-] and truncated at 40, so
// `team.alpha` and `teamalpha` collided, any two slugs sharing a 40-char prefix collided, and
// the same UUID in two cases collided — a grant to post into ONE other channel posted into a
// DIFFERENT one. The readable half stays for the diag line; the digest is what scopes it.
function targetSegment(channel) {
  return keyToken(channel, TARGET_CAP) + '#' + shaKey(String(channel == null ? '' : channel));
}

// ── HIGH-1: EVERY tool is scoped, not just the channel ────────────────────────────
// `grantKeyFor` used to op-scope ONLY dopl_channel and record the BARE NAME for everything
// else, so one "Allow for this session" on `Bash("ls -la")` silently authorized every later Bash
// for the rest of the task, including one the counterparty's message text steered the agent
// into proposing. Each class now earns a key for the SHAPE the operator saw. Keys are
// in-memory, per-session, cleared on park (FIX F1 made that true), never persisted.
const WEB_SCOPED = WEB_TOOLS.slice(); // WebFetch / WebSearch -> scoped by ORIGIN
const EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit']; // the accept_edits set (contract A2)

// `Bash#<argv0>#<shaKey(command)>`: argv0 is the readable half (which program), the digest
// pins the exact command line, so `ls -la` never authorizes `rm -rf`.
function bashKey(name, i) {
  const cmd = i.command == null ? '' : String(i.command);
  return name + '#' + keyToken(cmd.trim().split(/\s+/)[0], ARGV_CAP) + '#' + shaKey(cmd);
}

// scheme://host, lowercased. No url (a WebSearch, or a malformed one) -> '' and the caller falls
// back to the input hash, which is STRICTER than granting every search at once.
function originOf(url) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(String(url == null ? '' : url).trim());
  return m ? (m[1] + '://' + m[2]).toLowerCase() : '';
}

// The resolved directory of a write. Both tools take an ABSOLUTE path (the SDK's own contract),
// so the parent of the last '/' is the dir; a relative/bare path yields '' -> the input hash.
function dirOf(p) {
  const s = String(p == null ? '' : p).trim().replace(/\/+$/, '');
  const cut = s.lastIndexOf('/');
  if (cut < 0) return '';
  return cut === 0 ? '/' : s.slice(0, cut);
}

// A stable stringify (sorted keys, depth-bounded, cycle-guarded) so the same input always
// digests to the same key regardless of property order, and a pathological input cannot recurse
// forever. FIX F5 — the bound used to COLLAPSE distinct inputs onto one key: anything past
// depth 6 became the literal 'null', so {op:'update',a:{b:{c:{d:{e:{f:{secret:'benign'}}}}}}}
// and the same object carrying 'EXFILTRATED' produced the SAME grant key, i.e. approve the
// benign call and its twin runs with no card. Two changes: the bound is far past any real tool
// input (nothing legitimate nests 64 deep), and reaching it no longer ERASES the value — the
// remainder is digested into a distinct '#deep:' sentinel, so truncation CHANGES the digest
// instead of merging it. A self-referential value stops at '#cycle' the same way. The result is
// only ever hashed, never rendered, so its length costs nothing.
const STRINGIFY_DEPTH = 64;
function rawTail(value) {
  const seen = [];
  try {
    return JSON.stringify(value, function (k, v) {
      if (v && typeof v === 'object') {
        if (seen.indexOf(v) !== -1) return '#cycle';
        seen.push(v);
      }
      return v;
    });
  } catch (err) { return '#unserializable'; }
}
function stableStringify(value, depth, seen) {
  const d = depth || 0;
  if (value === undefined || typeof value === 'function') return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const chain = seen || [];
  if (chain.indexOf(value) !== -1) return '"#cycle"';
  if (d >= STRINGIFY_DEPTH) return '"#deep:' + shaKey(rawTail(value)) + '"';
  const next = chain.concat([value]);
  if (Array.isArray(value)) return '[' + value.map(function (v) { return stableStringify(v, d + 1, next); }).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + stableStringify(value[k], d + 1, next); }).join(',') + '}';
}

// The allowForTask KEY a call belongs to. Own-channel posts get `<tool>#post` (+ the
// MEDIUM-2 to/kind segments and the F7 body digest); every other channel call gets
// `#op:<op>`, and a CROSS-channel post additionally carries its digested target, so a grant
// to post into one other channel cannot post into a different one. Every OTHER tool is
// scoped by the shape that was shown: Bash by argv0 + command digest, WebFetch/WebSearch by
// origin, Write/Edit/NotebookEdit by resolved directory, anything else by a digest of its
// whole input. The engine stores exactly this string when the operator picks "Allow for this
// task" (session-io -> reducer allowForTask). The channel base is the REAL tool name, so a
// versioned channel tool cannot inherit the canonical one's grants (and the canonical name
// still produces the byte-identical `mcp__dopl__dopl_channel#post…` base it always did).
function grantKeyFor(toolName, input, channelId) {
  const i = input || {};
  if (isChannelTool(toolName)) {
    const base = String(toolName);
    if (isOwnChannelPost(input, channelId)) return postScope(base + '#post', i);
    const op = keyToken(i.op, OP_CAP);
    if (op === 'post') return postScope(base + OP_PREFIX + 'post:' + targetSegment(i.channel), i);
    return base + OP_PREFIX + op;
  }
  if (toolName === 'Bash') return bashKey(toolName, i);
  if (WEB_SCOPED.indexOf(toolName) !== -1) {
    const origin = originOf(i.url);
    if (origin) return toolName + '#' + keyToken(origin, SCOPE_CAP) + '#' + shaKey(origin);
  }
  if (EDIT_TOOLS.indexOf(toolName) !== -1) {
    const dir = dirOf(i.file_path != null ? i.file_path : i.notebook_path);
    if (dir) return toolName + '#' + keyToken(dir.split('/').slice(-2).join('/'), SCOPE_CAP) + '#' + shaKey(dir);
  }
  return String(toolName) + '#' + shaKey(stableStringify(input));
}

// ── AXIS A: TOOL PERMISSIONS (what MY agent may do on THIS machine) ───────────────
// Per-session, never persisted, always starts `manual`, RESET to `manual` on park (the
// v2.3 FIX #3 rule extended: an abandoned session must never resume pre-authorized).
const TOOL_MODES = ['manual', 'accept_edits', 'auto', 'bypass'];
// ESCALATION-SHAPED ops that `auto` still asks about, and part of the reason `auto` is not
// `bypass`: these reach the SHELL or the NETWORK, and the counterparty's message text
// steers what the agent proposes, so a hands-off tool posture must still stop here.
// `bypass` covers them; NOTHING covers the hard-deny set.
const ESCALATION_TOOLS = ['Bash', 'WebFetch', 'WebSearch'];

// FIX F2 / F3 (v2.9 review) — `auto` and `bypass` are POSITIVE ALLOW-LISTS now, not negative
// ones. Two bugs, one root cause: `auto` was "everything except three names" and `bypass` was
// "everything", so (F2) the workspace-WRITE dopl tools were auto-approved by a mode whose copy
// only mentions commands, shell and web — an off-machine write every workspace member can
// read, with no card — and (F3) EVERY unrecognized name resolved to allow: '', null, undefined,
// 'SomeFutureTool', and a renamed channel tool alike. The hard-deny set is a BLACKLIST of names
// known at build time, which is exactly why an unrecognized name must not be auto-allowed: a
// CLI that ships a new delegation or exfil built-in tomorrow lands in neither list, and a
// negative mode would run it silently. Unknown therefore GATES IN EVERY MODE, `bypass`
// included: bypass hands over every work tool WE HAVE CLASSIFIED on this machine, which is what
// its copy claims, and one extra click on a tool nobody has ever seen is the cost of that bound.
const AUTO_TOOLS = READ_BUILTINS.concat(EDIT_TOOLS, ['MultiEdit'], DOPL_READ_TOOLS);
const BYPASS_TOOLS = AUTO_TOOLS.concat(ESCALATION_TOOLS, DOPL_WRITE_TOOLS);

function normalizeToolMode(mode) {
  return TOOL_MODES.indexOf(mode) === -1 ? 'manual' : mode; // fail-closed
}

// Does Axis A auto-allow this tool? MultiEdit is deliberately NOT in the accept_edits set
// (contract A2 names exactly Write / Edit / NotebookEdit) — the restrictive reading.
// Nothing here ever sees a dopl_channel call: grantDecision branches to Axis B first.
function toolModeAllows(mode, toolName) {
  const m = normalizeToolMode(mode);
  const name = typeof toolName === 'string' ? toolName : '';
  if (m === 'manual') return false;
  if (m === 'accept_edits') return EDIT_TOOLS.indexOf(name) !== -1;
  if (m === 'auto') return AUTO_TOOLS.indexOf(name) !== -1;
  return BYPASS_TOOLS.indexOf(name) !== -1; // bypass — every KNOWN work tool, nothing else
}

// ── AXIS B: MESSAGE FLOW (what crosses between machines) ──────────────────────────
// Per-session, starts `ask`, resets to `ask` on park. The INBOUND half is enforced at the
// inbound gate (session-gate.autoInbound / the reducer's inboundAutoAccepted); the OUTBOUND
// half is enforced here, and ONLY for a post into the session's OWN channel. A cross-channel
// post, `op=open direct:true`, invite, create_task and friends always gate: they are the
// cross-user exfil surface v1.9 FIX H1 closed, and "send my replies for me" is not consent
// to open a DM with another workspace member.
const MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];

function normalizeMessageMode(mode) {
  return MESSAGE_MODES.indexOf(mode) === -1 ? 'ask' : mode; // fail-closed
}
function autoInboundMode(mode) {
  const m = normalizeMessageMode(mode);
  return m === 'auto_inbound' || m === 'auto_both';
}
function autoOutboundMode(mode) {
  const m = normalizeMessageMode(mode);
  return m === 'auto_outbound' || m === 'auto_both';
}

// The per-call decision the engine's canUseTool bridge makes. Returns one of:
//   'preapproved' — auto-allow with NO button (a profile pre-approved tool that is ALSO
//                   shadowed via allowedTools). NEVER the channel tool (FIX H1 kept it out of
//                   allowedTools; D2 removed its own-channel post case).
//   'deny'        — hard-denied by the profile (checked FIRST so a denied tool can never be
//                   opened, not even via allowForTask).
//   'allow'       — the operator granted this tool for the whole task (engine Set).
//   'gate'        — surface Allow-once / Allow-for-task / Deny buttons and await.
// `input` + `channelId` are threaded in so the channel tool can be op-scoped; `toolMode`
// (Axis A) and `messageMode` (Axis B) are the per-session postures, absent => the most
// restrictive member of each axis. ORDER (v2.9, unchanged at the top): hard-deny FIRST and
// immovable in EVERY mode, bypass included -> the Axis-B branch for the channel tool ->
// preapproved -> the scoped standing grant -> the Axis-A mode -> gate.
function grantDecision(args) {
  const a = args || {};
  const allowForTask = a.allowForTask || [];
  const cfg = buildSessionToolConfig(a.profile);
  // 1. HARD DENY. Checked first so a denied tool can never be opened — not by a task
  //    grant, and not by `bypass` (which is why `bypass` is not permissionMode:bypass).
  if (cfg.disallowedTools.indexOf(a.toolName) !== -1) return 'deny';
  // 2. THE INVARIANT — a message operation branches to AXIS B here and NEVER reaches the
  //    Axis A mode below. No tool posture, `bypass` included, can send a message. FIX F3:
  //    matched by server prefix + short name, so a renamed/versioned channel tool cannot
  //    fall through to Axis A and have a TOOL posture answer a MESSAGE operation.
  if (isChannelTool(a.toolName)) {
    // FIX F9 fail-closed: a post whose `to` or `kind` is not a string is malformed. It can
    // never be auto-allowed, because neither the key nor the card can honestly describe it.
    if (!postFieldsOk(a.input)) return 'gate';
    // ONLY a standing grant for THIS EXACT shape allows without a button. FIX F2 deleted
    // the bare-tool-name fallback that used to sit here: it turned any one channel grant
    // (even one taken on op=read) into a grant for every op, op=open included. Grants are
    // never persisted, so there is nothing to migrate.
    if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId)) !== -1) return 'allow';
    // auto_outbound / auto_both send the agent's own replies with no click. ONLY an
    // own-channel post: everything else on this tool is the exfil surface, so it gates.
    if (autoOutboundMode(a.messageMode) && isOwnChannelPost(a.input, a.channelId)) return 'allow';
    return 'gate';
  }
  if (cfg.preApproved.indexOf(a.toolName) !== -1) return 'preapproved';
  // 3. THE SCOPED standing grant (HIGH-1): the key covers the SHAPE the operator saw.
  if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId)) !== -1) return 'allow';
  // 4. AXIS A. Message flow is never consulted here, so no message posture can run a
  //    work tool — the other half of the invariant.
  if (toolModeAllows(a.toolMode, a.toolName)) return 'allow';
  return 'gate';
}

// ─── END SESSION-PROFILE TABLE ───

module.exports = {
  buildSessionToolConfig, grantDecision, shortDoplName, isOwnChannelPost,
  grantKeyFor, // v2.9 HIGH-1: the scoped allowForTask key for EVERY tool class
  POST_GRANT, // the own-channel post BASE; a real key extends it (to/kind/body segments)
  isChannelTool, // FIX F3: prefix + short name, never one literal (session-io uses it too)
  // v2.9 the two axes (the renderer/preload hold their own copies of these lists — a
  // sandboxed renderer cannot require main — and test/session-permission-axes pins all four
  // surfaces against each other). FIX F2/F3 add the POSITIVE per-mode allow-lists and the
  // dopl read/write split they rest on.
  TOOL_MODES, MESSAGE_MODES, EDIT_TOOLS, ESCALATION_TOOLS,
  AUTO_TOOLS, BYPASS_TOOLS, DOPL_READ_TOOLS, DOPL_WRITE_TOOLS,
  normalizeToolMode, normalizeMessageMode, toolModeAllows, autoInboundMode, autoOutboundMode,
};
