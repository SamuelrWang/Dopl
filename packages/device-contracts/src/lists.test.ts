import { describe, expect, it } from "vitest";
import { z } from "zod";

import { LIST_LIMIT_DEFAULT, ListQuerySchema, listResponseSchema } from "./lists";

describe("list convention", () => {
  it("defaults limit and coerces it from a query string", () => {
    expect(ListQuerySchema.parse({})).toEqual({ limit: LIST_LIMIT_DEFAULT });
    expect(ListQuerySchema.parse({ limit: "10", cursor: "abc_-9" })).toEqual({ limit: 10, cursor: "abc_-9" });
  });

  it("bounds limit to 1..100", () => {
    expect(ListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(ListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(ListQuerySchema.safeParse({ limit: "2.5" }).success).toBe(false);
  });

  it("refuses a cursor outside the base64url alphabet", () => {
    for (const cursor of ["", "a+b", "a/b", "a=", "x".repeat(513), "ts.lt.2026"]) {
      expect(ListQuerySchema.safeParse({ cursor }).success, cursor).toBe(false);
    }
  });

  it("ties has_more to next_cursor", () => {
    const page = listResponseSchema(z.string());
    expect(page.safeParse({ data: ["a"], next_cursor: "Yw", has_more: true }).success).toBe(true);
    expect(page.safeParse({ data: [], next_cursor: null, has_more: false }).success).toBe(true);
    expect(page.safeParse({ data: [], next_cursor: null, has_more: true }).success).toBe(false);
    expect(page.safeParse({ data: [], next_cursor: "Yw", has_more: false }).success).toBe(false);
  });
});
