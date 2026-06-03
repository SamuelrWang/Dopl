interface Props {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/** Consistent header + vertical stack for a settings pane. */
export function SectionShell({ title, subtitle, children }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        {subtitle && <p className="text-sm text-white/50 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
