export interface TocEntry {
  id: string;
  title: string;
  level: number;
}

export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-[22px] font-semibold text-white/95 mt-14 first:mt-0 mb-4 scroll-mt-24">
      {children}
    </h2>
  );
}

export function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-[17px] font-semibold text-white/90 mt-10 mb-3 scroll-mt-24">
      {children}
    </h3>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[14.5px] leading-[1.75] text-white/60 mb-4">{children}</p>;
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 text-[13px] bg-white/[0.06] border border-white/[0.08] rounded text-white/80 font-mono">
      {children}
    </code>
  );
}

export function CodeBlock({ children, title }: { children: string; title?: string }) {
  return (
    <div className="mb-5 rounded-lg overflow-hidden border border-white/[0.08]">
      {title && (
        <div className="px-4 py-2 bg-white/[0.03] border-b border-white/[0.06] font-mono text-[11px] text-white/40 uppercase tracking-wider">
          {title}
        </div>
      )}
      <pre className="p-4 bg-white/[0.02] overflow-x-auto">
        <code className="text-[13px] leading-relaxed text-white/75 font-mono">{children}</code>
      </pre>
    </div>
  );
}

export function Callout({ children, type = "info" }: { children: React.ReactNode; type?: "info" | "tip" }) {
  const border = type === "tip" ? "border-[color:var(--mint)]/30" : "border-white/10";
  const label = type === "tip" ? "Tip" : "Note";
  const labelColor = type === "tip" ? "text-[color:var(--mint)]" : "text-white/50";
  return (
    <div className={`mb-5 p-4 rounded-lg bg-white/[0.03] border ${border}`}>
      <span className={`font-mono text-[10px] uppercase tracking-widest ${labelColor} block mb-1.5`}>
        {label}
      </span>
      <div className="text-[14px] leading-[1.7] text-white/60">{children}</div>
    </div>
  );
}

export function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mb-5 overflow-x-auto rounded-lg border border-white/[0.08]">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-b border-white/[0.08] bg-white/[0.03]">
            {headers.map((h) => (
              <th key={h} className="text-left px-4 py-2.5 font-semibold text-white/70">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-white/[0.04] last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-white/55">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Section hero with optional illustration slot */
export function SectionHero({
  label,
  title,
  description,
  children,
}: {
  label: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-10 flex items-start gap-8">
      <div className="flex-1">
        <p className="font-mono text-[11px] uppercase tracking-widest text-white/30 mb-2">
          {label}
        </p>
        <h1 className="text-[28px] font-bold text-white/95 leading-tight mb-3">
          {title}
        </h1>
        <p className="text-[15px] text-white/50 leading-relaxed max-w-[520px]">
          {description}
        </p>
      </div>
      {children && <div className="shrink-0 hidden lg:block">{children}</div>}
    </div>
  );
}

/** Ordered list with consistent styling */
export function OL({ children }: { children: React.ReactNode }) {
  return (
    <ol className="list-decimal list-inside space-y-2 text-[14.5px] text-white/60 mb-5 ml-1">
      {children}
    </ol>
  );
}

/** Unordered list with consistent styling */
export function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc list-inside space-y-1.5 text-[14.5px] text-white/60 mb-5 ml-1">
      {children}
    </ul>
  );
}
