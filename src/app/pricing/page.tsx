"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { GlassCard, GlassDivider, GlowText } from "@/components/design";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import type { User } from "@supabase/supabase-js";

// ── Feature definitions ────────────────────────────────────────────

interface Feature {
  label: string;
  free: boolean;
  pro: boolean;
  highlight?: boolean; // emphasize as a pro-exclusive
}

const FEATURES: Feature[] = [
  { label: "Unlimited search & browse", free: true, pro: true },
  { label: "Entry summaries & tags", free: true, pro: true },
  { label: "Canvas workspace", free: true, pro: true },
  { label: "1 cluster", free: true, pro: false },
  { label: "5 ingestions", free: true, pro: false },
  { label: "Full READMEs & setup instructions", free: false, pro: true, highlight: true },
  { label: "Unlimited ingestions", free: false, pro: true, highlight: true },
  { label: "Unlimited clusters", free: false, pro: true, highlight: true },
  { label: "AI-powered Build Solution", free: false, pro: true, highlight: true },
  { label: "AI synthesis in search results", free: false, pro: true, highlight: true },
  { label: "MCP server for Claude Code", free: false, pro: true, highlight: true },
];

const FREE_FEATURES = FEATURES.filter((f) => f.free);
const PRO_FEATURES = FEATURES.filter((f) => f.pro);

// ── Page ───────────────────────────────────────────────────────────

export default function PricingPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tier, setTier] = useState<"free" | "pro">("free");
  const [loading, setLoading] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getUser().then(({ data }: { data: { user: User | null } }) => {
      setUser(data.user);
      setAuthChecked(true);
    });

    // If logged in, fetch their tier
    if (user) {
      fetch("/api/billing/status")
        .then((r) => r.json())
        .then((data) => {
          if (data.tier === "pro" && data.status === "active") setTier("pro");
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function handleUpgrade() {
    if (!user) {
      router.push("/login?redirect=/pricing");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      setLoading(false);
    }
  }

  function handleGetStarted() {
    if (user) {
      router.push("/canvas");
    } else {
      router.push("/login?redirect=/canvas");
    }
  }

  const isPro = tier === "pro" && !!user;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero */}
      <section className="pt-24 pb-8 px-4 text-center">
        <div className="flex justify-center mb-6">
          <Image
            src="/favicons/android-chrome-192x192.png"
            alt="Dopl"
            width={56}
            height={56}
            className="rounded-xl drop-shadow-[0_0_24px_oklch(0.68_0.22_250/50%)]"
          />
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold text-text-primary mb-3 tracking-tight">
          Simple, transparent pricing
        </h1>
        <p className="text-base text-text-secondary max-w-md mx-auto leading-relaxed">
          Start free. Upgrade when you need full access to the knowledge base.
        </p>
      </section>

      {/* Tier cards */}
      <section className="flex-1 px-4 pb-16">
        <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Free tier */}
          <GlassCard variant="subtle" className="flex flex-col h-full">
            <div className="mb-6">
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                Free
              </span>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-text-primary">$0</span>
                <span className="text-sm text-text-muted">/forever</span>
              </div>
              <p className="mt-2 text-sm text-text-secondary">
                Explore the knowledge base and get started with your first setups.
              </p>
            </div>

            <GlassDivider />

            <ul className="flex-1 space-y-3 my-4">
              {FREE_FEATURES.map((f) => (
                <li key={f.label} className="flex items-start gap-2.5 text-sm">
                  <CheckIcon />
                  <span className="text-text-secondary">{f.label}</span>
                </li>
              ))}
            </ul>

            <Button
              variant="outline"
              size="lg"
              className="w-full mt-4"
              onClick={handleGetStarted}
            >
              {user ? "Go to Canvas" : "Get Started"}
            </Button>
          </GlassCard>

          {/* Pro tier */}
          <GlassCard variant="elevated" className="flex flex-col h-full relative">
            {/* Popular badge */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-[oklch(0.78_0.16_240/15%)] text-[oklch(0.78_0.16_240)] border border-[oklch(0.78_0.16_240/25%)] backdrop-blur-sm">
                <SparkleIcon />
                Most popular
              </span>
            </div>

            <div className="mb-6 mt-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                Pro
              </span>
              <div className="mt-2 flex items-baseline gap-1">
                <GlowText intensity="default">
                  <span className="text-4xl font-bold text-text-primary">$20</span>
                </GlowText>
                <span className="text-sm text-text-muted">/month</span>
              </div>
              <p className="mt-2 text-sm text-text-secondary">
                Full access to every setup, unlimited ingestions, and AI-powered tools.
              </p>
            </div>

            <GlassDivider />

            <ul className="flex-1 space-y-3 my-4">
              {PRO_FEATURES.map((f) => (
                <li key={f.label} className="flex items-start gap-2.5 text-sm">
                  {f.highlight ? <CheckIconAccent /> : <CheckIcon />}
                  <span
                    className={
                      f.highlight ? "text-text-primary" : "text-text-secondary"
                    }
                  >
                    {f.label}
                  </span>
                </li>
              ))}
            </ul>

            {isPro ? (
              <Button
                variant="outline"
                size="lg"
                className="w-full mt-4"
                disabled
              >
                <CheckIconSmall />
                Current Plan
              </Button>
            ) : (
              <Button
                size="lg"
                className="w-full mt-4"
                onClick={handleUpgrade}
                disabled={loading || !authChecked}
              >
                {loading
                  ? "Redirecting..."
                  : user
                  ? "Upgrade to Pro"
                  : "Get Started with Pro"}
              </Button>
            )}
          </GlassCard>
        </div>

        {/* Feature comparison table (desktop) */}
        <div className="max-w-3xl mx-auto mt-16 hidden md:block">
          <h2 className="text-lg font-medium text-text-primary text-center mb-8">
            Compare plans
          </h2>
          <GlassCard variant="subtle" className="!p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="text-left px-6 py-3 font-mono text-[10px] uppercase tracking-wider text-text-muted font-normal">
                    Feature
                  </th>
                  <th className="text-center px-6 py-3 font-mono text-[10px] uppercase tracking-wider text-text-muted font-normal w-28">
                    Free
                  </th>
                  <th className="text-center px-6 py-3 font-mono text-[10px] uppercase tracking-wider text-text-muted font-normal w-28">
                    Pro
                  </th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((f, i) => (
                  <tr
                    key={f.label}
                    className={
                      i < FEATURES.length - 1
                        ? "border-b border-white/[0.05]"
                        : ""
                    }
                  >
                    <td className="px-6 py-3 text-text-secondary">
                      {f.label}
                    </td>
                    <td className="text-center px-6 py-3">
                      {f.free ? (
                        <CheckIconSmall />
                      ) : (
                        <DashIcon />
                      )}
                    </td>
                    <td className="text-center px-6 py-3">
                      {f.pro ? (
                        <CheckIconAccentSmall />
                      ) : (
                        <DashIcon />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        </div>
      </section>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg
      className="size-4 shrink-0 mt-0.5 text-emerald-400"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
    </svg>
  );
}

function CheckIconAccent() {
  return (
    <svg
      className="size-4 shrink-0 mt-0.5 text-[oklch(0.78_0.16_240)]"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
    </svg>
  );
}

function CheckIconSmall() {
  return (
    <svg
      className="size-3.5 inline text-emerald-400"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
    </svg>
  );
}

function CheckIconAccentSmall() {
  return (
    <svg
      className="size-3.5 inline text-[oklch(0.78_0.16_240)]"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
    </svg>
  );
}

function DashIcon() {
  return (
    <span className="inline-block w-3.5 h-px bg-white/20 align-middle" />
  );
}

function SparkleIcon() {
  return (
    <svg
      className="size-3"
      viewBox="0 0 12 12"
      fill="currentColor"
    >
      <path d="M6 0L7.2 4.8L12 6L7.2 7.2L6 12L4.8 7.2L0 6L4.8 4.8L6 0Z" />
    </svg>
  );
}
