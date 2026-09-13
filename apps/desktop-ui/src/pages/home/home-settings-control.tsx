import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { HOME_CARD_FACE } from "./channel-row-marks";
import { useApiQuery } from "#/hooks/use-api-query";
import { SettingsModal, type SettingsSection } from "#/components/settings-modal";
import type { BootPayload } from "#/pages/boot/use-boot-state";

/**
 * THE SETTINGS ENTRY /home NEVER HAD (Samuel, live review 2026-08-30) — the
 * operator's own face in the left column, opening the SAME modal the workspace
 * sidebar's gear opens.
 *
 * ⚠ WHY /home HAD NONE. Settings is reached from the app sidebar, and this page
 * has no sidebar: it is the ACCOUNT surface, one panel wide, whose left column
 * is the channel list. So the entry goes where a person's own identity already
 * belongs — the top of that column, above the rows, on the list's own `px-3`
 * inset so the face lines up with every avatar under it.
 *
 * ⚠ ITS OWN FILE, not thirty lines inside `index.tsx`. That page is at the
 * 500-line cap (INVARIANTS §1) and this is one coherent responsibility: a
 * profile read, a control, and a modal that only this control opens. The page
 * hands it the boot payload it already has and knows nothing else about it.
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

  // ⚠ THE FACE COMES FROM THE PROFILE, NOT FROM BOOT. `POST /api/boot` answers
  // `userId` and nothing renderable — no display name, no avatar — so an
  // `Avatar` built off boot alone is a permanent "?" initial. This route is the
  // caller's own row (`withUserAuth`, no workspace, so /home may ask it) and
  // returns exactly the fields `AvatarPerson` takes.
  //
  // ⚠ NOT GATED ON `open`: it paints the control itself, not the modal.
  const profile = useApiQuery<HomeProfile>(PROFILE_PATH);

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

  // The fallbacks are the point: this renders while the profile read is in
  // flight and on the day it fails, where `Avatar` degrades to its initials. A
  // face that is briefly an initial is fine; a control that pops into existence
  // after a network round trip is not.
  const me: AvatarPerson = {
    userId: identity.userId,
    email: profile.data?.email ?? null,
    displayName: profile.data?.display_name ?? null,
    avatarUrl: profile.data?.avatar_url ?? null,
  };

  return (
    <>
      {/**
       * ⚠ **THE CONTROL IS A BAR SINCE 2026-09-13, NOT A BARE FACE (Samuel, live
       * review: "I want to make like where the profile image is, like a longer
       * bar. Right now that empty space looks weird … Maybe like it can say
       * Name's Home?").** It was a 32px round avatar alone in a 290px cell, so
       * the column's top read as a gap with a face in the corner. The BAR is the
       * cell, and the face rides in it.
       *
       * ⚠ **SAME CARD FACE AS THE ROWS UNDER IT** (`HOME_CARD_FACE`, shared —
       * `channel-row-marks.tsx` carries why it is a constant), so the column reads
       * as one stack of cards rather than a header of a different kind.
       *
       * ⚠ **36px TALL, WHICH IS WHY THE HEADER ROW DID NOT MOVE.** That is the
       * height of every other control in the strip (the selector's `lg` pills, the
       * search pill, the black action) — the avatar keeps its own `sm` 32px inside
       * it, so nothing about the face changed and the strip's geometry is
       * untouched.
       *
       * ⚠ **BEHAVIOUR AND LABEL ARE UNCHANGED**: same `onClick`, same
       * `aria-label="Settings"`, same modal. The bar is this button's FACE, not a
       * new control beside it — `index.test.tsx` finds it by that label, and a
       * second clickable thing in this cell would give the column two settings
       * entries.
       */}
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={() => setOpen(true)}
        className={cn(
          HOME_CARD_FACE,
          "flex h-9 w-full cursor-pointer items-center gap-2 pl-0.5 pr-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2"
        )}
      >
        <Avatar person={me} size="sm" />
        {/* ⚠ MINIMAL COPY — a name and nothing else (the standing /home ruling:
            label + control, no explainer). `text-body font-medium` is the CHANNEL
            ROW TITLE's own type, so the bar and the rows read as one ladder. */}
        <span className="truncate text-body font-medium text-text-primary">
          {homeBarLabel(profile.data?.display_name ?? null)}
        </span>
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
 * ⚠ **THE FIRST WORD, NOT THE WHOLE DISPLAY NAME.** The bar is 290px minus the
 * face and its padding; a full name truncates on plenty of real accounts, and
 * `"Alexandra Fernández-Mo…'s Home"` is worse than no possessive at all.
 *
 * ⚠ **"Home" ALONE IS THE HONEST FALLBACK, and it is a state that really
 * happens** — not only a nameless account, but every first paint, since
 * `/api/user/profile` is in flight then (the same moment the avatar shows an
 * initial). A possessive built from an EMAIL was the other option and is refused
 * for the reason the channel row refuses it: an address is not a name.
 *
 * ⚠ NO `'s` DOUBLING GUARD. A name ending in "s" still takes `'s` here
 * ("Chris's Home") — that is a style choice, not a bug, and a name-dependent
 * apostrophe rule is not something this bar should own.
 */
export function homeBarLabel(displayName: string | null): string {
  const first = (displayName ?? "").trim().split(/\s+/)[0];
  return first ? `${first}'s Home` : "Home";
}

/** `GET /api/user/profile` — the three fields `AvatarPerson` needs off it. The
 *  route answers the row bare (no envelope); its other columns are the settings
 *  form's business, not this control's. */
const PROFILE_PATH = "/api/user/profile";
interface HomeProfile {
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
}
