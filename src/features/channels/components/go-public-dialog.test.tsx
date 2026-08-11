/**
 * C-13 (visibility half) — the human half of the gate.
 *
 * Two things are pinned here, and they fail for different mutations:
 *
 *  1. THE COPY. A confirm that does not say what going public costs is the same
 *     bug in a nicer wrapper, so the description must name the whole channel,
 *     the history already in it, and the workspace-wide audience. Asserted
 *     against the exported builders rather than a render: `ModalShell` portals
 *     itself in from an effect, so `renderToStaticMarkup` of an OPEN dialog is
 *     the empty string. Same split `GroupChannelRoutingNote` uses.
 *
 *  2. THE WIRING. `channels-view-core.tsx` must route the menu's toggle through
 *     the confirm branch instead of straight to the write. That is a source
 *     assertion on purpose: the branch fires on a click, which a static render
 *     cannot deliver, and without it "delete the dialog" is a silent green.
 *     Same idiom as `shared/auth/write-gate-coverage.test.ts` — pin the seam
 *     the security property depends on, not the mechanism around it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  goPublicDescription,
  goPublicTitle,
  needsGoPublicConfirm,
} from "./go-public-dialog";

describe("needsGoPublicConfirm", () => {
  it("private (about to WIDEN) needs the human; public (about to NARROW) does not", () => {
    expect(needsGoPublicConfirm("private")).toBe(true);
    expect(needsGoPublicConfirm("public")).toBe(false);
  });
});

describe("the dialog's copy", () => {
  const NAME = "incident-war-room";
  const desc = goPublicDescription(NAME);

  it("names the channel and asks before widening", () => {
    expect(goPublicTitle(NAME)).toBe('Make "incident-war-room" public?');
  });

  it("states the audience is EVERY workspace member, not just those invited", () => {
    expect(desc).toMatch(/Every member of this workspace/);
    expect(desc).toMatch(/without an invite/);
  });

  it("states that the EXISTING history goes with it, not just future messages", () => {
    expect(desc).toMatch(/the whole channel/);
    expect(desc).toMatch(/every message and thread already in it/);
  });

  it("does not imply the exposure is undoable", () => {
    expect(desc).toMatch(/won't undo what people have read/);
  });

  it("the dialog renders that copy — the builders are not dead code", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/features/channels/components/go-public-dialog.tsx"),
      "utf8"
    );
    expect(src).toMatch(/title=\{goPublicTitle\(displayName\)\}/);
    expect(src).toMatch(/description=\{goPublicDescription\(displayName\)\}/);
  });
});

describe("the host wires the toggle THROUGH the confirm", () => {
  const view = readFileSync(
    path.join(process.cwd(), "src/features/channels/components/channels-view-core.tsx"),
    "utf8"
  );

  it("never hands the raw lifecycle write to the menu's visibility toggle", () => {
    expect(view).not.toMatch(/onToggleVisibility=\{lifecycle\.toggleVisibility\}/);
    expect(view).toMatch(/onToggleVisibility=\{handleToggleVisibility\}/);
  });

  it("branches on `needsGoPublicConfirm` and renders the dialog", () => {
    expect(view).toMatch(/needsGoPublicConfirm\(selected\.visibility\)/);
    expect(view).toMatch(/<GoPublicDialog/);
  });
});
