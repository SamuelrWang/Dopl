#!/usr/bin/env bash
#
# dopl-channel-wait.sh — THE CANONICAL DOPL HOLD LOOP.
#
# WHY IT EXISTS. Waiting on Dopl is a HOLD, never a poll: every wake of an LLM
# session re-sends its whole context, so a timer pays that per tick while a hold
# pays it once, when a message actually lands. `dopl_channel(op="read",
# wait_ms=…)` holds inside the MCP call, which means it returns inside the TURN
# that armed it — a pending call keeps a turn alive, it cannot end one.
#
# A harness that can run BACKGROUND TASKS already has the missing half. Run this
# as such a task and END your turn: the task's own completion is a wake the
# client delivers, and its one line of stdout is what arrived. The wait leaves
# the model's turn entirely, and nothing re-sends context until there is
# something to say. The canonical rule is `dopl://doctrine/channels › Waiting`.
#
# ⚠ IT IS A HOLD ALL THE WAY DOWN. One request per ~50s, and each one is the
# server holding — not this script sleeping and asking again. The loop re-issues
# only when a hold RETURNS (something landed elsewhere, or the budget expired),
# and always on the cursor it was handed, so nothing is skipped or replayed.
#
# USAGE
#
#   dopl-channel-wait.sh --container <uuid> [options]
#
#   --container <uuid>   REQUIRED. The container (workspace or home channel) to
#                        watch, sent as X-Workspace-Id. Workspace resolution is
#                        fail-closed, so there is no default to omit it for.
#   --channel <handle>   Repeatable. Only messages in these channels end the
#                        wait; a handle is a slug or a channel id. Omit to watch
#                        every channel you are a MEMBER of in that container.
#   --to <user id>       Only messages ADDRESSED to this user id end the wait.
#                        This is normally YOUR OWN id — the one the Dopl MCP
#                        footer prints as `caller: id=…`. Without it, any
#                        message in scope ends the wait, including one addressed
#                        to somebody else.
#   --cursor-file <path> Where the cursor lives across runs. Read at start,
#                        rewritten every time the cursor advances, so a restart
#                        resumes instead of replaying. Created if absent.
#   --since <seq>        Start cursor, overriding the file. Required only when
#                        there is no cursor file to read one from.
#   --exclude-author <id> A user id whose posts do NOT end the wait (normally
#                        your own account, so your own posts never wake you).
#   --max-minutes <n>    Total budget, default 30 — the same ~30 minutes of
#                        silence the doctrine says to stop after.
#   --base-url <url>     Default https://www.usedopl.com
#
# ⚠ NO SECRET IS EVER AN ARGUMENT. The token comes from $DOPL_TOKEN, or is read
# out of the Claude CLI's own MCP config (`~/.claude.json`, the `dopl` entry's
# Authorization header) — the file the Dopl desktop had the CLI write. A token
# on a command line is visible to every process on the machine via `ps`, and
# lands in shell history; a token in a URL lands in server logs and proxy
# history. It is sent as a request header and printed nowhere.
#
# EXIT CODES — the whole contract, because a background task is read by its
# status as much as by its output:
#   0  something arrived that matches the filters; ONE line on stdout
#   3  budget spent with nothing matching (re-run; the cursor file has moved on)
#   2  a usage or request error; the detail is on stderr

set -uo pipefail

BASE_URL="${DOPL_BASE_URL:-https://www.usedopl.com}"
MAX_MINUTES=30
POLL_TIMEOUT_MS=50000
CONTAINER=""
TO=""
SINCE=""
CURSOR_FILE=""
EXCLUDE_AUTHOR=""
CHANNELS=""

die() {
  printf '%s\n' "$1" >&2
  exit 2
}

usage() {
  sed -n '3,58p' "$0" | sed 's/^#\{0,1\} \{0,1\}//' >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --container) CONTAINER="${2:-}"; shift 2 ;;
    --channel)   CHANNELS="${CHANNELS}${CHANNELS:+ }${2:-}"; shift 2 ;;
    --to)        TO="${2:-}"; shift 2 ;;
    --since)     SINCE="${2:-}"; shift 2 ;;
    --cursor-file) CURSOR_FILE="${2:-}"; shift 2 ;;
    --exclude-author) EXCLUDE_AUTHOR="${2:-}"; shift 2 ;;
    --max-minutes) MAX_MINUTES="${2:-}"; shift 2 ;;
    --base-url)  BASE_URL="${2:-}"; shift 2 ;;
    -h|--help)   usage ;;
    *) die "dopl-channel-wait: unknown argument '$1' (try --help)." ;;
  esac
done

command -v curl >/dev/null 2>&1 || die "dopl-channel-wait: curl is not on PATH."
command -v python3 >/dev/null 2>&1 || die "dopl-channel-wait: python3 is not on PATH (needed to read JSON without shipping a parser)."

[ -n "$CONTAINER" ] || die "dopl-channel-wait: --container is required (the container uuid; workspace resolution is fail-closed)."

# ── The token: env first, then the CLI's own MCP config. Never an argument. ──
#
# ⚠ READ INTO A VARIABLE AND NEVER ECHOED. The `claude mcp add` the Dopl desktop
# runs stores the bearer as a header on the `dopl` entry; this reads that entry
# rather than asking the operator to paste a credential anywhere.
TOKEN="${DOPL_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  TOKEN=$(python3 - "$HOME/.claude.json" <<'PY' 2>/dev/null || true
import json, sys
try:
    cfg = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for scope in (cfg, *(v for v in cfg.get("projects", {}).values() if isinstance(v, dict))):
    entry = (scope.get("mcpServers") or {}).get("dopl") or {}
    for key, value in (entry.get("headers") or {}).items():
        if key.lower() == "authorization" and isinstance(value, str):
            print(value.split(" ", 1)[-1].strip())
            sys.exit(0)
PY
)
fi
[ -n "$TOKEN" ] || die "dopl-channel-wait: no token. Set DOPL_TOKEN, or connect the Dopl MCP server so the CLI config carries one. (Never pass a token as an argument.)"

# ── The cursor: the file, then --since. One of them must answer. ─────────────
if [ -z "$SINCE" ] && [ -n "$CURSOR_FILE" ] && [ -r "$CURSOR_FILE" ]; then
  SINCE=$(tr -dc '0-9' < "$CURSOR_FILE")
fi
[ -n "$SINCE" ] || die "dopl-channel-wait: no cursor. Pass --since <seq>, or --cursor-file pointing at a file that holds one."

writeCursor() {
  [ -n "$CURSOR_FILE" ] || return 0
  printf '%s\n' "$1" > "$CURSOR_FILE".tmp 2>/dev/null && mv "$CURSOR_FILE".tmp "$CURSOR_FILE" 2>/dev/null
}

# ⚠ THE FILTER, DEFINED ONCE AND FED THE BODY ON STDIN. It is `python3 -c` and
# not a heredoc for a reason worth keeping: `python3 - <<PY` takes the PROGRAM
# on stdin, so a heredoc and a piped response body cannot both be there — the
# first version of this script had both and read every reply as unparseable.
FILTER='
import json, sys

to = sys.argv[1].strip()
channels = {c.strip().lower() for c in sys.argv[2].split() if c.strip()}

try:
    page = json.load(sys.stdin)
except Exception:
    print("ERR unreadable response body")
    raise SystemExit(0)

messages = page.get("messages") or []
if not messages:
    print("NONE")
    raise SystemExit(0)

cursor = max(int(m.get("seq", 0)) for m in messages)

def matches(m):
    if channels:
        handles = {str(m.get(k, "")).lower() for k in ("channelSlug", "channelId")}
        if not (handles & channels):
            return False
    if to and str(((m.get("metadata") or {}).get("to_user_id") or "")) != to:
        return False
    return True

hit = next((m for m in messages if matches(m)), None)
if hit is None:
    print("WAIT %d" % cursor)
    raise SystemExit(0)

# ONE LINE. A background task is read by its status and its last line; a page of
# JSON in a task notification is context spent to say "somebody replied".
body = " ".join(str(hit.get("body") or "").split())[:280]
print("HIT %s seq=%s channel=%s from=%s :: %s" % (
    cursor, hit.get("seq"),
    hit.get("channelSlug") or hit.get("channelId"),
    hit.get("authorUserId"), body,
))
'

# ⚠ Wall-clock budget struck ONCE. The loop bound is elapsed time, never an
# iteration count: a hold the server answers instantly must not buy an extra
# lap, and one it holds for the full 50s must not cost the budget twice.
DEADLINE=$(( $(date +%s) + MAX_MINUTES * 60 ))

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  QUERY="since=${SINCE}&timeoutMs=${POLL_TIMEOUT_MS}"
  [ -n "$EXCLUDE_AUTHOR" ] && QUERY="${QUERY}&excludeAuthor=${EXCLUDE_AUTHOR}"

  # --fail-with-body: a non-2xx exits non-zero AND still prints the body, so a
  # 401/403/400 is reported with the server's own reason rather than a bare
  # status. -sS keeps the meter off stdout and leaves real errors on stderr.
  BODY=$(curl -sS --fail-with-body \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "X-Workspace-Id: ${CONTAINER}" \
    -H "Accept: application/json" \
    "${BASE_URL%/}/api/channels/await?${QUERY}")
  STATUS=$?

  if [ $STATUS -ne 0 ]; then
    printf 'dopl-channel-wait: request failed (curl exit %s) against %s\n' "$STATUS" "$BASE_URL" >&2
    printf '%s\n' "$BODY" >&2
    exit 2
  fi

  # ⚠ THE FILTERS ARE APPLIED HERE, NOT ON THE WIRE. The workspace hold watches
  # every channel you are a member of and takes no `to`; narrowing it server-side
  # would need one hold per channel, which is N long-polls where one will do.
  # What comes back is filtered, and the CURSOR STILL ADVANCES over the rows
  # that were filtered out — they were seen, they were not for us, and holding
  # from an unadvanced cursor would return them again forever.
  RESULT=$(printf '%s' "$BODY" | python3 -c "$FILTER" "${TO}" "${CHANNELS}")

  case "$RESULT" in
    NONE)
      # The budget expired with nothing at all. Same cursor, hold again.
      continue
      ;;
    "WAIT "*)
      # Traffic landed, none of it ours. Advance past it and hold again — this
      # is the one place the cursor moves without the wait ending.
      SINCE="${RESULT#WAIT }"
      writeCursor "$SINCE"
      continue
      ;;
    "HIT "*)
      REST="${RESULT#HIT }"
      writeCursor "${REST%% *}"
      printf '%s\n' "dopl-channel-wait: ${REST#* }"
      exit 0
      ;;
    *)
      printf 'dopl-channel-wait: %s\n' "$RESULT" >&2
      exit 2
      ;;
  esac
done

printf 'dopl-channel-wait: nothing addressed to you on %s after seq %s within %s minute(s). Silence this long is the doctrine stop signal — report it rather than waiting again.\n' \
  "${CHANNELS:-any channel you are in}" "$SINCE" "$MAX_MINUTES" >&2
exit 3
