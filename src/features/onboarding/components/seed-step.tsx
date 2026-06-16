"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { DEFAULT_MCP_URL } from "../constants";
import { buildBootstrapPrompt } from "../bootstrap-prompt";

interface SeedStepProps {
  finishing: boolean;
  onFinish: () => void;
}

/**
 * Onboarding step 3 — seed the workspace. The connected agent does the
 * work: paste the bootstrap prompt and it interviews the user, writes the
 * first knowledge bases / skills, and renders each as it goes.
 */
export function SeedStep({ finishing, onFinish }: SeedStepProps) {
  const [origin, setOrigin] = useState("https://www.usedopl.com");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);
  const prompt = buildBootstrapPrompt(
    origin ? `${origin}/api/mcp` : DEFAULT_MCP_URL
  );

  const [copied, setCopied] = useState(false);
  function copy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-7">
      <div className="text-center">
        <h1 className="text-[28px] font-semibold leading-tight text-[#1e242b]">
          Seed your workspace
        </h1>
        <p className="mt-2 text-[15px] text-[#646d78] leading-relaxed">
          Paste this into your connected agent. It interviews you, writes
          your first knowledge bases and skills, and shows each one as it
          goes — no manual setup.
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#98a2ad]">
          Paste this prompt to your agent
        </p>
        <div className="flex items-start gap-2 rounded-[11px] border-[1.5px] border-[#d6dde5] bg-[#eef1f5] px-3.5 py-2.5">
          <code className="flex-1 font-mono text-[12px] text-[#3a414a] leading-relaxed whitespace-pre-wrap break-words">
            {prompt}
          </code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 mt-0.5 text-[#98a2ad] hover:text-[#232a31] transition-colors cursor-pointer"
            title="Copy"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      <button
        type="button"
        disabled={finishing}
        onClick={onFinish}
        className="w-full px-4 py-3 rounded-[11px] text-[15px] font-semibold
          bg-[#1c2127] text-white hover:bg-[#2c3640]
          transition-colors cursor-pointer
          disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Go to your workspace
      </button>
    </div>
  );
}
