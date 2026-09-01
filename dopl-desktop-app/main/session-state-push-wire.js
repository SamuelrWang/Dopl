// WHAT MAY GO ON THE WIRE — the three client-side refusals `session-state-push.js` applies
// before a row reaches `/api/channels/sessions`.
//
// ⚠ **SPLIT OUT OF `session-state-push.js` ON 2026-08-31**, at the §1 cap and on a REASON rather
// than the count that forced it. This file changes when the SERVER'S contract for a session row
// changes — the key charset, the name CHECK, the array bound, what the table is even about.
// `session-state-push.js` changes when the PUSH changes: the digest gate, the cadence floor, the
// retry, the identity fence, the drain. Two reasons, two files; they met only because both live
// on the road to one POST.
//
// ⚠ **EVERY REFUSAL HERE RESTATES THE SERVER'S CONTRACT RATHER THAN SNIFFING FOR A SHAPE**, and
// that is the rule the three share. The reason to drop a row is that the endpoint refuses it —
// so the predicate is the endpoint's own regex, not a heuristic about how a bad row tends to
// look. Zod validates the ARRAY, so ONE refused entry 400s the WHOLE payload, `retryable(400)`
// is false, the digest is never recorded, and every later push for that workspace fails
// identically: `read_sessions` answers [] for the machine, valid rows included, and stale rows
// are never cleared. That single failure mode is why all three exist.
//
// ⚠ **IT IS A FACTORY, NOT A MODULE OF FREE FUNCTIONS, BECAUSE ONE OF THEM REMEMBERS.**
// `reportable` keeps a `loggedAdHoc` set so a dropped session says so ONCE rather than once per
// state change of a session that may run for hours — module-level state, and the writer's suites
// evaluate a FRESH copy of the push block per case. A shared set would leak one case's log into
// the next one's assertion, which is the quietest way for a "said once" test to stop testing
// anything. `makeWireFilter(diag)` hands back a fresh set per writer, and takes the logger rather
// than requiring it so the injected fake still lands in `m.logged`.

function makeWireFilter(diag) {
  // ── THE AD-HOC SESSION NEVER GOES ON THE WIRE ───────────────────────────────────────────
  // ⚠ An UNTHREADED inbound (the ordinary DM) has no first-class thread, so trigger.taskIdFor mints
  // `task-<channelId>-<seq>`, which the server's `SESSION_KEY_RE` and `threadId: z.string().uuid()` both refuse.
  // Zod validates the ARRAY, so ONE such entry 400s the WHOLE payload; retryable(400) is false, so the digest is
  // never recorded and every later push for that workspace fails identically — `read_sessions` answers [] for
  // the machine, valid UUID-threaded sessions included, and stale rows are never cleared.
  // ⚠ Filter client-side; do NOT widen the server schema. `read_sessions` answers "what is this member's agent
  // doing on THIS thread", and an ad-hoc session has no thread for the answer to be about. Widening the key
  // charset also gives up the reconcile's delete-by-key safety. The predicate RESTATES the server's contract
  // (uuid channel, uuid thread or none) rather than sniffing `!key.startsWith('task-')`: the reason to drop a
  // row is that the server refuses it.
  const WIRE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function serverReportable(e) {
    const x = e || {};
    if (!WIRE_UUID_RE.test(String(x.channelId || ''))) return false;
    const taskId = String(x.taskId || '');
    return taskId === '' || WIRE_UUID_RE.test(taskId);
  }

  // ── A ROW WITH NO USABLE HANDLE DOES NOT GO ON THE WIRE EITHER (2026-08-22) ─────────────
  //
  // ⚠ THE SAME FAILURE AS THE AD-HOC KEY ABOVE, REACHED BY A THIRD ROAD, AND THIS IS THE BELT RATHER THAN THE
  // FIX. `channel_sessions.name` carries CHECK `^[a-z][a-z0-9-]{1,30}$` and
  // `src/features/channels/schema-sessions.ts › SESSION_NAME_RE` restates it character for character. Zod
  // validates the ARRAY, so ONE bad name 400s the WHOLE payload, `retryable(400)` is false, the digest is never
  // recorded, and every later push for that workspace fails identically — `read_sessions` answers [] for the
  // machine for the life of the run.
  //
  // ⚠ AND `''` IS A REACHABLE VALUE, NOT A HYPOTHETICAL. `session-summary.js › nameOf` answers the empty string
  // for a session carrying no `agentId` — deliberately, because inventing a name there would be worse — and the
  // producer that could hand one over was `session-park.js › startResume` resuming a PRE-MULTIPLAYER durable
  // record. That producer is fixed in the same change (it mints an id), so nothing in the tree feeds this
  // today. It stays because the COST of the next producer getting it wrong is a workspace silently blanked, and
  // the check is a regex.
  //
  // ⚠ THE PREDICATE RESTATES THE SERVER'S CONTRACT rather than sniffing for '' — the reason to drop
  // a row is that the endpoint refuses it, which is the same rule `serverReportable` follows.
  const WIRE_NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;

  function nameReportable(e) {
    return WIRE_NAME_RE.test(String((e || {}).name || ''));
  }

  // ── THE ENDED ROW DOES NOT GO ON THE WIRE (2026-08-22, Samuel's ended-agent ruling) ─────
  //
  // ⚠ THIS IS A DELIBERATE NARROWING, AND WITHOUT IT THE RULING WOULD HAVE BROKEN THE PUSH
  // ENTIRELY. Ended rows used to be reported and disappeared almost at once — the retained set was
  // in memory, bounded by 12, and cleared by a restart. Retention is now SEVEN DAYS and DURABLE
  // (`agent-history.js`), so a machine can hold hundreds of ended cards. The server's own bound is
  // `SESSION_REPORT_MAX = 32` on the ARRAY (`src/features/channels/schema-sessions.ts`); one
  // oversized payload is a 400, `retryable(400)` is false, the digest is never recorded, and every
  // later push for that workspace fails identically — `read_sessions` answers [] for the machine,
  // LIVE sessions included, and stale rows are never cleared. That is the exact failure the ad-hoc
  // filter above exists for, reached by a different road.
  //
  // ⚠ AND NOTHING WANTED THEM. Samuel's ruling is that the OPERATOR sees their own ended cards —
  // which they do, from the LOCAL summaries bridge, where the 7-day history actually lives. PEERS
  // do not need ended cards: `peerCardsFor` already filters on row freshness, so a day-old ended
  // row renders nothing anyway. And `read_sessions` answers "what is this member's agent DOING",
  // which a dead one is not. So the cross-machine vocabulary keeps its three values and simply
  // stops carrying the third.
  //
  // ⚠ THE ROW STILL LEAVES PROMPTLY, WHICH IS THE POINT. Dropping the entry here means the next
  // push reports a SMALLER set, and the replace protocol deletes by omission — so a peer's card
  // for a just-ended agent disappears on the next state change rather than lingering for a week.
  function liveForWire(e) {
    return String((e || {}).state || '') !== 'ended';
  }

  // ⚠ One line per dropped session, NOT per push: a filtered entry survives every state change
  // of a session that may run for hours. Pruned to the live set every cycle, like `origin`.
  const loggedAdHoc = new Set();

  function reportable(entries) {
    const kept = [];
    const live = new Set();
    for (const e of entries) {
      const key = String((e && e.key) || '');
      live.add(key);
      // ⚠ ENDED ROWS ARE DROPPED SILENTLY, unlike the ad-hoc ones below. An ad-hoc session is a
      // shape the server REFUSES and the operator may want to know about; an ended one is simply
      // not this table's business, it happens constantly, and one diag line per ended agent would
      // be noise about working-as-designed.
      if (!liveForWire(e)) continue;
      if (serverReportable(e) && nameReportable(e)) { kept.push(e); continue; }
      if (loggedAdHoc.has(key)) continue;
      loggedAdHoc.add(key);
      if (!serverReportable(e)) {
        diag('session-state push: SKIPPING ad-hoc session', key,
          '— no first-class thread, so read_sessions has nothing to be about;',
          'the rest of this workspace\'s set is reported normally');
      } else {
        diag('session-state push: SKIPPING nameless session', key,
          '— its name', JSON.stringify(String((e || {}).name || '')),
          'is not a handle channel_sessions.name accepts, and ONE of them 400s the whole payload;',
          'the rest of this workspace\'s set is reported normally');
      }
    }
    for (const key of [...loggedAdHoc]) {
      if (!live.has(key)) loggedAdHoc.delete(key);
    }
    return kept;
  }

  return { serverReportable, nameReportable, liveForWire, reportable };
}

module.exports = { makeWireFilter };
