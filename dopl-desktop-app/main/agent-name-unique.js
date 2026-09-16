'use strict';

// NO TWO ADDRESSABLE AGENTS IN ONE CHANNEL WEAR THE SAME NAME (Samuel's ruling, 2026-09-15).
//
// Verbatim: *"I think we should enforce a rule where no two agents that are addressable can have
// the same name. … If a user launches an agent with the same name, let's just have the name
// auto-renamed to that name and -1. For example, you have coder. Let's say there's already an
// active coder agent. If a user launches another agent called coder, or if their agent launches an
// agent called coder, it will automatically auto-resolve to coder-1. It will auto-resolve to
// coder-2 and so on and so forth. Of course, this is only something that needs to be enforced for
// agents that are in the idle or working state. If an agent is ended, they can't be addressed
// anyway, so it won't matter. They can have duplicate names … It's basically only for addressable
// agents, right?"*
//
// 🔒 **THE SUFFIX IS APPLIED AT COMMIT AND STORED, WHICH IS THE WHOLE DIFFERENCE FROM THE
// 2026-09-07 RULING IT REPLACED.** That one minted `coder-1` at RESOLVE time, positionally over
// the live set, so `@coder-1` re-pointed whenever the agent holding `coder` ended. Here the name
// is decided ONCE, written into `agent-names.js`, projected to `channel_sessions.display_name`
// and never recomputed; an agent ending frees the BARE name for the next launch and re-points
// nothing. So the resolver has nothing to disambiguate, which is why
// `src/features/channels/lib/agent-mentions.ts` carries neither a mint nor a contest.
//
// ⚠ **COMPARED BY SLUG, NOT BY STRING, BECAUSE THE SLUG IS WHAT IS ADDRESSED.** *"When people
// type the ads [@s], those should be the slugs."* "Bug Reviewer", "bug reviewer" and "  Bug
// Reviewer " are ONE address (`@bug-reviewer`) and therefore one collision; comparing the raw
// strings would let two agents claim one tag while looking distinct on a card.
//
// ⚠ **ENDED AGENTS NEITHER COLLIDE NOR ARE RENAMED.** They cannot be addressed, so a duplicate
// costs nothing — and renaming a finished run would rewrite the label on its own past messages.
//
// ⚠ **SCOPED TO ONE CHANNEL**, because that is the scope a tag resolves in
// (`server/service-wake-verdict-handles.ts` reads the room's rows; the desktop reads the thread's
// live ids). Two "Coder"s in two different channels contest nothing.
//
// PURE + electron-free, like `agent-id.js` and `agent-handles.js`: the caller passes the siblings
// it holds, so the truth table runs with no disk and no electron. The LIVE half is
// `agent-identity-commit.js`, which is the one door every rename path already goes through.

// ─── BEGIN AGENT-NAME-UNIQUE-PURE (pure; unit-tested via source extraction) ────

/**
 * THE HANDLE CONVENTION — lowercase, whitespace runs to a single `-`.
 *
 * ⚠ **HAND COPY OF `src/features/channels/lib/mentions.ts › mentionSlug` AND OF
 * `agent-handles.js › agentSlug`.** Main cannot import the SPA's TypeScript; it is kept out of
 * `agent-handles.js` because that module declares itself the MENTION PARSER, and a naming rule
 * reaching into it would make the parser a dependency of the writer. ⚠ Drift here is silent and
 * looks like "the agent ignored me", so it is pinned in both directions:
 * `test/agent-name-unique.test.mjs` against `agentSlug`, and
 * `src/features/channels/agent-name-schema.test.ts` against `mentionSlug`.
 */
function nameSlug(source) {
  return String(source == null ? '' : source).trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * THE NAME THIS AGENT SHOULD ACTUALLY WEAR — `wanted`, or the lowest free `-N` under it.
 *
 * `siblings` is every OTHER agent the caller considers a competitor: `{ name }` rows, already
 * narrowed to the same channel and to the ADDRESSABLE states. This function applies no liveness
 * rule and no channel rule of its own — both are facts about a registry it cannot see, and baking
 * either in here would put the ruling in two places.
 *
 * ⚠ **THE LOWEST FREE SUFFIX, NOT THE NEXT ONE AFTER THE HIGHEST.** With `coder` and `coder-2`
 * running, a third launch is `coder-1`: the gap is free, it is the shortest thing to type, and
 * "the next number after the biggest" would leave a permanent hole every time an agent ended.
 *
 * ⚠ **THE BARE NAME IS TRIED FIRST**, so the ordinary launch — nothing else called that — stores
 * exactly what the operator or the launching agent typed and no suffix is ever seen.
 *
 * ⚠ **IT IS BOUNDED BY THE SIBLING COUNT AND CANNOT SPIN.** At most one name per sibling is taken,
 * so `n` siblings can occupy at most `n` slots in one family and a free slot appears within
 * `n + 1` steps. The loop's bound is that fact, not a hope.
 *
 * ⚠ **AN EMPTY `wanted` IS RETURNED UNCHANGED.** `''` is the CLEAR gesture on the rename path
 * (`agent-self-ops.js › applyRenameTo`), and suffixing it would turn "unname this agent" into
 * a rename to `-1`.
 *
 * ⚠ **THE SUFFIX MAKES ROOM FOR ITSELF WHEN `maxLength` IS GIVEN** (2026-09-15). `agent-names.js
 * › sanitizeName` REFUSES a name over `MAX_NAME` rather than trimming it, so a 60-character name
 * that collided became 62 characters and was refused outright — on the launch lane that leaves
 * the agent NAMELESS, on the rename lane it answers `bad-name` for a string the caller was
 * entitled to. A naming rule may never be the thing that fails a launch, so the stem is shortened
 * to fit. `0` (the default) means "no bound", which is every caller that holds no store.
 */
function uniqueAgentName(wanted, siblings, maxLength = 0) {
  const base = String(wanted == null ? '' : wanted).trim();
  if (base === '') return base;
  const cap = Number(maxLength) || 0;
  const taken = new Set();
  for (const sibling of siblings || []) {
    const slug = nameSlug(sibling && sibling.name);
    if (slug) taken.add(slug);
  }
  if (!taken.has(nameSlug(base))) return base;
  for (let n = 1; n <= taken.size + 1; n += 1) {
    const suffix = '-' + n;
    const candidate = stemWithin(base, cap - suffix.length) + suffix;
    if (!taken.has(nameSlug(candidate))) return candidate;
  }
  // ⚠ UNREACHABLE BY THE BOUND ABOVE, AND IT RETURNS THE BASE RATHER THAN THROWING. A naming
  // rule may never be the thing that fails a launch: the worst honest outcome is two agents
  // sharing a tag, which the resolver answers by naming the first — not a spawn that did not
  // happen because a string could not be chosen.
  return base;
}

/** `base`, short enough that a suffix of the remaining length still fits — `base` itself when
 *  there is no bound or it already fits. ⚠ NEVER EMPTY: a stem trimmed away to nothing would
 *  turn `Coder` into `-1`, which is a name nobody asked for and a handle nobody can type. */
function stemWithin(base, room) {
  if (room <= 0 || base.length <= room) return base;
  return base.slice(0, room).trim() || base.slice(0, room);
}

/**
 * THE SIBLINGS ONE AGENT COMPETES WITH — every OTHER row in the SAME channel that is still
 * addressable.
 *
 * ⚠ **`ended` IS THE ONLY STATE EXCLUDED, AND IT IS EXCLUDED BY NAME RATHER THAN BY LISTING THE
 * TWO THAT COUNT.** Samuel named `idle` and `working`, and `session-pill.js` answers exactly those
 * three words today — but a FOURTH pill would then silently stop competing, and the safe
 * direction for a naming rule is to treat an unrecognised state as addressable.
 *
 * ⚠ **THE AGENT ITSELF IS EXCLUDED**, or a rename to the name it already holds would collide with
 * its own row and walk to `-1` on every no-op save.
 */
function addressableSiblings(rows, agentId, channelId) {
  const self = String(agentId || '');
  const room = String(channelId || '');
  const out = [];
  for (const row of rows || []) {
    if (!row || String(row.agentId || '') === self) continue;
    if (String(row.channelId || '') !== room) continue;
    if (String(row.state || '') === 'ended') continue;
    const name = row.displayName;
    if (typeof name === 'string' && name.trim() !== '') out.push({ name: name });
  }
  return out;
}

// ─── END AGENT-NAME-UNIQUE-PURE ───────────────────────────────────────────────

module.exports = { nameSlug, uniqueAgentName, addressableSiblings };
