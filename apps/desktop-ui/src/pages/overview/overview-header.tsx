/**
 * Page header: eyebrow over title over subline on the left, the action
 * baseline-aligned with the title on the right.
 *
 * ⚠ The title frames the WORKSPACE, not the caller. Boot answers with
 * `userId` and the workspace row — no display name — and a greeting is not
 * worth a second profile read, so the one name already in hand is used.
 */

/** Local-clock greeting. morning < 12 ≤ afternoon < 18 ≤ evening. */
export function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function OverviewHeader({
  workspaceName,
  onInviteMembers,
}: {
  workspaceName: string;
  onInviteMembers: () => void;
}) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <p className="text-label font-semibold uppercase tracking-wide text-text-muted">
          {greetingFor(new Date().getHours())}
        </p>
        <h1 className="mt-1.5 text-display font-semibold tracking-tight text-text-primary">
          Here is {workspaceName}
        </h1>
        <p className="mt-1 text-caption text-text-secondary">
          Today at a glance, and how the last 30 days have gone.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2 pt-5">
        {/* The "Analytics" button beside this one is DELETED, not disabled:
            there is no analytics surface for it to open. */}
        <button
          type="button"
          onClick={onInviteMembers}
          className="auth-btn-3d flex h-8 cursor-pointer items-center rounded-full px-4 text-small font-semibold text-white"
        >
          Invite members
        </button>
      </div>
    </header>
  );
}
