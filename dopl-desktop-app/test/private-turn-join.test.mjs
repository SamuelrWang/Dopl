// A PRIVATE message pushed into a running turn that the runtime JOINS to that turn.
//
// `openPrivateTurn` opens +2 when a turn is in flight: one unit for the running turn's `result`, one
// for the pushed message's own turn. Codex's `turn/steer` always joins the push into the running
// turn, and Claude's CLI folds it in after a tool batch, so ONE `result` answers both and the second
// unit was never spent: the next channel turn ran with Axis B's out half withdrawn. The adapters'
// join hook (`session-directed.js › steerJoined`) now pays that unit back.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require_ = createRequire(import.meta.url);
const MAIN = join(import.meta.dirname, "..", "main");
const fold = require_(join(MAIN, "runtime", "claude", "fold.js"));
const directed = require_(join(MAIN, "session-directed.js"));
const privateTurn = require_(join(MAIN, "session-private.js"));
const io = require_(join(MAIN, "session-io.js"));

const PRIVATE = "[operator turn] check the build";

/** What the engine's dispatch does with a `result`: spend one unit of the private window. */
const turnEnded = (s) => privateTurn.closePrivateTurn(s);

test("CODEX ORDER (join, then the one result): the next turn is not private", () => {
  const s = { state: { activity: "working" } };
  assert.equal(privateTurn.openPrivateTurn(s, true, PRIVATE), 2);
  directed.steerJoined(s, PRIVATE); // `turn/steer` answered: the push joined the live turn
  turnEnded(s);
  assert.equal(privateTurn.isPrivateTurn(s), false, "no surplus unit covers the next channel turn");
});

test("RACE ORDER (the result, then the join): the join still pays back one", () => {
  const s = { state: { activity: "working" } };
  privateTurn.openPrivateTurn(s, true, PRIVATE);
  turnEnded(s);
  assert.equal(privateTurn.isPrivateTurn(s), true);
  directed.steerJoined(s, PRIVATE);
  assert.equal(privateTurn.isPrivateTurn(s), false);
});

test("CLAUDE FOLD: a private push folded after a tool batch closes with the turn that answered it", async () => {
  const s = { state: { activity: "working" } };
  const watch = fold.makeFoldWatch((text) => directed.steerJoined(s, text));
  const prompts = io.makePushIterator();
  const stamped = watch.stamp(prompts);
  prompts.push(io.userMessage("run the tool"));
  const first = (await stamped.next()).value;
  watch.observe({ type: "command_lifecycle", command_uuid: first.uuid, state: "started" });
  watch.observe({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } });
  prompts.push(io.userMessage(PRIVATE));
  privateTurn.openPrivateTurn(s, true, PRIVATE);
  const pushed = (await stamped.next()).value;
  watch.observe({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } });
  watch.observe({ type: "command_lifecycle", command_uuid: pushed.uuid, state: "started" });
  watch.observe({ type: "result", subtype: "success" });
  turnEnded(s);
  assert.equal(privateTurn.isPrivateTurn(s), false);
});

test("NOT JOINED: a push that runs as its own turn keeps both units", () => {
  const s = { state: { activity: "working" } };
  privateTurn.openPrivateTurn(s, true, PRIVATE);
  turnEnded(s);
  assert.equal(privateTurn.isPrivateTurn(s), true, "the private turn itself is still covered");
  turnEnded(s);
  assert.equal(privateTurn.isPrivateTurn(s), false);
  directed.steerJoined(s, PRIVATE);
  assert.equal(s.privateDepth, 0, "a late join after the window closed cannot go negative");
});

test("a private push joined into a PRIVATE turn in flight pays back its +1", () => {
  const s = { state: { activity: "working" }, privateDepth: 1 };
  assert.equal(privateTurn.openPrivateTurn(s, true, PRIVATE), 2);
  directed.steerJoined(s, PRIVATE);
  turnEnded(s);
  assert.equal(privateTurn.isPrivateTurn(s), false);
});

test("a join of a push the private window never opened pays nothing", () => {
  const s = { state: { activity: "working" } };
  privateTurn.openPrivateTurn(s, true, PRIVATE);
  directed.steerJoined(s, "some other channel message");
  assert.equal(s.privateDepth, 2);
  privateTurn.resetPrivateTurn(s);
  assert.equal(s.privateJoinable, null, "a torn-down query forgets its joinable pushes");
});
