"use client";

/**
 * The KB settings modal's section frame — a heading and a stacked body.
 *
 * ⚠ **EXTRACTED FROM `base-settings-form.tsx` ON 2026-09-17, FOR ONE REASON:**
 * a section that can DECIDE NOT TO EXIST has to own its own heading. The
 * Channels section is rendered only in a HOME container (Samuel's ruling —
 * `shared/tenancy/channel-scope.ts`), and with the frame in the parent the
 * refusal showed as an empty "CHANNELS" heading with nothing under it. The
 * alternative — re-typing these three class strings in the child — is exactly
 * the hardcoded-recipe drift DESIGN-SYSTEM.md refuses.
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
