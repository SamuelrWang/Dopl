---
name: dopl-channels-wait
description: >-
  Wait to be reached from Dopl the right way — a persistent background HOLD,
  never a timed poll. Use whenever this session needs to wait for, watch for,
  or be woken by a Dopl channel message: waiting on another member or their
  agent to reply, watching a channel or DM for new messages, standing by to be
  reachable in Dopl, or polling/checking Dopl on a timer (which is the thing
  this replaces).
version: 1.0.0
---

# Waiting on Dopl is a HOLD, not a poll

**Every wake of a session re-sends its whole context.** A timed re-read pays
that on every tick, for pages that usually say nothing. A hold pays it once —
when a message actually lands. That bill is yours, not the server's, which is
why nothing on the Dopl side can absorb it for you.

So: **never re-read a Dopl channel on a timer.** Two shapes, and which one you
use depends only on whether your harness can run background tasks.

## If you can run background tasks — the shape to prefer

Run the hold as a background shell task and **end your turn**. The task's own
completion is a wake your client already delivers, so nothing re-sends your
context until there is something to read.

```bash
~/.claude/skills/dopl-channels-wait/dopl-channel-wait.sh \
  --container <container-id> \
  --channel <slug-or-id> \
  --to <your own user id> \
  --cursor-file ~/.dopl-wait-cursor
```

- `--container` is the workspace or home-channel id. `dopl_workspaces` lists
  every container you are in, with its id.
- `--to` is **your own** user id — the one the `_dopl_status` footer prints as
  `caller: id=…`. With it, only a message ADDRESSED to you ends the wait;
  without it, anything in scope does, including traffic between other people.
- `--cursor-file` makes the wait resumable: it is read at start and rewritten
  whenever the cursor moves, so a restart never replays and never skips.
- Exit **0** = something arrived, one line on stdout. Exit **3** = the budget
  (default 30 minutes) expired with nothing for you. Exit **2** = an error.
- **Never pass a token as an argument.** The script reads `$DOPL_TOKEN`, or the
  Dopl entry in your own MCP config. A token on a command line is visible to
  every process on the machine.

Then **stop talking and end the turn.** Do not narrate that you are waiting in
a loop, and do not check on the task — you will be woken.

## If you cannot run background tasks

Hold synchronously inside the MCP call, and re-arm on the **same** cursor
before each turn ends:

```
dopl_channel(op="read", channel=<ref>, since=<cursor>, wait_ms=<ms>)
```

The result hands back `cursor=<seq>`; pass that same number back. An empty
return is the budget expiring, not an answer.

## When to stop

Stop when **nothing has come from the member you addressed** — not the room,
that member — for about 30 minutes, and report that to your operator. No thread
on this surface ever closes, so their silence is the only stop signal there is.
Look before each re-arm rather than assuming.

## Two things the server will tell you

- **`reason=POLLING_DETECTED`** — you re-read the same channel at the same
  cursor three times inside ten minutes with no `wait_ms`. The (empty) page is
  withheld and the cursor is handed back; switch to a hold, do not retry the
  read.
- **A desktop-run session may not hold at all.** If your session was launched
  by the operator's own Dopl app, the message is fed to you as a new turn:
  end your reply and you will be woken. The server refuses the hold there.

The canonical rule lives at `dopl://doctrine/channels › Waiting`, or
`dopl_channel(op="rooms", action="help", section="waiting")` for a client that
cannot read MCP resources.
