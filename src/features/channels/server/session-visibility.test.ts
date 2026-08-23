/**
 * THE VISIBILITY SPLIT — Samuel's ruling of 2026-08-22: session TELEMETRY is
 * OPERATOR-ONLY; peers keep the coarse projection.
 *
 * ⚠ **THIS SUITE IS A PROPERTY TEST, NOT A LIST OF EXAMPLES, AND THAT IS THE
 * WHOLE DESIGN.** A suite that checked "the peer mapper does not emit
 * `tokensSpent`" would pass forever and cover nothing the day a ninth column is
 * added. What is asserted instead is a property over the FIELD NAMES themselves
 * (`OPERATOR_ONLY_SESSION_FIELDS`): **no key of the peer mapper's output may be
 * one of them, for any row.** A new telemetry column is registered in that array
 * — which the same suite pins against the row type — and the property covers it
 * without anyone remembering to write a case.
 *
 * ⚠ THE FENCE IS THIS MAPPER AND NOT THE DATABASE, which is why the test lives
 * here rather than being left to RLS or a GRANT. Both session reads run on the
 * RLS- and grant-bypassing admin client (`repository-sessions.ts` says so in its
 * own header, and must, because the table REVOKEs writes from `authenticated`).
 * `service_role` keeps every column grant and is not subject to RLS, so the
 * column privileges in migration `20260822150000` cannot see this path at all —
 * they are the belt for PostgREST. The fence is `mapPeerSessionStateRow`.
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

/** A row with EVERY telemetry column populated — the adversarial input. A row of
 *  nulls would let a mapper that passes the fields through look identical to one
 *  that never names them. */
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
    // ⚠ 2026-08-23 — AND ADDING IT HERE IS THE ENTIRE TEST CHANGE FOR THE
    // TEMPLATE-NAME COLUMN. Registering `template_name` / `templateName` in
    // `OPERATOR_ONLY_SESSION_COLUMNS` + `…_FIELDS` and populating it on this row
    // is what makes every property below cover it: the peer mapper must not emit
    // the KEY, must not carry the VALUE under another name, the two arrays must
    // stay parallel, and the coarse key set must not have grown. **No new case
    // was written for it, and that is what this suite is for.**
    // ⚠ The value is deliberately DISTINCTIVE prose — the value-property test
    // does a substring search, and a value like "Auditor" would be defeated by a
    // row field that legitimately contains it.
    template_name: "Acme Contract Auditor",
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
    // ⚠ The name check above is defeated by a rename ("model" smuggled out as
    // "engine"). This one is over the VALUES, so a renamed leak still fails.
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
    // ⚠ An exact-key assertion as well as the property, because the property
    // catches a KNOWN secret and this catches an UNKNOWN one: a future column
    // that nobody classified would pass every test above and fail this.
    expect(Object.keys(mapPeerSessionStateRow(fullRow())).sort()).toEqual(
      [
        "channelId",
        "channelName",
        "detail",
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
    expect(own.templateName).toBe("Acme Contract Auditor");
  });

  it("is a strict superset of the peer projection", () => {
    const peer = mapPeerSessionStateRow(fullRow());
    const own = mapOwnSessionStateRow(fullRow());
    for (const [k, v] of Object.entries(peer)) {
      expect(own[k as keyof typeof own]).toEqual(v);
    }
  });

  /**
   * ⚠ NULL IS UNKNOWN, NEVER ZERO — the rule the whole telemetry wave is built
   * on. A `?? 0` anywhere between the column and the render turns "this machine
   * reported nothing" into "this agent has spent nothing", stated as fact in the
   * surface an orchestrator uses to decide whether to keep an agent alive.
   */
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

  /**
   * `templateName` IS A SNAPSHOT, NOT A LOOKUP — the mapper passes the stored
   * string through and resolves nothing. That is what lets a session go on
   * reporting what it RAN AS after the template was renamed or deleted
   * (`20260823130000`), and it is the reason the column is TEXT rather than an
   * FK. A mapper that ever "corrected" this value would be reinventing the FK.
   */
  it("passes a template name through verbatim, and a null through as null", () => {
    expect(mapOwnSessionStateRow(fullRow({ template_name: null })).templateName)
      .toBeNull();
    // A template that no longer exists under that name is STILL what this
    // session is running, and the row must keep saying so.
    expect(
      mapOwnSessionStateRow(fullRow({ template_name: "Deleted Template" }))
        .templateName
    ).toBe("Deleted Template");
  });

  it("a BIGINT arriving as a string becomes a number, and an unparseable one becomes null", () => {
    // PostgREST can hand a bigint back as either; an unreadable value is UNKNOWN
    // rather than 0, for the same reason a missing one is.
    const own = mapOwnSessionStateRow(
      fullRow({ tokens_spent: "41233", context_used: "not-a-number" })
    );
    expect(own.tokensSpent).toBe(41_233);
    expect(own.contextUsed).toBeNull();
  });
});

/**
 * `detail` IS PEER-VISIBLE **ONLY BECAUSE THE VOCABULARY IS CLOSED.** Free-form
 * prose in that column would be operator-only material on a peer-visible field —
 * so the narrowing is part of the fence, not a formatting nicety.
 */
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
    // ⚠ Fail-closed, and it is the counterpart of the write path staying
    // permissive: a newer key must STORE (or the whole push 400s unretryably)
    // and must not RENDER raw.
    expect(narrowSessionDetail("awaiting_handoff")).toBeNull();
  });

  it("null and undefined both narrow to null", () => {
    expect(narrowSessionDetail(null)).toBeNull();
    expect(narrowSessionDetail(undefined)).toBeNull();
  });
});
