"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/shared/ui/button";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { EmbeddedCheckoutForm } from "@/features/billing/components/embedded-checkout";
import type { User } from "@supabase/supabase-js";

/**
 * Launch pricing: one tier. 24-hour free trial (no card) → $7.99/mo Pro.
 * Feature tiers and credits UI are gone.
 */

export default function PricingPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getUser().then(({ data }: { data: { user: User | null } }) => {
      setUser(data.user);
      setAuthChecked(true);
    });

    if (user) {
      fetch("/api/billing/status")
        .then(async (r) => {
          if (!r.ok) return null;
          return r.json();
        })
        .then((data) => {
          if (data && data.status === "active") {
            setIsPaid(true);
          }
        })
        .catch((err) => {
          console.error("[pricing] status fetch failed:", err);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function handleSubscribe() {
    if (!user) {
      router.push("/login?redirect=/pricing");
      return;
    }
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
            Subscribe to Dopl Pro
          </h1>
          <p className="text-sm text-white/60 mb-6">$7.99/month</p>
          <EmbeddedCheckoutForm />
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
          Try Dopl free for 24 hours. No credit card required.
        </p>
      </section>

      {/* Single Pro card */}
      <section className="flex-1 px-4 pt-10 pb-16">
        <div className="max-w-md mx-auto">
          <div className="flex flex-col h-full rounded-xl p-8 border border-white/[0.15] bg-white/[0.04]">
            <div className="text-xl font-semibold text-white mb-1.5">Pro</div>
            <p className="text-sm text-white/55 leading-relaxed mb-6">
              Everything Dopl can do, billed monthly.
            </p>

            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-4xl font-semibold text-white">$7.99</span>
              <span className="text-sm text-white/50">per month</span>
            </div>
            <p className="text-xs text-white/40 mb-6">
              Cancel anytime. 24-hour free trial on signup.
            </p>

            {isPaid ? (
              <Button variant="outline" size="lg" className="w-full mb-6" disabled>
                Current plan
              </Button>
            ) : user ? (
              <Button
                size="lg"
                className="w-full mb-6 cursor-pointer"
                onClick={handleSubscribe}
                disabled={!authChecked}
              >
                Subscribe
              </Button>
            ) : (
              <Button
                size="lg"
                className="w-full mb-6 cursor-pointer"
                onClick={handleGetStarted}
              >
                Start free trial
              </Button>
            )}

            <ul className="space-y-2.5">
              <li className="flex items-start gap-2.5 text-sm text-white/75 leading-6">
                <Check /> <span>Unlimited ingestion</span>
              </li>
              <li className="flex items-start gap-2.5 text-sm text-white/75 leading-6">
                <Check /> <span>MCP server access for your AI agent</span>
              </li>
              <li className="flex items-start gap-2.5 text-sm text-white/75 leading-6">
                <Check /> <span>Canvas, clusters, and skill sync</span>
              </li>
              <li className="flex items-start gap-2.5 text-sm text-white/75 leading-6">
                <Check /> <span>Cluster brain synthesis</span>
              </li>
              <li className="flex items-start gap-2.5 text-sm text-white/75 leading-6">
                <Check /> <span>Auto-update tracking for GitHub sources</span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

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
