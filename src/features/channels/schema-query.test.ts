/**
 * INVARIANT SUITE — channels QUERY-STRING schemas.
 *
 * Split out of `schema.test.ts` (§2 500-line cap) along the layer seam that
 * file already had: everything here validates a `?a=b&c=d` URL, everything left
 * there validates a JSON body. The distinction is not cosmetic — a query param
 * arrives as a STRING no matter what it means, so these schemas are the only
 * ones that legitimately `z.coerce`, and the coercion is exactly what has to be
 * pinned (`coerce.number()` on a body field would turn `null` / `""` / `[]`
 * into 0, which is why the consent body's `messageSeq` deliberately does not).
 *
 * The invariants: caps hold (`limit` <= 200, `timeoutMs` <= 50000), defaults are
 * what the callers assume (`limit` 100, consent `status` pending), and the
 * message read's `thread` scope stays permissive enough for LEGACY thread ids.
 * A cap / default / enum change here is a contract change and must be deliberate.
 */

import { describe, it, expect } from "vitest";
import {
  MessageReadQuerySchema,
  AwaitQuerySchema,
  ConsentListQuerySchema,
} from "./schema";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("MessageReadQuerySchema", () => {
  it("defaults limit to 100 when omitted", () => {
    const parsed = MessageReadQuerySchema.parse({});
    expect(parsed.limit).toBe(100);
    expect(parsed.since).toBeUndefined();
  });

  it("coerces string query params to numbers", () => {
    const parsed = MessageReadQuerySchema.parse({ since: "42", limit: "10" });
    expect(parsed.since).toBe(42);
    expect(parsed.limit).toBe(10);
  });

  it("since: non-negative integer", () => {
    expect(MessageReadQuerySchema.safeParse({ since: "0" }).success).toBe(true);
    expect(MessageReadQuerySchema.safeParse({ since: "-1" }).success).toBe(false);
    expect(MessageReadQuerySchema.safeParse({ since: "1.5" }).success).toBe(false);
  });

  it("limit: positive, capped at 200", () => {
    expect(MessageReadQuerySchema.safeParse({ limit: "200" }).success).toBe(true);
    expect(MessageReadQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(MessageReadQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });

  it("thread: optional, and ANY non-empty string when present", () => {
    // Not `.uuid()` on purpose — legacy `task-<channelId>-<seq>` ids are real
    // metadata.taskId values, and they are the hardest threads to isolate.
    expect(MessageReadQuerySchema.parse({}).thread).toBeUndefined();
    expect(MessageReadQuerySchema.safeParse({ thread: UUID }).success).toBe(true);
    expect(
      MessageReadQuerySchema.safeParse({ thread: `task-${UUID}-7` }).success
    ).toBe(true);
    // Bounded and non-blank: a filter value is neither empty nor unbounded.
    expect(MessageReadQuerySchema.safeParse({ thread: "" }).success).toBe(false);
    expect(MessageReadQuerySchema.safeParse({ thread: "   " }).success).toBe(false);
    expect(
      MessageReadQuerySchema.safeParse({ thread: "t".repeat(201) }).success
    ).toBe(false);
  });
});

describe("AwaitQuerySchema", () => {
  it("timeoutMs: optional, capped at 50000", () => {
    expect(AwaitQuerySchema.safeParse({}).success).toBe(true);
    expect(AwaitQuerySchema.safeParse({ timeoutMs: "50000" }).success).toBe(true);
    expect(AwaitQuerySchema.safeParse({ timeoutMs: "50001" }).success).toBe(false);
    expect(AwaitQuerySchema.safeParse({ timeoutMs: "0" }).success).toBe(false);
  });

  it("excludeAuthor: optional, and a uuid when present", () => {
    expect(AwaitQuerySchema.safeParse({ excludeAuthor: UUID }).success).toBe(true);
    expect(AwaitQuerySchema.safeParse({ excludeAuthor: "me" }).success).toBe(false);
    expect(AwaitQuerySchema.safeParse({}).data?.excludeAuthor).toBeUndefined();
  });

  // The await hold has NO thread scope by design: a thread-scoped wait is its
  // own design question (what a hold that never matches should do), and the
  // read filter deliberately did not answer it. Unknown keys are stripped, so
  // a caller that guesses `thread` here waits on the whole channel — the
  // schema must not quietly imply otherwise by accepting it as meaningful.
  it("ignores a `thread` param (the scope is read-only, not an await feature)", () => {
    const parsed = AwaitQuerySchema.parse({ since: "1", thread: UUID });
    expect(Object.prototype.hasOwnProperty.call(parsed, "thread")).toBe(false);
  });
});

describe("ConsentListQuerySchema", () => {
  it("channelId: optional uuid", () => {
    expect(ConsentListQuerySchema.safeParse({}).success).toBe(true);
    expect(ConsentListQuerySchema.safeParse({ channelId: UUID }).success).toBe(true);
    expect(ConsentListQuerySchema.safeParse({ channelId: "x" }).success).toBe(false);
  });

  it("status: pending|decided|all, defaults pending (M-4)", () => {
    expect(ConsentListQuerySchema.parse({}).status).toBe("pending");
    expect(ConsentListQuerySchema.parse({ status: "decided" }).status).toBe("decided");
    expect(ConsentListQuerySchema.parse({ status: "all" }).status).toBe("all");
    expect(ConsentListQuerySchema.safeParse({ status: "allowed" }).success).toBe(false);
  });
});
