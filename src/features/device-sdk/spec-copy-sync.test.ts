/**
 * The SDK package carries its own copy of the HTTP spec (`packages/sdk/spec/openapi.yaml`, read by
 * its drift test) so it builds and tests standalone. Until the platform pins the published SDK
 * (plan W2.2) both copies live here, and they must stay byte-equal: edit one, copy to the other.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("device-sdk openapi.yaml copies", () => {
  it("docs/specs and packages/sdk/spec are identical", () => {
    const docs = readFileSync(join(process.cwd(), "docs", "specs", "device-sdk", "openapi.yaml"), "utf8");
    const sdk = readFileSync(join(process.cwd(), "packages", "sdk", "spec", "openapi.yaml"), "utf8");
    expect(sdk).toBe(docs);
  });
});
