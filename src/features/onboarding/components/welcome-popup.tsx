"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, X } from "lucide-react";
import { DEFAULT_MCP_URL } from "../constants";
import { buildBootstrapPrompt } from "../bootstrap-prompt";

const WELCOME_KEY = "dopl:welcome";

/**
 * Founder's welcome — shown once, in the workspace, right after onboarding
 * completes. Onboarding sets the `dopl:welcome` flag before redirecting in.
 * The flag is cleared on DISMISS (not on read) so a remount / StrictMode
 * double-mount keeps the popup open instead of flashing it away.
 */
export function WelcomePopup() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [origin, setOrigin] = useState("https://www.usedopl.com");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
    let raf = 0;
    try {
      if (window.localStorage.getItem(WELCOME_KEY) === "1") {
        setOpen(true);
        // Mount at opacity 0, then flip next frame so it fades in.
        raf = requestAnimationFrame(() => setShown(true));
      }
    } catch {
      // storage unavailable — nothing to show
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  function dismiss() {
    setShown(false);
    try {
      window.localStorage.removeItem(WELCOME_KEY);
    } catch {
      // storage unavailable
    }
    setTimeout(() => setOpen(false), 220);
  }

  if (!open) return null;

  const prompt = buildBootstrapPrompt(
    origin ? `${origin}/api/mcp` : DEFAULT_MCP_URL
  );

  function copy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Portal to <body> so the popup escapes the AppShell root's z-30 stacking
  // context. Without this its z-50 is local to that context and the canvas
  // surface (portaled to <body> at z-31) paints over the card. `open` only
  // flips true inside a client effect, so document.body is always defined here.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto px-6 py-10"
      onClick={dismiss}
      style={{
        fontFamily: "var(--font-app), system-ui, sans-serif",
        backgroundColor: "rgba(0,0,0,0.5)",
        opacity: shown ? 1 : 0,
        transition: "opacity 220ms ease",
      }}
    >
      <div
        className="relative w-full max-w-lg rounded-[14px] border-[1.5px] border-[#d6dde5] bg-[#fbfcfd] p-8 shadow-[0_12px_40px_rgba(28,33,39,0.28)]"
        onClick={(e) => e.stopPropagation()}
        style={{
          opacity: shown ? 1 : 0,
          transform: shown
            ? "translateY(0) scale(1)"
            : "translateY(8px) scale(0.98)",
          transition: "opacity 220ms ease, transform 220ms ease",
        }}
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="absolute right-4 top-4 text-[#98a2ad] hover:text-[#232a31] transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-5 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/favicons/android-chrome-512x512.png"
            alt="Dopl"
            className="auth-logo-3d h-11 w-11 rounded-[8px]"
          />
          <h1 className="text-[24px] font-semibold leading-tight text-[#1e242b]">
            Welcome to Dopl!
          </h1>
        </div>

        <p className="text-[14.5px] leading-relaxed text-[#3a414a]">
          I first built Dopl as a personal tool to organize everything I needed
          my agent to know about me. After being asked for access by others, I
          productized Dopl into the workspace for teams using agents. I hope you
          find it as useful as we have!
        </p>

        <p className="mt-4 text-[14.5px] leading-relaxed text-[#3a414a]">
          To help jumpstart your workspace, here&rsquo;s a prompt I wrote for
          your agent:
        </p>

        <div className="relative mt-3">
          <div className="auth-field-3d h-[180px] overflow-y-auto rounded-[10px] px-3.5 py-3 pr-10">
            <span
              className="block text-[13px] leading-relaxed text-[#222] whitespace-pre-wrap break-words"
              style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
            >
              {prompt}
            </span>
          </div>
          <button
            type="button"
            onClick={copy}
            title="Copy"
            className="absolute right-2.5 top-2.5 text-[#98a2ad] hover:text-[#232a31] transition-colors cursor-pointer"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>

        <p className="mt-4 text-[14.5px] leading-relaxed text-[#3a414a]">
          Happy building!
        </p>
        <p className="mt-1 text-[14.5px] text-[#646d78]">— Sam</p>
      </div>
    </div>,
    document.body
  );
}
