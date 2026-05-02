export function PageTopBar({
  title,
  center,
  right,
}: {
  title: string;
  center?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.06] shrink-0">
      <div className="text-[13px] font-medium text-white shrink-0">{title}</div>
      {center}
      <div className="flex-1" />
      <div className="flex items-center gap-2 shrink-0">{right}</div>
    </div>
  );
}
