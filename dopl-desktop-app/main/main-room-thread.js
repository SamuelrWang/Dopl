// THE MAIN-ROOM SENTINEL for the `thread` argument of a send (2026-10-29, Thread Mention Reach Fix).
//
// ⚠ WHY IT EXISTS. A THREAD-bound session's own-channel posts are auto-tagged with its thread
// (`session-outbound-tag.js › threadTagFor`), because an agent that forgets the tag otherwise
// posts its thread reply into the main room. Since a main-room post that names a thread-bound
// agent now WAKES it (`session-dispatch.js`), that agent must be able to answer in the main room,
// and "no thread argument" is exactly what the tagger fills in. So the turn tells it to pass
// thread="main"; the tagger STRIPS the argument before the call leaves this machine, and nothing
// past the desktop ever sees the word. A real thread id is a uuid, so it can never collide.
const MAIN_ROOM_THREAD = 'main';

module.exports = { MAIN_ROOM_THREAD };
