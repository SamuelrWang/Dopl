"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { EmbeddedCheckoutForm } from "@/components/billing/embedded-checkout";
import type { User } from "@supabase/supabase-js";

// ── Tier definitions ───────────────────────────────────────────────

type TierKey = "free" | "pro" | "power";
type Interval = "month" | "year";

interface Tier {
  key: TierKey;
  name: string;
  tagline: string;
  monthly: number; // dollars/month
  annualTotal?: number; // dollars/year when billed annually
  annualSavings?: number; // dollars saved
  features: string[];
  inheritFrom?: string; // "All features in <name>, plus:"
  highlight?: boolean;
}

const TIERS: Tier[] = [
  {
    key: "free",
    name: "Free",
    tagline: "Start here — all features, baseline credits.",
    monthly: 0,
    features: [
      "~30 chat messages / month",
      "~5 ingestions / month",
      "5 daily credit bonus",
      "All features included",
      "No credit card needed",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    tagline: "For regular users who want room to build and iterate.",
    monthly: 20,
    annualTotal: 200,
    annualSavings: 40,
    features: [
      "5× more usage (~150 chats / ~25 ingestions)",
      "Credit rollover",
      "Priority support",
    ],
    inheritFrom: "Free",
    highlight: true,
  },
  {
    key: "power",
    name: "Power",
    tagline: "For heavy users building serious workflows.",
    monthly: 50,
    annualTotal: 500,
    annualSavings: 100,
    features: [
      "20× more usage (~600 chats / ~100 ingestions)",
      "Larger daily bonus (10/day)",
      "Priority support",
    ],
    inheritFrom: "Pro",
  },
];

// ── Page ───────────────────────────────────────────────────────────

export default function PricingPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tier, setTier] = useState<TierKey>("free");
  const [authChecked, setAuthChecked] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutTier, setCheckoutTier] = useState<TierKey>("pro");
  const [interval, setInterval] = useState<Interval>("month");

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getUser().then(({ data }: { data: { user: User | null } }) => {
      setUser(data.user);
      setAuthChecked(true);
    });

    if (user) {
      fetch("/api/billing/status")
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "active" && data.tier) {
            setTier(data.tier as TierKey);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function handleUpgrade(targetTier: TierKey) {
    if (!user) {
      router.push("/login?redirect=/pricing");
      return;
    }
    setCheckoutTier(targetTier);
    setShowCheckout(true);
  }

  function handleGetStarted() {
    if (user) {
      router.push("/canvas");
    } else {
      router.push("/login?redirect=/canvas");
    }
  }

  if (showCheckout) {
    const active = TIERS.find((t) => t.key === checkoutTier)!;
    const price =
      interval === "year" && active.annualTotal
        ? `$${active.annualTotal}/year`
        : `$${active.monthly}/month`;
    return (
      <div className="min-h-screen flex flex-col items-center pt-24 px-4">
        <div className="w-full max-w-lg">
          <button
            onClick={() => setShowCheckout(false)}
            className="text-sm text-white/50 hover:text-white/80 transition-colors mb-4"
          >
            &larr; Back to pricing
          </button>
          <h1 className="text-2xl font-semibold text-white mb-2">
            Upgrade to {active.name}
          </h1>
          <p className="text-sm text-white/60 mb-6">
            {price}
            {interval === "year" && active.annualSavings
              ? ` · Save $${active.annualSavings}/yr`
              : ""}
          </p>
          <EmbeddedCheckoutForm
            tier={checkoutTier === "power" ? "power" : "pro"}
            interval={interval}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <section className="pt-28 pb-4 px-4">
        <div className="flex items-center justify-center gap-2.5 mb-3">
          <Image
            src="/favicons/android-chrome-192x192.png"
            alt="Dopl"
            width={28}
            height={28}
            className="rounded-md"
          />
          <h1 className="text-2xl font-semibold text-white tracking-tight">
            Pricing
          </h1>
        </div>
        <p className="text-sm text-white/55 text-center max-w-md mx-auto leading-relaxed">
          Start for free. Upgrade to get the capacity that matches your needs.
        </p>
      </section>

      {/* Tier cards */}
      <section className="flex-1 px-4 pt-8 pb-16">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          {TIERS.map((t) => {
            const isCurrent = tier === t.key && !!user;
            const isPaid = t.key !== "free";
            const isAnnual = interval === "year" && isPaid;
            const priceDollars =
              isAnnual && t.annualTotal
                ? (t.annualTotal / 12).toFixed(0)
                : t.monthly.toString();
            const priceSuffix = "per month";

            return (
              <div
                key={t.key}
                className={`flex flex-col rounded-xl p-6 ${
                  t.highlight
                    ? "border border-white/[0.15] bg-white/[0.04]"
                    : "border border-white/[0.08] bg-white/[0.02]"
                }`}
              >
                {/* Tier name */}
                <div className="text-xl font-semibold text-white mb-1.5">
                  {t.name}
                </div>

                {/* Tagline */}
                <p className="text-sm text-white/55 leading-relaxed mb-6 min-h-[40px]">
                  {t.tagline}
                </p>

                {/* Price */}
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold text-white">
                    ${priceDollars}
                  </span>
                  <span className="text-sm text-white/50">{priceSuffix}</span>
                </div>

                {/* Billing helper */}
                <p className="text-xs text-white/40 mb-5">
                  {!isPaid
                    ? "Forever free"
                    : isAnnual
                      ? `Billed $${t.annualTotal}/year`
                      : "Billed monthly"}
                </p>

                {/* Annual toggle (paid tiers only) */}
                {isPaid && (
                  <div className="mb-5 flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isAnnual}
                        onClick={() =>
                          setInterval(interval === "year" ? "month" : "year")
                        }
                        className={`relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer rounded-full transition-colors ${
                          isAnnual ? "bg-white/60" : "bg-white/[0.15]"
                        }`}
                      >
                        <span
                          className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform ${
                            isAnnual ? "translate-x-[16px]" : "translate-x-[2px]"
                          } translate-y-[2px]`}
                        />
                      </button>
                      <span className="text-sm text-white/80">Annual</span>
                    </div>
                    {isAnnual && t.annualSavings && (
                      <span className="text-xs text-emerald-400/90">
                        Save ${t.annualSavings}
                      </span>
                    )}
                  </div>
                )}

                {/* Upgrade button */}
                {isCurrent ? (
                  <Button variant="outline" size="lg" className="w-full mb-6" disabled>
                    Current plan
                  </Button>
                ) : isPaid ? (
                  <Button
                    size="lg"
                    variant={t.highlight ? "default" : "outline"}
                    className="w-full mb-6"
                    onClick={() => handleUpgrade(t.key)}
                    disabled={!authChecked}
                  >
                    Upgrade
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full mb-6"
                    onClick={handleGetStarted}
                  >
                    {user ? "Go to Canvas" : "Get started"}
                  </Button>
                )}

                {/* Feature list header */}
                {t.inheritFrom && (
                  <div className="text-xs text-white/40 mb-3">
                    All features in {t.inheritFrom}, plus:
                  </div>
                )}
                {!t.inheritFrom && (
                  <div className="text-xs text-white/40 mb-3">Free for everyone</div>
                )}

                {/* Features */}
                <ul className="space-y-2.5">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-white/75 leading-6">
                      <Check />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Footnote */}
        <div className="max-w-3xl mx-auto mt-12 text-center">
          <p className="text-xs text-white/40 leading-relaxed">
            All plans include every Dopl feature: canvas, clusters, knowledge base search, MCP server for your AI assistant, Chrome extension, and AI synthesis. Credits reset on a rolling 30-day cycle.
          </p>
        </div>
      </section>
    </div>
  );
}

// ── Icon ───────────────────────────────────────────────────────────

function Check() {
  return (
    <svg
      className="size-4 shrink-0 mt-0.5 text-white/40"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
    </svg>
  );
}
