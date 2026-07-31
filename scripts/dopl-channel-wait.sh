#!/usr/bin/env bash
#
# dopl-channel-wait.sh — turn a Dopl channel wait into a background-task WAKE.
#
# WHY THIS EXISTS. `dopl_channel(op="await")` holds inside the MCP call, which
# means it returns inside the TURN that armed it: a pending call keeps a turn
# alive, it cannot end one. Whether a still-pending call is backgrounded and
# delivered later as a wake is a property of the caller's MCP client, and the
# server cannot see it — so an EXTERNAL session (one nothing else feeds) has no
# reliable way to be woken by a reply.
#
# A harness that can run background shell tasks already has one. Run this poll
# as such a task and END the turn: the task's own completion is a wake the
# client delivers, and its stdout is the messages that arrived. The wait moves
# out of the model's turn entirely.
#
# USAGE (everything is env, nothing is an argument):
#
#   DOPL_TOKEN=...        required — API token. Sent ONLY as an Authorization
#                         header. Never echoed, never logged, never put in the
#                         URL (URLs land in server logs and proxy history).
#   DOPL_BASE_URL=...     optional — default https://www.usedopl.com
#   CHANNEL=...           required — channel slug or id (the [channelId] segment)
#   SINCE=...             required — the last seq you have processed
#   WORKSPACE=...         required — workspace UUID, sent as X-Workspace-Id
#                         (the header `withWorkspaceAuth` resolves; resolution
#                         is fail-closed, so there is no default to omit it for)
#   EXCLUDE_AUTHOR=...    optional — user id whose posts should NOT end the wait
#                         (normally your own, so your own posts don't wake you)
#   MAX_MINUTES=...       optional — total budget, default 30
#
# EXIT CODES — the whole contract, because a background task is read by its
# status as much as its output:
#   0  messages arrived; the raw JSON body is on stdout
#   3  budget spent with nothing arriving (re-run with the SAME since)
#   2  a request failed (auth, 4xx, transport); the detail is on stderr
#
# The route holds ~50s per call, so this is one request per ~50s, not a spin.

set -uo pipefail

BASE_URL="${DOPL_BASE_URL:-https://www.usedopl.com}"
MAX_MINUTES="${MAX_MINUTES:-30}"
POLL_TIMEOUT_MS=50000

die() {
  printf '%s\n' "$1" >&2
  exit 2
}

# Required env, checked by name so the failure names the missing variable
# rather than producing an unauthenticated request against a guessed URL.
[ -n "${DOPL_TOKEN:-}" ] || die "dopl-channel-wait: DOPL_TOKEN is required (an API token; it is sent as a bearer header and never printed)."
[ -n "${CHANNEL:-}" ] || die "dopl-channel-wait: CHANNEL is required (a channel slug or id)."
[ -n "${SINCE:-}" ] || die "dopl-channel-wait: SINCE is required (the last seq you have processed)."
[ -n "${WORKSPACE:-}" ] || die "dopl-channel-wait: WORKSPACE is required (the workspace UUID; workspace resolution is fail-closed)."

command -v curl >/dev/null 2>&1 || die "dopl-channel-wait: curl is not on PATH."

# Query string. `since` and `timeoutMs` always; `excludeAuthor` only when set,
# because the route's zod schema rejects a present-but-empty value.
QUERY="since=${SINCE}&timeoutMs=${POLL_TIMEOUT_MS}"
if [ -n "${EXCLUDE_AUTHOR:-}" ]; then
  QUERY="${QUERY}&excludeAuthor=${EXCLUDE_AUTHOR}"
fi
URL="${BASE_URL%/}/api/channels/${CHANNEL}/await?${QUERY}"

# Wall-clock budget, struck once. The loop bound is elapsed time, never an
# iteration count — a poll the route answers instantly must not buy an extra
# lap, and one it holds for the full 50s must not cost the budget twice.
DEADLINE=$(( $(date +%s) + MAX_MINUTES * 60 ))

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  # --fail-with-body: non-2xx exits non-zero AND still prints the body, so a
  # 401/403/400 can be reported with the server's own reason instead of a bare
  # status. -sS keeps the progress meter off stdout but leaves real errors on
  # stderr. The token is a header argument and appears nowhere else.
  BODY=$(curl -sS --fail-with-body \
    -H "Authorization: Bearer ${DOPL_TOKEN}" \
    -H "X-Workspace-Id: ${WORKSPACE}" \
    -H "Accept: application/json" \
    "$URL")
  STATUS=$?

  if [ $STATUS -ne 0 ]; then
    printf 'dopl-channel-wait: request failed (curl exit %s) for channel %s\n' "$STATUS" "$CHANNEL" >&2
    printf '%s\n' "$BODY" >&2
    exit 2
  fi

  # "Did anything arrive?" without a JSON parser: the route answers a quiet
  # hold with an EMPTY messages array and `timedOut: true`, so an empty array
  # is the one shape that means keep waiting. Anything else — messages, or a
  # body we do not recognize — is handed to the caller rather than swallowed.
  case "$BODY" in
    *'"messages":[]'* | *'"messages": []'*)
      continue
      ;;
  esac

  printf '%s\n' "$BODY"
  exit 0
done

printf 'dopl-channel-wait: no new messages on %s after seq %s within %s minute(s).\n' \
  "$CHANNEL" "$SINCE" "$MAX_MINUTES" >&2
exit 3
