// THE IPC BOUNDARY'S GUARDS — one source for both, shared by every privileged surface.
//
// TWO QUESTIONS, ONE REASON TO CHANGE: may this CALLER drive a privileged handler
// (`isAppWindowSender`), and is this ID well-formed enough to reach a store key or a router
// path (`isUuid`). Both are answered at the same boundary, by the same files, and both were
// COPIES before 2026-08-20.
//
// WHY `isAppWindowSender` IS HERE. It existed as TWO byte-identical copies — one in
// `main/channel-dir-ipc.js`, one in `main/ui-bridge.js` — each sliced by its own suite. That
// is the F-221 defect class stated as a fact about the tree: the two copies had ALREADY
// disagreed once, with the more privileged surface (the one that armed permission postures)
// on the LENIENT side of an absent `senderFrame`, and nothing but a reviewer's memory kept
// them in step afterwards. `main/update-required-window.js`'s own header said it outright —
// *"A predicate with three copies is a predicate that WILL drift; if a fourth is ever needed,
// extract it instead."* There were two identical ones and a third with a different subject.
//
// ⚠ WHAT MADE THE EXTRACTION LOOK IMPOSSIBLE, AND WHY IT IS NOT. Both copies sat inside
// BEGIN/END "pure block" sentinels so their suites could slice and evaluate them with no
// electron. A pure block may hold no `require`, so a SHARED value across two pure blocks is
// structurally impossible — unless the shared module is ITSELF the block both suites slice.
// That is what this file is: it carries the sentinels, and `test/channel-ipc-sender.test.mjs`
// and `test/ui-bridge-guards.test.mjs` now slice THIS source rather than two copies of it.
// One source, two suites, no drift surface.
//
// ⚠ `main/update-required-window.js › isGateSender` DELIBERATELY DOES NOT USE THIS. Its
// subject is ONE window (`sender !== win.webContents`), not a registry, so it answers a
// different question and collapsing them would widen the update gate to every app window.
// Its frame half is byte-consistent with this one and is pinned separately.
//
// ⚠ THE WRAPPER IS NOT HERE, ON PURPOSE. `appWindowOnly(name, refusal, fn)` stays written
// LITERALLY at every `ipcMain.handle` site in `channel-dir-ipc.js` and `session-ipc-ops.js`,
// because `test/channel-ipc-sender.test.mjs`'s structural belt reads exactly that shape — a
// new op cannot be added unbound by forgetting to wrap it. Hoisting the wrapper into a shared
// factory would pass review and silently disarm the check that catches the NEXT op. What is
// shared is the PREDICATE, which is where the security content lives.
//
// ⚠ FOUR MORE COPIES OF THE UUID REGEX SURVIVE, and that is measured rather than overlooked:
// `session-state-push.js › WIRE_UUID_RE`, `queued-notice.js › UUID`, `claude-resolve.js` and
// an inline one in `targeting.js`. Each sits inside its OWN pure block, so importing this one
// would break four extraction harnesses to remove a duplicated regex. They are held together
// by `test/uuid-rule-parity.test.mjs`, which asserts all six spellings are identical — the
// drift is pinned rather than the copies removed.

// ─── BEGIN IPC-GUARDS (pure; unit-tested via source extraction) ───────────────
// No electron/require refs below, so a suite can slice this block and drive it with fakes.

// The one spelling of a v4-shaped id at the IPC boundary. A hostile page must not be able to
// probe arbitrary store keys or smuggle a path fragment through an id, so anything that is
// not this shape is refused before it reaches a store, a registry or a router path.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

// TRUE only for an APP-OWNED window's own TOP frame. `senderIds` is the LIVE set of bound
// `webContents.id`s (main/app-windows.js › senderIds), resolved at CALL time — register()
// runs before any window exists, the shell is replaced on reopen, and a pop-out or an agent
// window may appear at any moment — so an absent, empty or stale set fails closed rather
// than throwing.
//
// ⚠ TWO CHECKS, BECAUSE ONE IS NOT ENOUGH:
//   1. the sender's webContents id is one main itself registered at window creation — and
//      the registry is written only by main, so a renderer cannot enlarge the set it is
//      judged against (`test/app-windows.test.mjs` proves that half); AND
//   2. the calling frame is that webContents' TOP frame, because a cross-origin iframe
//      SHARES its host's webContents and would otherwise pass check 1 unchallenged.
//
// ⚠ `senderFrame` is a getter that THROWS once the frame is detached, so it is read
// defensively: a frame we cannot read is refused, never waved through.
//
// ⚠ FAIL CLOSED ON AN ABSENT FRAME (F-221). The pre-Phase-10 form read
// `if (frame && sender.mainFrame && frame !== sender.mainFrame) return false`, which WAVED
// THROUGH a `senderFrame` reading as null/undefined. Both former copies were closed to this
// form; keeping it closed is the whole reason there is now only one of them.
function isAppWindowSender(event, senderIds) {
  if (!senderIds || typeof senderIds.has !== 'function') return false;
  const sender = event && event.sender;
  if (!sender) return false;
  if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return false;
  if (typeof sender.id !== 'number' || !senderIds.has(sender.id)) return false;
  let frame;
  try {
    frame = event.senderFrame;
  } catch (_err) {
    return false; // frame already detached — nothing legitimate calls from there
  }
  // An iframe shares the host's webContents; only the top frame may drive a privileged op.
  if (!frame || !sender.mainFrame || frame !== sender.mainFrame) return false;
  return true;
}
// ─── END IPC-GUARDS ──────────────────────────────────────────────────────────

module.exports = { isAppWindowSender, isUuid, UUID_RE };
