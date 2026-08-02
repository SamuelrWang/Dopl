// The SCOPED allowForTask GRANT KEY for one tool call (§2 SPLIT out of session-profiles.js,
// 2026-08-02, verbatim). session-profiles.js re-exports grantKeyFor / POST_GRANT, so no caller
// moved; the split happened because that file hit the 500-line cap and the key machinery is the
// one half of it that decides NOTHING — it only names the SHAPE a decision was taken on.
//
// PURE: node's `crypto` (digests only, no key material, no randomness) + the tool-profiles
// constants. Electron/fs/path/SDK-free like the table it came from.
//
// THE TWO CLASSIFIERS IT NEEDS (`isChannelTool` / `isOwnChannelPost`) LIVE IN THE TABLE, and
// requiring back would be a cycle, so grantKeyFor is BUILT BY FACTORY with them handed in. That
// is deliberate beyond the cycle: there is exactly ONE definition of "is this the channel tool",
// and a key can never disagree with the decision about which branch a call belongs to.

const crypto = require('crypto');
const { DOPL_CHANNEL_TOOL, WEB_TOOLS } = require('./tool-profiles');

// The SHA-256 digest every scoped grant key carries. FIX F4 (v2.9 review): this was a
// 12-hex-char PREFIX (48 bits) behind a comment claiming a model could not search that
// width. It can. The COUNTERPARTY supplies the exact command / body text, and a review
// benchmarked ~400k SHA-256/179ms on this machine, i.e. seconds to a 48-bit birthday
// collision: precompute a benign/malicious pair sharing argv0 + digest, get the benign one
// approved for the task, and the twin is auto-allowed with no card. A grant key is a Set
// MEMBER, never a rendered string, so its length costs nothing — use the FULL digest.
function shaKey(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex');
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
// `deps` are session-profiles' own classifiers + its accept_edits list (see the header).
function makeGrantKeyFor(deps) {
  const d = deps || {};
  const isChannelTool = d.isChannelTool;
  const isOwnChannelPost = d.isOwnChannelPost;
  const EDIT_TOOLS = d.EDIT_TOOLS || [];
  return function grantKeyFor(toolName, input, channelId) {
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
  };
}

module.exports = { shaKey, POST_GRANT, postFieldsOk, stableStringify, makeGrantKeyFor };
