"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { INSTALL_COMMAND } from "./content";

/** The one-line install with the landing window's copy button (`.lp-connect-row`, `-copy`). */
export function InstallLine() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
    } catch {
      // Blocked (insecure origin, denied permission): never claim a copy that did not happen.
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 900);
  }

  return (
    <div className="lp-connect-row lp-dv-install">
      <code className="lp-connect-cmd">
        <span className="lp-connect-comment">$ </span>
        {INSTALL_COMMAND}
      </code>
      <button
        type="button"
        className="lp-connect-copy"
        data-copied={copied}
        aria-label={copied ? "Install command copied" : "Copy install command"}
        onClick={onCopy}
      >
        {copied && <span aria-live="polite">Copied</span>}
        {copied ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={1.8} aria-hidden />}
      </button>
    </div>
  );
}
