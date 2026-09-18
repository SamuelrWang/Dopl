/**
 * The card pill's word (2026-09-01: a base shared into a channel still read
 * "Private").
 *
 * The rule under test is `kbCardLabel`'s alone: a channel share overrides
 * `private` and only `private`. The ladder is `private` < shared-into-a-channel
 * < `team` < `workspace`, so overriding either wider scope would narrow what the
 * card claims.
 */

import { describe, expect, it } from "vitest";
import type { KbScope } from "../../scope";
import { KB_SCOPE_CARD_LABEL, kbCardLabel } from "./list-filters";

const SCOPES: readonly KbScope[] = ["private", "team", "workspace"];

describe("kbCardLabel", () => {
  it("reads the scope's own word when the base is shared nowhere", () => {
    for (const scope of SCOPES) {
      expect(kbCardLabel(scope, false)).toBe(KB_SCOPE_CARD_LABEL[scope]);
    }
  });

  // The bug: a base that had left the operator's private shelf still said it
  // had not.
  it("reads Shared when a PRIVATE base is granted into a channel", () => {
    expect(kbCardLabel("private", false)).toBe("Private");
    expect(kbCardLabel("private", true)).toBe("Shared");
  });

  /**
   * "Public" is a wider claim than "Shared" — every workspace member reads a
   * public base, where a channel share reaches one room — so replacing it would
   * understate the base's reach. Same for "Team".
   */
  it("leaves TEAM and PUBLIC alone — both already reach further than one channel", () => {
    expect(kbCardLabel("team", true)).toBe("Team");
    expect(kbCardLabel("workspace", true)).toBe("Public");
  });

  // The three scope words themselves must not drift from the filter row's.
  it("never invents a word outside the known set", () => {
    const allowed = new Set([...Object.values(KB_SCOPE_CARD_LABEL), "Shared"]);
    for (const scope of SCOPES) {
      for (const shared of [true, false]) {
        expect(allowed.has(kbCardLabel(scope, shared))).toBe(true);
      }
    }
  });
});
