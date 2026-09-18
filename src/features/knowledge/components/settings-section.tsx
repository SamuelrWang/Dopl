"use client";

/**
 * The KB settings modal's section frame — a heading and a stacked body.
 *
 * Separate from `base-settings-form.tsx` (2026-09-17) because a section that can
 * decide not to exist has to own its own heading, or its refusal shows as an
 * empty heading over nothing.
 */
export function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-label font-medium text-text-muted uppercase tracking-wider mb-3">
        {title}
      </h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
