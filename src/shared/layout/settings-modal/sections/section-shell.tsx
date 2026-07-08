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
        <h2 className="text-title font-semibold tracking-tight text-text-primary">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-caption text-text-secondary">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}
