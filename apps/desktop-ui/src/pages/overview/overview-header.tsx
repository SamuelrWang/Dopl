import { HEADER } from "./overview-data";

/**
 * Page header: eyebrow over title over subline on the left, the two actions
 * baseline-aligned with the title on the right.
 */
export function OverviewHeader() {
  return (
    <header className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <p className="text-label font-semibold uppercase tracking-wide text-text-muted">
          {HEADER.eyebrow}
        </p>
        <h1 className="mt-1.5 text-display font-semibold tracking-tight text-text-primary">
          {HEADER.title}
        </h1>
        <p className="mt-1 text-caption text-text-secondary">{HEADER.subline}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2 pt-5">
        <button
          type="button"
          className="btn-light flex h-8 cursor-pointer items-center rounded-full px-4 text-small font-medium text-text-primary"
        >
          Analytics
        </button>
        <button
          type="button"
          className="auth-btn-3d flex h-8 cursor-pointer items-center rounded-full px-4 text-small font-semibold text-white"
        >
          Invite members
        </button>
      </div>
    </header>
  );
}
