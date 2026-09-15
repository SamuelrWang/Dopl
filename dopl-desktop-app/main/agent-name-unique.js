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
// ⚠ **THE SUFFIX IS APPLIED AT COMMIT AND STORED, WHICH IS THE WHOLE DIFFERENCE FROM 2026-09-07.**
// That ruling minted `coder-1` at RESOLVE time, positionally over the live set — so the suffix was
// not durable: when the agent holding `coder` ended, the next one moved up and `@coder-1` came to
// name a different agent than it did an hour ago. Here the name is decided ONCE, written into
// `agent-names.js`, projected to `channel_sessions.display_name`, and never recomputed. An agent
// ending frees the BARE name for the next launch and re-points nothing.
//
// ⚠ **SO THE RESOLVER HAS NOTHING TO DISAMBIGUATE, AND THAT IS THE POINT.** Samuel: *"The names
// should reflect the slug anyway, so that almost shouldn't be a conflict ever, right?"* With this
// rule the tag `@coder` names exactly one addressable agent by construction, which is why
// `src/features/channels/lib/agent-mentions.ts` carries neither a mint nor a contest any more.
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
 * ⚠ **HAND COPY OF `src/features/channels/lib/mentions.ts › mentionSlug`, AND OF
 * `agent-handles.js › agentSlug` BESIDE IT.** Main cannot import the SPA's TypeScript; that file
 * pairs its copy with a cross-tree fixture test for exactly this reason. This one is a third
 * spelling of four characters, and it is kept here rather than required from `agent-handles.js`
 * only because that module's own header declares itself the MENTION PARSER — a naming rule
 * reaching into it would make the parser a dependency of the writer. ⚠ If either drifts, the
 * failure is silent and looks like "the agent ignored me"; `test/agent-name-unique.test.mjs`
 * asserts this function against `agent-handles.js › agentSlug` over the same fixtures.
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
 */
function uniqueAgentName(wanted, siblings) {
  const base = String(wanted == null ? '' : wanted).trim();
  if (base === '') return base;
  const taken = new Set();
  for (const sibling of siblings || []) {
    const slug = nameSlug(sibling && sibling.name);
    if (slug) taken.add(slug);
  }
  if (!taken.has(nameSlug(base))) return base;
  for (let n = 1; n <= taken.size + 1; n += 1) {
    const candidate = base + '-' + n;
    if (!taken.has(nameSlug(candidate))) return candidate;
  }
  // ⚠ UNREACHABLE BY THE BOUND ABOVE, AND IT RETURNS THE BASE RATHER THAN THROWING. A naming
  // rule may never be the thing that fails a launch: the worst honest outcome is two agents
  // sharing a tag, which the resolver answers by naming the first — not a spawn that did not
  // happen because a string could not be chosen.
  return base;
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
