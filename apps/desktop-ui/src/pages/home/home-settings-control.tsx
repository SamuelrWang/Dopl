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
 * review: "turn the profile button to be black, and have it say Profile").**
 * Through every restyle it has stayed ONE control, ONE modal, and this page's
 * only way into settings.
 *
 * ⚠ ITS OWN FILE, not thirty lines inside `index.tsx` — one coherent
 * responsibility, and that page is at the 500-line cap (INVARIANTS §1).
 * ⚠ **IT READS NO PROFILE (2026-09-15)** — the face is gone, so `/api/user/profile`
 * has no renderer here; if an avatar ever returns, the read comes back UNGATED on
 * `open`, or the control pops into existence a round trip after paint.
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
       * ⚠ **`PAGE_ACTION_BTN` ITSELF — the face "New channel" wears** (Samuel,
       * 2026-09-15), never a copy of its class list, so a restyle of the page
       * action lands on both. ⚠ **THE SECOND BLACK PILL ON THE PAGE IS AN
       * EXCEPTION SAMUEL ASKED FOR, NOT A PRECEDENT** — the "one primary action"
       * ruling (`home-header.tsx`, 2026-08-25) still governs what may be ADDED.
       * ⚠ **ONE WORD AND NOTHING ELSE** (*"remove the profile icon"*), so
       * `PAGE_ACTION_BTN` is worn BARE — no `gap-1.5`, no `PAGE_ACTION_ICON`;
       * those belong to `panel-buttons.tsx › CreateButton`. **Do not put a face
       * back in it**: an avatar beside a page action is an identity BADGE and it
       * would flicker from an initial to a photo a round trip after paint.
       * ⚠ **NO `aria-label`** — the control has a VISIBLE label, and a name that
       * does not contain it breaks voice control and reads one thing while showing
       * another. `title` agrees with the text.
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
