/**
 * Session telemetry is operator-only; peers get the coarse projection. The suite is a property over
 * `OPERATOR_ONLY_SESSION_FIELDS`, so a newly registered column is covered without a new case. The fence
 * is `mapPeerSessionStateRow`: both session reads run on the admin client, which bypasses RLS and the
 * column grants (`schema-sql-sessions.test.ts` pins those as the PostgREST belt).
 */

import { describe, it, expect } from "vitest";
import {
  OPERATOR_ONLY_SESSION_COLUMNS,
  OPERATOR_ONLY_SESSION_FIELDS,
  mapOwnSessionStateRow,
  mapPeerSessionStateRow,
  narrowSessionDetail,
  type SessionStateRow,
} from "./collab-dto";

/** Every telemetry column populated: a row of nulls cannot tell a passing-through mapper from a narrowing one. */
function fullRow(over: Partial<SessionStateRow> = {}): SessionStateRow {
  return {
    id: "s-1",
    channel_id: "11111111-1111-1111-1111-111111111111",
    workspace_id: "22222222-2222-2222-2222-222222222222",
    user_id: "33333333-3333-3333-3333-333333333333",
    session_key: "11111111-1111-1111-1111-111111111111:t:abcd1234",
    task_id: "44444444-4444-4444-4444-444444444444",
    name: "abcd1234",
    state: "working",
    channel_name: "General",
    thread_title: "Deploy check",
    created_at: "2026-08-22T10:00:00.000Z",
    updated_at: "2026-08-22T10:05:00.000Z",
    detail: "tool",
    tool_label: "Bash",
    model: "claude-sonnet-5",
    context_used: 124_000,
    context_window: 200_000,
    tokens_spent: 41_233,
    started_at: "2026-08-22T09:40:00.000Z",
    last_activity_at: "2026-08-22T10:04:59.000Z",
    // Distinctive, because the value property does a substring search over the peer JSON.
    identity_name: "Acme Contract Auditor",
    // Peer-visible by design, so it must survive the peer mapper.
    display_name: "Bug Reviewer",
    color: "agent-04",
    // Values chosen to occur nowhere in the peer JSON (`name`, ISO stamps): the value property is a substring search.
    turns: 47,
    tokens_delta: 8_675_309,
    stale: true,
    denied_calls: 419,
    // Not `tool_label`'s value, or a leak of the current tool would satisfy this one.
    last_denied_tool: "Terraform",
    last_wake_seq: 90_210,
    last_wake_at: "2026-08-22T09:59:00.000Z",
    ...over,
  };
}

describe("the PEER mapper can never emit operator-only telemetry", () => {
  it("PROPERTY: no key of the peer projection is an operator-only field", () => {
    const peer = mapPeerSessionStateRow(fullRow());
    const keys = Object.keys(peer);
    for (const forbidden of OPERATOR_ONLY_SESSION_FIELDS) {
      expect(
        keys,
        `mapPeerSessionStateRow emitted "${forbidden}" — a peer must never see what an agent runs on or costs its operator`
      ).not.toContain(forbidden);
    }
  });

  it("PROPERTY: and no VALUE of the peer projection is one of the row's secrets", () => {
    // Over values, so a leak under another key name still fails.
    const row = fullRow();
    const serialized = JSON.stringify(mapPeerSessionStateRow(row));
    for (const column of OPERATOR_ONLY_SESSION_COLUMNS) {
      const value = row[column as keyof SessionStateRow];
      if (value === null || value === undefined) continue;
      expect(
        serialized,
        `the peer projection carries the value of "${column}" under some other name`
      ).not.toContain(String(value));
    }
  });

  it("the two arrays stay parallel — a column registered without its field is a hole", () => {
    expect(OPERATOR_ONLY_SESSION_COLUMNS).toHaveLength(
      OPERATOR_ONLY_SESSION_FIELDS.length
    );
    // snake_case → camelCase, so a new pair cannot be added to one list only.
    const derived = OPERATOR_ONLY_SESSION_COLUMNS.map((c) =>
      c.replace(/_([a-z])/g, (_m, ch: string) => ch.toUpperCase())
    );
    expect(derived).toEqual([...OPERATOR_ONLY_SESSION_FIELDS]);
  });

  it("every operator-only COLUMN is a real column on the row type", () => {
    const row = fullRow();
    for (const column of OPERATOR_ONLY_SESSION_COLUMNS) {
      expect(
        Object.prototype.hasOwnProperty.call(row, column),
        `"${column}" is registered as operator-only but is not a column — the fence names a field nothing produces`
      ).toBe(true);
    }
  });

  it("the peer projection is EXACTLY the coarse set — nothing crept in", () => {
    // The property catches a known secret; the exact key set catches an unclassified new column.
    expect(Object.keys(mapPeerSessionStateRow(fullRow())).sort()).toEqual(
      [
        "channelId",
        "channelName",
        // Peer-visible by design: other members' transcripts tell agents apart by colour.
        "color",
        "detail",
        // Peer-visible by design.
        "displayName",
        "name",
        "state",
        "threadId",
        "threadTitle",
        "updatedAt",
      ].sort()
    );
  });
});

describe("the OWN mapper carries everything — the split has two directions", () => {
  it("emits every operator-only field, with its value", () => {
    const own = mapOwnSessionStateRow(fullRow());
    expect(own.model).toBe("claude-sonnet-5");
    expect(own.toolLabel).toBe("Bash");
    expect(own.contextUsed).toBe(124_000);
    expect(own.contextWindow).toBe(200_000);
    expect(own.tokensSpent).toBe(41_233);
    expect(own.startedAt).toBe("2026-08-22T09:40:00.000Z");
    expect(own.lastActivityAt).toBe("2026-08-22T10:04:59.000Z");
    expect(own.identityName).toBe("Acme Contract Auditor");
    expect(own.turns).toBe(47);
    expect(own.tokensDelta).toBe(8_675_309);
    expect(own.stale).toBe(true);
    expect(own.deniedCalls).toBe(419);
    expect(own.lastDeniedTool).toBe("Terraform");
    expect(own.lastWakeSeq).toBe(90_210);
    expect(own.lastWakeAt).toBe("2026-08-22T09:59:00.000Z");
  });

  it("is a strict superset of the peer projection", () => {
    const peer = mapPeerSessionStateRow(fullRow());
    const own = mapOwnSessionStateRow(fullRow());
    for (const [k, v] of Object.entries(peer)) {
      expect(own[k as keyof typeof own]).toEqual(v);
    }
  });

  /** Null is unknown, never zero: `?? 0` would state "spent nothing" about an unreported machine. */
  it("a null count stays null and NEVER becomes 0", () => {
    const own = mapOwnSessionStateRow(
      fullRow({
        context_used: null,
        context_window: null,
        tokens_spent: null,
        started_at: null,
        last_activity_at: null,
        model: null,
        tool_label: null,
      })
    );
    expect(own.contextUsed).toBeNull();
    expect(own.contextWindow).toBeNull();
    expect(own.tokensSpent).toBeNull();
    expect(own.startedAt).toBeNull();
    expect(own.lastActivityAt).toBeNull();
    expect(own.model).toBeNull();
    expect(own.toolLabel).toBeNull();
  });

  /** `deniedCalls: 0` or `stale: false` would state a verdict about a machine that never measured. */
  it("an UNREPORTED health field stays null — never 0, and never false", () => {
    const own = mapOwnSessionStateRow(
      fullRow({
        turns: null,
        tokens_delta: null,
        stale: null,
        denied_calls: null,
        last_denied_tool: null,
        last_wake_seq: null,
        last_wake_at: null,
      })
    );
    expect(own.turns).toBeNull();
    expect(own.tokensDelta).toBeNull();
    expect(own.stale).toBeNull();
    expect(own.deniedCalls).toBeNull();
    expect(own.lastDeniedTool).toBeNull();
    expect(own.lastWakeSeq).toBeNull();
    expect(own.lastWakeAt).toBeNull();
  });

  /** A measured 0 is "counted, none"; a falsy test (`row.turns || null`) would collapse it into null. */
  it("a measured 0 survives as 0, and a measured `false` as false", () => {
    const own = mapOwnSessionStateRow(
      fullRow({ turns: 0, tokens_delta: 0, denied_calls: 0, stale: false })
    );
    expect(own.turns).toBe(0);
    expect(own.tokensDelta).toBe(0);
    expect(own.deniedCalls).toBe(0);
    expect(own.stale).toBe(false);
  });

  /** PostgREST hands back an INT8 that does not fit a JS number as a string; unreadable is unknown. */
  it("a health BIGINT arriving as a string becomes a number, unparseable becomes null", () => {
    const own = mapOwnSessionStateRow(
      fullRow({ tokens_delta: "8675309", last_wake_seq: "not-a-number" })
    );
    expect(own.tokensDelta).toBe(8_675_309);
    expect(own.lastWakeSeq).toBeNull();
  });

  /** A snapshot, not a lookup: a session keeps reporting what it ran as after a rename or deletion. */
  it("passes an identity name through verbatim, and a null through as null", () => {
    expect(mapOwnSessionStateRow(fullRow({ identity_name: null })).identityName)
      .toBeNull();
    expect(
      mapOwnSessionStateRow(fullRow({ identity_name: "Deleted Identity" }))
        .identityName
    ).toBe("Deleted Identity");
  });

  it("a BIGINT arriving as a string becomes a number, and an unparseable one becomes null", () => {
    const own = mapOwnSessionStateRow(
      fullRow({ tokens_spent: "41233", context_used: "not-a-number" })
    );
    expect(own.tokensSpent).toBe(41_233);
    expect(own.contextUsed).toBeNull();
  });
});

/** `detail` is peer-visible only because its vocabulary is closed; the narrowing is part of the fence. */
describe("detail is a closed KEY on the way out, and forgiving on the way in", () => {
  it("passes the six known keys through", () => {
    for (const key of [
      "thinking",
      "tool",
      "posting",
      "permission",
      "awaiting_peer",
      "awaiting_inbound",
    ]) {
      expect(narrowSessionDetail(key)).toBe(key);
      expect(mapPeerSessionStateRow(fullRow({ detail: key })).detail).toBe(key);
    }
  });

  it("SECURITY: free-form prose in the column NEVER reaches a peer", () => {
    const leak = "reading 4 files in ~/clients/acme/contracts";
    expect(narrowSessionDetail(leak)).toBeNull();
    expect(mapPeerSessionStateRow(fullRow({ detail: leak })).detail).toBeNull();
    expect(
      JSON.stringify(mapPeerSessionStateRow(fullRow({ detail: leak })))
    ).not.toContain("clients");
  });

  it("a SEVENTH key from a newer desktop renders as nothing rather than as itself", () => {
    // Fail-closed: a newer key must store (or the whole push 400s) but must not render raw.
    expect(narrowSessionDetail("awaiting_handoff")).toBeNull();
  });

  it("null and undefined both narrow to null", () => {
    expect(narrowSessionDetail(null)).toBeNull();
    expect(narrowSessionDetail(undefined)).toBeNull();
  });
});
