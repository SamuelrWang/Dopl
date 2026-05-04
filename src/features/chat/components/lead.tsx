"use client";

/**
 * Opening AI text rendered above a `<DoplAgentGroup>`. Slightly larger
 * weight than markdown body text so it reads as a one-line context line
 * before the agent steps.
 */
export function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[14px] leading-relaxed text-text-primary">{children}</p>
  );
}
