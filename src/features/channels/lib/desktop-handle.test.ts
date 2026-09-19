import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_DELIVERY,
  DESKTOP_GROUP_HANDLE,
  DESKTOP_TO_METADATA_KEY,
  DESKTOP_VERDICT,
  EXTERNAL_SESSION_METADATA_KEY,
  authorViewOf,
  desktopAddresseeOf,
  isDesktopGroupHandle,
  isExternalSessionAuthor,
  isExternalSessionPost,
} from "./desktop-handle";

/**
 * **`@desktop` — THE VOCABULARY, ITS DISCRIMINATOR, AND THE HAND-COPY THAT CAN
 * DRIFT** (2026-09-18).
 *
 * ⚠ **THE STALE-PAYLOAD CASES ARE THE REASON THIS FILE EXISTS.** Every reader
 * below is fed a row that predates the key, a row an older server wrote, and a
 * row carrying junk — because the rule these keys were designed around is that
 * ABSENCE must render as yesterday's behaviour rather than as a claim.
 */

describe("the discriminator", () => {
  it("is an agent post with no desktop-session runtime stamp", () => {
    expect(isExternalSessionAuthor("agent", null)).toBe(true);
    expect(isExternalSessionAuthor("agent", undefined)).toBe(true);
  });

  it("is NOT a desktop-run session", () => {
    expect(isExternalSessionAuthor("agent", "desktop-session")).toBe(false);
  });

  it("is NEVER a human composer, on either surface", () => {
    // ⚠ The desktop app's own window stamps `desktop-ui` and posts as `user`;
    // the web composer stamps nothing and posts as `user`. Neither may ever be
    // labelled an outside session, and the author kind is what forecloses it.
    expect(isExternalSessionAuthor("user", "desktop-ui")).toBe(false);
    expect(isExternalSessionAuthor("user", null)).toBe(false);
    expect(isExternalSessionAuthor("system", null)).toBe(false);
  });

  it("FAILURE MODE, PINNED: an older desktop build labels as external", () => {
    // ⚠ NOT A BUG TO FIX HERE — it is the documented cost of reading a
    // caller-supplied header, the same blind spot `channel-wake-guidance.ts`
    // records. Pinned so that a future reader meets the limitation as a stated
    // fact rather than discovering it from a confusing transcript.
    expect(isExternalSessionAuthor("agent", null)).toBe(true);
  });
});

describe("the handle", () => {
  it("matches bare and lowercased, and nothing else", () => {
    expect(isDesktopGroupHandle("desktop")).toBe(true);
    expect(isDesktopGroupHandle("DeskTop")).toBe(true);
    expect(isDesktopGroupHandle(" desktop ")).toBe(true);
    expect(isDesktopGroupHandle("desktop-1")).toBe(false);
    expect(isDesktopGroupHandle("desktops")).toBe(false);
    expect(isDesktopGroupHandle(null)).toBe(false);
  });
});

describe("reading a stored row — absence is yesterday's behaviour", () => {
  const agentRow = { authorKind: "agent", metadata: {} };

  it("an unstamped agent row is an ordinary agent, not an outside session", () => {
    expect(isExternalSessionPost(agentRow)).toBe(false);
    expect(authorViewOf(agentRow)).toBe("agent");
  });

  it("a row with NO metadata at all answers the same way", () => {
    // ⚠ Every pre-2026-09-18 row, and every row an older server writes.
    expect(authorViewOf({ authorKind: "agent" })).toBe("agent");
    expect(authorViewOf({ authorKind: "agent", metadata: null })).toBe("agent");
    expect(desktopAddresseeOf({ authorKind: "agent" })).toBeNull();
  });

  it("only a literal `true` counts — truthy junk is NOT a claim", () => {
    // 🔒 The write path stamps `true` or nothing, so anything else means "this
    // server did not say". Coercing would let junk decide an attribution.
    for (const junk of ["true", 1, {}, "yes", [] as unknown]) {
      expect(
        isExternalSessionPost({
          authorKind: "agent",
          metadata: { [EXTERNAL_SESSION_METADATA_KEY]: junk },
        }),
        `metadata value ${JSON.stringify(junk)}`,
      ).toBe(false);
    }
  });

  it("a stamped agent row projects to `external`", () => {
    const row = {
      authorKind: "agent",
      metadata: { [EXTERNAL_SESSION_METADATA_KEY]: true },
    };
    expect(isExternalSessionPost(row)).toBe(true);
    expect(authorViewOf(row)).toBe("external");
  });

  it("the flag NEVER promotes a human or a system row", () => {
    // ⚠ A stamped `user` row should not exist — the write path cannot produce
    // one — but a renderer must not be the thing that trusts that.
    const meta = { [EXTERNAL_SESSION_METADATA_KEY]: true };
    expect(authorViewOf({ authorKind: "user", metadata: meta })).toBe("user");
    expect(authorViewOf({ authorKind: "system", metadata: meta })).toBe("system");
  });

  it("an unrecognized author kind falls back to the column's own DEFAULT", () => {
    expect(authorViewOf({ authorKind: "wat" })).toBe("agent");
    expect(authorViewOf({})).toBe("agent");
  });

  it("the desktop addressee is the operator id, and blanks read as absent", () => {
    expect(
      desktopAddresseeOf({ metadata: { [DESKTOP_TO_METADATA_KEY]: "user-1" } }),
    ).toBe("user-1");
    expect(
      desktopAddresseeOf({ metadata: { [DESKTOP_TO_METADATA_KEY]: "   " } }),
    ).toBeNull();
    expect(
      desktopAddresseeOf({ metadata: { [DESKTOP_TO_METADATA_KEY]: 42 } }),
    ).toBeNull();
  });
});

/**
 * 🔒 **THE HAND-COPY, PINNED IN BOTH DIRECTIONS.**
 *
 * `packages/mcp-server` cannot import this tree (INVARIANTS §13), so the four
 * constants are written twice. ⚠ Drift is SILENT and presents as "the tag
 * stopped working" — a `to=@desktop` that resolves on the server and renders as
 * an ordinary address in the read — so it is asserted against the OTHER FILE'S
 * SOURCE rather than against a copy of the values.
 */
describe("the MCP package's hand-copy", () => {
  const mirror = readFileSync(
    resolve(
      __dirname,
      "../../../../packages/mcp-server/src/tools/channel-desktop-tag.ts",
    ),
    "utf8",
  );

  it.each([
    ["DESKTOP_GROUP_HANDLE", DESKTOP_GROUP_HANDLE],
    ["DESKTOP_TO_METADATA_KEY", DESKTOP_TO_METADATA_KEY],
    ["EXTERNAL_SESSION_METADATA_KEY", EXTERNAL_SESSION_METADATA_KEY],
  ])("%s agrees", (name, value) => {
    expect(mirror, `${name} drifted from this tree`).toContain(
      `export const ${name} = "${value}";`,
    );
  });

  it("the verdict and delivery words are the ones the type unions declare", () => {
    // ⚠ These two are NOT in the MCP mirror — that package reads them off the
    // wire as opaque strings — so they are pinned against the declarations that
    // DO have to agree: the web union and the SDK's hand-maintained mirror.
    const web = readFileSync(resolve(__dirname, "../types-delivery.ts"), "utf8");
    const sdk = readFileSync(
      resolve(__dirname, "../../../../packages/dopl-client/src/delivery-types.ts"),
      "utf8",
    );
    for (const source of [web, sdk]) {
      expect(source).toContain(`| "${DESKTOP_VERDICT}"`);
      expect(source).toContain(`| "${DESKTOP_DELIVERY}"`);
    }
  });
});
