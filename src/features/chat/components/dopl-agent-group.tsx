"use client";

/**
 * Container that visually groups a sequence of agent steps under the
 * shared "Dopl agent" turn (provided by `DoplAgentHeader` higher up
 * in the message list). Provides the nested left-border indent that
 * makes consecutive tool calls read as one continuous turn.
 */
export function DoplAgentGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-l border-border-default pl-3 ml-[11px] flex flex-col">
      {children}
    </div>
  );
}
