import { SettingsCard, SettingsPane, SettingsPanel } from "./settings-panel";

interface Props {
  title: string;
  /** The panel's one caption line. */
  subtitle?: string;
  children: React.ReactNode;
}

/** A one-panel settings pane: the heading over one white card (`./settings-panel.tsx`). */
export function SectionShell({ title, subtitle, children }: Props) {
  const id = `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <SettingsPane>
      <SettingsPanel id={id} label={title} caption={subtitle}>
        <SettingsCard>
          <div className="flex flex-col gap-3">{children}</div>
        </SettingsCard>
      </SettingsPanel>
    </SettingsPane>
  );
}
