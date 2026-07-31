/**
 * N-PARTY ADDRESSING — the surface that told an agent nothing about WHO a
 * message was for.
 *
 * Before this, `metadata.to_user_id` appeared nowhere in this package: a
 * five-member channel rendered exactly like a DM, so an agent could not tell a
 * request aimed at IT from one aimed at another member or at nobody — while the
 * tool description told it to act on what it read. What is pinned here:
 *
 *   - every message line states its addressing: "· to you" / "· to <member>" /
 *     "· unaddressed", the last one unconditionally (an unaddressed ask in a 3+
 *     member channel triggered NO agent, which is the fact most worth telling);
 *   - a name in the ADDRESSEE position is peer-typed and goes through the same
 *     neutralizer as every other peer string, and is never rendered without the
 *     immutable user id beside it;
 *   - `await` is channel-wide, so a wake on other members' traffic says so
 *     rather than letting the agent read it as its own task;
 *   - the ROSTER op (`members`) exists at all — `list` reported "5 members" and
 *     nothing named them, though `to` requires naming one;
 *   - thread reads name BOTH parties (the description promised `created-by` and
 *     the renderer never emitted it), and the roster lookup that names them is
 *     fail-soft: a roster failure degrades to ids, never to an error.
 *
 * The @dopl/client is a hand-stubbed object (only the methods each op touches),
 * cast to DoplClient — registration/transport never run here.
 */
export {};
