"use client";

/**
 * Container that visually groups a sequence of agent steps under a
 * "Dopl agent" header. Drives the gradient dot + nested left border
 * pattern from the original demo.
 *
 * `streaming` flips the dot's pulse so the user can tell when a turn is
 * still in flight versus finalised.
 */
export function DoplAgentGroup({
  children,
  streaming = false,
}: {
  children: React.ReactNode;
  streaming?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={
            "w-2 h-2 rounded-full bg-gradient-to-br from-violet-300 to-cyan-300 " +
            (streaming ? "animate-pulse" : "")
          }
        />
        <span className="text-[12px] font-medium text-text-primary">
          Dopl agent
        </span>
      </div>
      <div className="border-l border-white/[0.08] pl-3 ml-[3px] flex flex-col">
        {children}
      </div>
    </div>
  );
}
