import { useEffect, useState } from "react";
import { PAGE_ACTION_BTN } from "./panel-buttons";
import { SettingsModal, type SettingsSection } from "#/components/settings-modal";
import type { BootPayload } from "#/pages/boot/use-boot-state";

/**
 * THE SETTINGS ENTRY /home NEVER HAD (Samuel, live review 2026-08-30) — the
 * operator's own profile control, opening the SAME modal the workspace sidebar's
 * gear opens.
 *
 * ⚠ WHY /home HAD NONE. Settings is reached from the app sidebar, and this page
 * has no sidebar: it is the ACCOUNT surface, one panel wide, whose left column
 * is the channel list. So the page has to carry its own entry.
 *
 * ⚠ **IT IS A BLACK PILL READING "Profile" SINCE 2026-09-15 (Samuel, live
 * review: "turn the profile button to be black, and have it say Profile").** It
 * sat at the top of the LIST COLUMN from 2026-08-30 — a bare avatar, then a
 * full-width "{first name}'s Home" bar — then spent one revision as a white
 * circle in the action group. That was the same day: the circle and this pill are
 * two halves of one live review, so do not read the circle's absence as a rule
 * about round controls. What has not changed through any of it: one control, one
 * modal, and this page's only way into settings.
 *
 * ⚠ ITS OWN FILE, not thirty lines inside `index.tsx`. That page is at the
 * 500-line cap (INVARIANTS §1) and this is one coherent responsibility: a
 * control, and a modal that only this control opens. The page hands it the boot
 * payload it already has and knows nothing else about it. ⚠ **AND IT READS NO
 * PROFILE SINCE 2026-09-15** — the face became a glyph, so `/api/user/profile`
 * had no renderer left here; if an avatar ever returns, the read comes back
 * UNGATED on `open`, which is the rule that kept the control from popping into
 * existence after a round trip.
 */
/**
 * OPEN /home's SETTINGS MODAL FROM ANYWHERE ON THE PAGE — the credit bar's
 * "Upgrade" (`overview-sections.tsx › CreditCapacityBar`) is the first caller.
 *
 * 🔒 **A ONE-SLOT REGISTRY RATHER THAN A LIFTED CALLBACK, AND THE REASON IS A
 * MEASUREMENT (2026-09-08).** The obvious shape is to hoist `open`/`section`
 * into `pages/home/index.tsx` and drill an `openSettings(section)` prop down
 * through `HomeOverviewPanels` → `UsageCard` → `CreditsBar` → the bar. That
 * page measured **499 lines** against the 500-line cap (INVARIANTS §1,
 * `eslint.config.mjs › max-lines`) on the day this landed — `wc -l` it before
 * repeating the claim — so the hoist could not be made without first splitting
 * an unrelated page, which is a bigger change than the feature. This keeps the
 * state exactly where it already lives and adds no prop to any component
 * between.
 *
 * ⚠ **ONE SLOT, AND THAT IS SOUND HERE BECAUSE /home MOUNTS ONE OF THESE.** The
 * control is rendered once, in the page header strip. A second mount would make
 * the last one to mount win; if that ever becomes possible this must become a
 * real context.
 * ⚠ **A NO-OP WHEN NOTHING IS MOUNTED**, deliberately: `HomeSettingsControl`
 * renders nothing for an account with no provisioned workspace (see below), and
 * a caller must not crash for want of a modal that does not exist.
 */
type SettingsOpener = (section: SettingsSection) => void;
let liveOpener: SettingsOpener | null = null;

export function openHomeSettings(section: SettingsSection): void {
  liveOpener?.(section);
}

export function HomeSettingsControl({
  identity,
  onWorkspaceChanged,
}: {
  identity: BootPayload;
  /** A rename or an icon change lands in the account RAIL, which is the page's
   *  `/api/workspaces` read — this control does not own it, so it says so. */
  onWorkspaceChanged: () => void;
}) {
  // Section state seeded, not defaulted on open: Escape-then-reopen must not
  // flash the wrong pane. Same reason `components/app-shell/app-shell.tsx`
  // holds it — this is that page's mechanism, reused rather than re-invented.
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("account");

  // ⚠ Registered in an effect, not at render: an opener that pointed at a
  // component React had not committed would set state on a tree that is not
  // there. Cleared on unmount so a stale closure cannot outlive the page.
  useEffect(() => {
    liveOpener = (next) => {
      setSection(next);
      setOpen(true);
    };
    return () => {
      liveOpener = null;
    };
  }, []);

  /**
   * ⚠ SETTINGS NEEDS A WORKSPACE AND /home IS NOT ONE. Three of the modal's four
   * sections are workspace-scoped, so the control binds to the caller's DEFAULT
   * workspace — the one `POST /api/boot` already answered with on this page's
   * own cache key, so this costs no extra request.
   *
   * ⚠ NULL ⇒ NO CONTROL, not a control that opens empty panes. `workspace` is
   * null only for an account with nothing provisioned (boot's own docblock), and
   * there is nothing to configure then.
   */
  if (!identity.workspace || !identity.segment) return null;

  return (
    <>
      {/**
       * ⚠ **THE SAME FACE "New channel" WEARS, DELIBERATELY (Samuel, 2026-09-15:
       * "turn the profile button to be black, and have it say Profile").** It is
       * `PAGE_ACTION_BTN` itself — not a copy of its class list — so a restyle of
       * the page action lands on both. ⚠ **THIS IS THE SECOND BLACK PILL ON THE
       * PAGE AND IT IS AN EXCEPTION SAMUEL ASKED FOR, NOT A PRECEDENT**: the
       * "one primary action" ruling (`home-header.tsx`, Samuel 2026-08-25) still
       * governs what may be ADDED here. A third would make all three look like
       * none.
       *
       * ⚠ **ONE WORD AND NOTHING ELSE (Samuel, 2026-09-15: "remove the profile
       * icon").** This control has been an `Avatar`, a "{Name}'s Home" bar, a
       * glyph-only circle and a glyph-plus-label pill, all inside three weeks, and
       * it is TEXT NOW. Do not put a face back in it on the reasoning that a
       * profile control should have one: an avatar beside a page action is an
       * identity BADGE, and it would flicker from an initial to a photo one round
       * trip after paint — which is why this file reads no profile at all.
       * ⚠ **AND THEREFORE NO `gap-1.5` AND NO `PAGE_ACTION_ICON`.** `PAGE_ACTION_BTN`
       * is worn BARE here; the gap and the 13px glyph belong to
       * `panel-buttons.tsx › CreateButton`, which is the glyph-plus-label pill and
       * is still the place to copy from if a glyph ever returns.
       *
       * ⚠ **THE ACCESSIBLE NAME IS "Profile" NOW, AND THAT IS THE POINT OF THE
       * CHANGE.** It was `aria-label="Settings"` over an iconic control with no
       * text; the control has a VISIBLE label now, and an `aria-label` that does
       * not contain it breaks voice control ("click Profile" would match nothing)
       * and reads one thing to a screen reader while showing another. So the label
       * is the text, `title` agrees with it, and `index.test.tsx` /
       * `relationship-list.test.tsx` find it by "Profile". ⚠ What it OPENS did not
       * change: the same `SettingsModal`, seeded at `account`.
       */}
      <button
        type="button"
        title="Profile"
        onClick={() => setOpen(true)}
        className={PAGE_ACTION_BTN}
      >
        Profile
      </button>
      <SettingsModal
        open={open}
        onOpenChange={setOpen}
        section={section}
        onSectionChange={setSection}
        workspaceSegment={identity.segment}
        workspaceId={identity.workspace.id}
        role={identity.role ?? "viewer"}
        onWorkspaceChanged={onWorkspaceChanged}
      />
    </>
  );
}

/**
 * `"{first name}'s Home"`, or `"Home"` when there is no name to use.
 *
 * 🔒 **NOTHING RENDERS THIS AS OF 2026-09-15, AND IT IS KEPT ON PURPOSE.** The
 * bar it labelled lived for two days (2026-09-13 → 2026-09-15) and Samuel
 * replaced it with the search field; `relationship-list.test.tsx` still imports
 * and pins the helper, so deleting it here is a test change as well as a code
 * change and that was not this session's call to make. **If /home never grows a
 * possessive label again, delete BOTH** — a helper alive only because its own
 * test imports it is dead code with a witness, not a used function.
 *
 * ⚠ **THE FIRST WORD, NOT THE WHOLE DISPLAY NAME**, which is the rule worth
 * keeping if it ever comes back: the bar was 290px minus a face and its padding,
 * and `"Alexandra Fernández-Mo…'s Home"` is worse than no possessive at all.
 *
 * ⚠ **"Home" ALONE IS THE HONEST FALLBACK, and it was a state that really
 * happened** — not only a nameless account, but every first paint, since
 * `/api/user/profile` was in flight then. A possessive built from an EMAIL was
 * the other option and is refused for the reason the channel row refuses it: an
 * address is not a name.
 *
 * ⚠ NO `'s` DOUBLING GUARD. A name ending in "s" still takes `'s` here
 * ("Chris's Home") — a style choice, not a bug.
 */
export function homeBarLabel(displayName: string | null): string {
  const first = (displayName ?? "").trim().split(/\s+/)[0];
  return first ? `${first}'s Home` : "Home";
}
