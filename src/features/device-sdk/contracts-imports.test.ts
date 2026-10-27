/**
 * The Next app bundles `@dopl/contracts/device-sdk` from SOURCE, and Turbopack does not map a
 * `./x.js` specifier to `x.ts` (INVARIANTS §1). A `.js`-suffixed relative import in a runtime file
 * of that subpath breaks `next build` for every `/api/v1` route; this pins them extensionless.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "packages", "contracts", "src", "device-sdk");

describe("@dopl/contracts/device-sdk runtime imports", () => {
  it("are extensionless (Turbopack-resolvable)", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    const bad = files.flatMap((f) =>
      [...readFileSync(join(DIR, f), "utf8").matchAll(/from\s+"(\.{1,2}\/[^"]+\.js)"/g)].map((m) => `${f}: ${m[1]}`)
    );
    expect(bad).toEqual([]);
  });
});
