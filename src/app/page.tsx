"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
// TEMP-COMMUNITY: hidden until community launches — restore by uncommenting blocks marked TEMP-COMMUNITY
// import { CommunityCard } from "@/components/community/community-card";
// import type { PublishedClusterSummary } from "@/lib/community/types";
import {
  Monitor,
  Settings,
  Paperclip,
  ArrowUp,
  ChevronDown,
  ArrowRight,
  Plus,
  Minus,
  Globe,
  Mic,
} from "lucide-react";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

/* ──────────────────────────────────────────────────────────────────── */
/*  Reusable prompt input (hero + final CTA)                          */
/* ──────────────────────────────────────────────────────────────────── */
const ROTATING_PROMPTS = [
  "Extract these X posts and convert them into one Claude Code skill...",
  "Build me an automation for LinkedIn lead gen...",
  "What Claude Code configs exist for deep research?",
  "Compose a marketing automation with Supabase...",
  "Find the best open source Github repos and create a digital brain...",
  "Search for MCP server setups...",
];

function useTypingAnimation() {
  const [display, setDisplay] = useState("");
  const [promptIdx, setPromptIdx] = useState(0);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const prompt = ROTATING_PROMPTS[promptIdx];
    let charIdx = 0;
    let deleting = false;

    function tick() {
      if (!deleting) {
        // Typing forward
        charIdx++;
        setDisplay(prompt.slice(0, charIdx));
        if (charIdx === prompt.length) {
          // Pause at full text
          timeout = setTimeout(() => {
            deleting = true;
            tick();
          }, 2000);
          return;
        }
        timeout = setTimeout(tick, 50 + Math.random() * 40);
      } else {
        // Deleting
        charIdx--;
        setDisplay(prompt.slice(0, charIdx));
        if (charIdx === 0) {
          // Move to next prompt
          timeout = setTimeout(() => {
            setPromptIdx((prev) => (prev + 1) % ROTATING_PROMPTS.length);
          }, 400);
          return;
        }
        timeout = setTimeout(tick, 25);
      }
    }

    tick();
    return () => clearTimeout(timeout);
  }, [promptIdx]);

  return display;
}

function handleLandingSend(message: string) {
  if (!message.trim()) return;
  localStorage.setItem("dopl-landing-message", message.trim());
  window.location.href = "/login?redirectTo=/canvas";
}

function PromptInput() {
  const [value, setValue] = useState("");
  const animatedPlaceholder = useTypingAnimation();
  const showPlaceholder = !value;
  const prevFullTextRef = useRef("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const {
    isListening,
    fullText,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    clearTranscript,
    error: voiceError,
  } = useSpeechRecognition();

  // Live-sync voice transcript into the textarea
  useEffect(() => {
    if (isListening && fullText !== prevFullTextRef.current) {
      prevFullTextRef.current = fullText;
      setValue(fullText);
    }
  }, [isListening, fullText]);

  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      stopListening();
      prevFullTextRef.current = "";
    } else {
      clearTranscript();
      prevFullTextRef.current = "";
      startListening();
    }
  }, [isListening, stopListening, clearTranscript, startListening]);

  function handleSend() {
    if (isListening) {
      stopListening();
      clearTranscript();
      prevFullTextRef.current = "";
    }
    handleLandingSend(value);
  }

  const canSend = value.trim().length > 0;

  return (
    <div className="w-full max-w-[740px] mx-auto">
      <div className="bg-[#141414] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="relative p-4 pb-2 min-h-[100px]">
          {showPlaceholder && (
            <div className="absolute inset-0 p-4 pb-2 pointer-events-none text-left">
              <span className="text-white/30 text-[15px]">
                {animatedPlaceholder}
                <span className="inline-block w-[2px] h-[16px] bg-white/40 ml-[1px] align-middle animate-pulse" />
              </span>
            </div>
          )}
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            className="w-full h-full min-h-[80px] bg-transparent text-white text-[15px] resize-none outline-none placeholder-transparent text-left"
          />
        </div>
        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-1">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-white/50 text-[13px] hover:text-white/70 transition-colors">
              <Monitor size={14} />
              <span>Full-stack</span>
              <ChevronDown size={12} />
            </button>
            <div className="w-px h-4 bg-white/10" />
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-white/50 text-[13px] hover:text-white/70 transition-colors">
              <Settings size={14} />
              <span>Build</span>
              <ChevronDown size={12} />
            </button>
            <button className="p-1.5 text-white/30 hover:text-white/50 transition-colors">
              <Paperclip size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Voice input */}
            {mounted && voiceSupported && (
              <button
                type="button"
                onClick={handleVoiceToggle}
                aria-label={isListening ? "Stop recording" : "Start voice input"}
                title={
                  voiceError
                    ? voiceError
                    : isListening
                    ? "Recording... click to stop"
                    : "Voice input"
                }
                className="flex items-center justify-center w-7 h-7 transition-colors"
              >
                {isListening ? (
                  <span className="flex items-end gap-[2px] h-4">
                    {[1, 2, 3, 4, 3].map((h, i) => (
                      <span
                        key={i}
                        className="w-[2px] rounded-full bg-red-400"
                        style={{
                          height: `${h * 3}px`,
                          animation: `voiceBar 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
                        }}
                      />
                    ))}
                  </span>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4 text-white/40 hover:text-white/70 transition-colors"
                  >
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                    <line x1="8" y1="22" x2="16" y2="22" />
                  </svg>
                )}
              </button>
            )}
            {/* Send — circular */}
            <button
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send"
              className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white/90 border border-white/[0.12] hover:border-white/[0.22] rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white/[0.04] hover:bg-white/[0.08]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M7 11V3" />
                <path d="M3 7l4-4 4 4" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {isListening && (
        <style>{`
          @keyframes voiceBar {
            from { transform: scaleY(0.5); }
            to   { transform: scaleY(1.5); }
          }
        `}</style>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/*  FAQ Accordion Item                                                 */
/* ──────────────────────────────────────────────────────────────────── */
function FaqItem({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/[0.08]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-6 text-left"
      >
        <span className="text-white text-[16px] font-medium">{question}</span>
        {open ? (
          <Minus size={18} className="text-white/40 shrink-0 ml-4" />
        ) : (
          <Plus size={18} className="text-white/40 shrink-0 ml-4" />
        )}
      </button>
      {open && (
        <div className="pb-6 text-white/50 text-[15px] leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Snowflake / asterisk decoration                                    */
/* ──────────────────────────────────────────────────────────────────── */
function SnowflakeGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden opacity-[0.06]">
      <div className="grid grid-cols-6 gap-16 p-8">
        {Array.from({ length: 48 }).map((_, i) => (
          <div key={i} className="text-white text-4xl text-center select-none">
            &#10052;
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Main Landing Page                                                  */
/* ──────────────────────────────────────────────────────────────────── */
export default function Home() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Early-supporter slot counter (shown in the hero badge).
  // Seed matches SEED_USED in /api/early-supporter/count so the badge shows
  // the real baseline immediately instead of flashing "0 / 100".
  const [earlySupporter, setEarlySupporter] = useState<{ used: number; total: number }>({
    used: 37,
    total: 100,
  });
  useEffect(() => {
    fetch("/api/early-supporter/count")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.used === "number") {
          setEarlySupporter({ used: data.used, total: data.total ?? 100 });
        }
      })
      .catch(() => {});
  }, []);

  // TEMP-COMMUNITY: hidden until community launches — restore by uncommenting blocks marked TEMP-COMMUNITY
  // // Fetch community showcase data
  // const [communityItems, setCommunityItems] = useState<PublishedClusterSummary[]>([]);
  // useEffect(() => {
  //   fetch("/api/community?limit=8&sort=popular")
  //     .then((r) => (r.ok ? r.json() : null))
  //     .then((data) => {
  //       if (data?.items?.length) setCommunityItems(data.items);
  //     })
  //     .catch(() => {});
  // }, []);
  //
  // // Fallback placeholder data when no community posts exist yet
  // const showcaseEntries = [
  //   { title: "Claude Code Deep Research Agent", author: "open source" },
  //   { title: "n8n AI Marketing Automation", author: "community" },
  //   { title: "Supabase + Stripe SaaS Starter", author: "open source" },
  //   { title: "Multi-Agent Orchestration with MCP", author: "community" },
  //   { title: "AI Cold Outreach Pipeline", author: "open source" },
  //   { title: "Automated Content Repurposer", author: "community" },
  //   { title: "RAG Pipeline with Pinecone", author: "open source" },
  //   { title: "Claude Code Skill: Git Workflow", author: "community" },
  // ];

  const faqItems = [
    {
      question: "What is Dopl?",
      answer:
        "Dopl is an intelligence layer that ingests, indexes, and composes the most cutting-edge AI setups, automations, and configurations from across the internet. It makes this knowledge accessible to your AI agents via MCP, chat, or direct search.",
    },
    {
      question: "What can I ingest?",
      answer:
        "Anything \u2014 X posts, GitHub repos, blog posts, and more. Dopl automatically extracts structured knowledge, generates AI-ready instructions, and indexes everything for semantic search.",
    },
    {
      question: "How does it connect to my AI tools?",
      answer:
        "Dopl exposes an MCP server that connects directly to Claude Code, Claude Desktop, or any MCP-compatible agent. Once connected, your AI can search, retrieve, and compose solutions from the entire knowledge base without leaving your workflow.",
    },
    {
      question: "What makes this different from bookmarks or notes?",
      answer:
        "Bookmarks are dead links. Dopl extracts the actual knowledge, preserves executable code verbatim, generates AI-optimized instructions, and makes it all semantically searchable. It\u2019s a living knowledge base, not a link dump.",
    },
    {
      question: "Can I use it with tools other than Claude?",
      answer:
        "Yes. While MCP integration is optimized for Claude, Dopl\u2019s API and knowledge base work with any AI tool. The search, ingestion, and composition features are model-agnostic.",
    },
    {
      question: "Is the knowledge base open?",
      answer:
        "The core knowledge base is shared and community-maintained. You can also ingest private sources that only you can access. Think of it as a public library with a private shelf.",
    },
  ];

  return (
    <div
      className="min-h-screen bg-black text-white overflow-x-hidden relative z-[5]"
      style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }}
    >
      {/* ──── Navbar ──── */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-4 sm:px-8 py-3">
        <div
          className={`mx-auto flex items-center justify-between rounded-full px-5 py-2.5 transition-all duration-700 ease-in-out ${
            scrolled
              ? "max-w-[1200px] bg-black/40 backdrop-blur-xl border border-white/[0.08] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
              : "max-w-[1600px] bg-transparent border border-transparent"
          }`}
        >
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/favicons/favicon-32x32.png"
                alt="Dopl"
                width={34}
                height={34}
                className="rounded-lg border-[3px] border-black"
              />
              <span
                className="text-white text-[22px]"
                style={{
                  fontFamily: "var(--font-playfair), 'Playfair Display', Georgia, serif",
                  fontStyle: "italic",
                }}
              >
                Dopl
              </span>
            </Link>
            <div className="hidden md:flex items-center gap-6">
              <Link
                href="/docs"
                className="text-white/60 text-[13px] hover:text-white transition-colors"
              >
                Docs
              </Link>
              <Link
                href="/community"
                className="text-white/60 text-[13px] hover:text-white transition-colors"
              >
                Community
              </Link>
              <Link
                href="/pricing"
                className="text-white/60 text-[13px] hover:text-white transition-colors"
              >
                Pricing
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-white/60 text-[13px] hover:text-white transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              className="bg-white/[0.08] border border-white/[0.12] text-white text-[13px] px-4 py-1.5 rounded-full hover:bg-white/[0.12] transition-colors"
            >
              Sign up
            </Link>
          </div>
        </div>
      </nav>

      {/* ──── Hero Section ──── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-4">
        {/* Background image */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/img/background_image.png')" }}
        />
        {/* Dark overlay for text readability */}
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative z-10 text-center max-w-4xl mx-auto pt-24">
          {/* Pill */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/[0.12] bg-white/[0.04] mb-8">
            <span className="text-white/70 text-[13px] font-mono tracking-wide">
              Introducing Dopl
            </span>
            <ArrowRight size={14} className="text-white/50" />
          </div>

          {/* Main heading */}
          <h1 className="mb-6 font-serif font-normal text-[clamp(48px,6vw,60px)] leading-[0.9] tracking-tighter text-white">
            Frontier AI,
            <br />
            <span className="italic">in one unified layer.</span>
          </h1>

          {/* Subtext */}
          <p className="text-white/60 text-[18px] mb-12 tracking-wide font-mono">
            Equip your agent with supercharged capabilities, connected seamlessly.
          </p>

          {/* Prompt Input */}
          <PromptInput />

          {/* MCP badge — temporarily replaced by the early-supporter promo. Restore later by uncommenting. */}
          {/*
          <div className="mt-8 inline-flex items-center gap-3 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08]">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white text-[14px]">
              &#9679;
            </div>
            <div className="text-left">
              <div className="text-white/40 text-[10px] font-semibold uppercase tracking-wider">
                MCP Native
              </div>
              <div className="text-white font-semibold text-[14px]">
                Connect in seconds
              </div>
            </div>
          </div>
          */}

          {/* Early supporter promo */}
          <div className="mt-8 inline-flex items-center gap-3 px-4 py-2 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20">
            <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="text-left">
              <div className="text-emerald-400/80 text-[10px] font-semibold uppercase tracking-wider">
                Limited offer
              </div>
              <div className="text-white font-semibold text-[14px]">
                First 100 users get free Pro usage
              </div>
            </div>
            <div className="ml-2 pl-3 border-l border-emerald-500/20">
              <div className="text-white text-[14px] font-mono tabular-nums">
                <span className="text-emerald-400 font-semibold">{earlySupporter.used}</span>
                <span className="text-white/40"> / {earlySupporter.total}</span>
              </div>
              <div className="text-white/40 text-[10px] uppercase tracking-wider">
                spots claimed
              </div>
            </div>
          </div>
        </div>

        {/* Fade to black at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black to-transparent z-10" />
      </section>

      {/* TEMP-COMMUNITY: hidden until community launches — restore by uncommenting blocks marked TEMP-COMMUNITY */}
      {/*
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-[clamp(28px,4vw,48px)] font-normal mb-4">
              Built by the community
            </h2>
            <p className="text-white/40 text-[16px] mb-6">
              Explore what others are building with Dopl
            </p>
            <Link
              href="/community"
              className="inline-flex items-center gap-2 text-white/60 text-[15px] hover:text-white transition-colors"
            >
              View all <ArrowRight size={16} />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {communityItems.length > 0
              ? communityItems.map((item) => (
                  <CommunityCard key={item.id} cluster={item} />
                ))
              : showcaseEntries.map((entry, i) => (
                  <div key={i} className="group cursor-pointer">
                    <div className="aspect-[16/10] bg-neutral-900 rounded-xl mb-3 border border-white/[0.06] overflow-hidden group-hover:border-white/[0.12] transition-colors" />
                    <h3 className="text-white text-[14px] font-medium mb-1.5">
                      {entry.title}
                    </h3>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-neutral-700" />
                      <span className="text-white/40 text-[13px]">
                        {entry.author}
                      </span>
                    </div>
                  </div>
                ))}
          </div>
        </div>
      </section>
      */}

      {/* ──── Features section (sticky left, scrolling right) ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            {/* Left — sticky heading with snowflake pattern */}
            <div className="relative lg:sticky lg:top-32 lg:self-start">
              <SnowflakeGrid />
              <h2 className="relative text-[clamp(30px,4.5vw,48px)] font-normal leading-tight">
                Your AI deserves
                <br />
                better
                <br />
                context.{" "}
                <span className="inline-block text-amber-500">
                  <svg width={28} height={28} viewBox="0 0 24 24" fill="currentColor">
                    <rect x={2} y={2} width={9} height={9} rx={1} />
                    <rect x={13} y={2} width={9} height={9} rx={1} />
                    <rect x={2} y={13} width={9} height={9} rx={1} />
                    <rect x={13} y={13} width={9} height={9} rx={1} />
                  </svg>
                </span>
              </h2>
            </div>

            {/* Right — feature blocks */}
            <div className="space-y-0">
              {[
                {
                  title: "Ingest from anywhere",
                  desc: "Paste an X post, a GitHub repo, a blog post. Dopl extracts structured, AI-ready knowledge automatically \u2014 no manual formatting.",
                },
                {
                  title: "Search, don\u2019t browse",
                  desc: "Semantic search across the entire knowledge base. Find proven setups by describing what you need in plain English. Results are ranked and synthesized.",
                },
                {
                  title: "Compose, don\u2019t copy",
                  desc: "Dopl doesn\u2019t just retrieve \u2014 it synthesizes new implementation plans by blending patterns from multiple sources. Novel solutions from proven parts.",
                },
                {
                  title: "Connect via MCP",
                  desc: "One connection and your Claude Code, Claude Desktop, or any MCP-compatible agent has the entire knowledge base at its disposal. No context-switching.",
                },
              ].map((feature, i) => (
                <div
                  key={i}
                  className="border-b border-white/10 py-12 md:py-16 px-0 md:px-0 first:pt-0"
                >
                  <h3 className="text-white text-2xl md:text-3xl font-normal mb-6">
                    {feature.title}
                  </h3>
                  <div className="flex gap-4 items-start">
                    <div className="mt-1 shrink-0">
                      <ArrowRight
                        size={16}
                        className="text-orange-500"
                      />
                    </div>
                    <p className="text-gray-600 dark:text-white/60 text-base md:text-lg leading-relaxed">
                      {feature.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ──── Connect via MCP ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto">
          {/* Sharp-cornered split panel — dark gray left, cropped desert image right */}
          <div className="relative overflow-hidden bg-[#1a1a1a] min-h-[500px] grid grid-cols-1 lg:grid-cols-2 border border-white/[0.08]">
            {/* Left — copy block */}
            <div className="p-12 lg:p-20 flex flex-col justify-center">
              <h2 className="text-white font-normal leading-[1.05] tracking-tight mb-6 text-[clamp(36px,4.5vw,56px)]">
                <em
                  className="italic"
                  style={{
                    fontFamily:
                      "var(--font-playfair), 'Playfair Display', Georgia, serif",
                  }}
                >
                  Lives
                </em>{" "}
                inside your AI
              </h2>
              <p className="text-white/60 text-[18px] leading-[1.55] mb-8 max-w-[480px]">
                Connect via MCP and the entire knowledge base becomes part of
                your agent&apos;s toolkit. Search, retrieve, and compose &mdash;
                without leaving your workflow.
              </p>
              <Link
                href="/canvas"
                className="inline-flex items-center gap-2 text-white text-[16px] font-medium hover:text-white/80 transition-colors w-fit"
              >
                Get connected
                <span className="text-amber-500 text-[18px] leading-none">
                  &#10148;
                </span>
              </Link>
            </div>

            {/* Right — cropped bottom-left of the landing background image.
                Using background-size: 200% + position bottom-left gives the
                "zoomed in on the dunes" framing from the reference. */}
            <div
              className="relative min-h-[400px] lg:min-h-full"
              style={{
                backgroundImage: "url('/img/background_image.png')",
                backgroundSize: "350% auto",
                backgroundPosition: "left bottom",
                backgroundRepeat: "no-repeat",
              }}
              aria-hidden
            />
          </div>
        </div>
      </section>

      {/* ──── Testimonial ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-12 items-center">
          <div>
            <p className="text-white text-[clamp(24px,3vw,36px)] font-normal leading-snug mb-8">
              &ldquo;I used to spend hours searching for the right Claude config
              or n8n workflow. Now I just ask my agent and Dopl finds it
              instantly.&rdquo;
            </p>
            <div className="flex items-center gap-4">
              <div className="w-10 h-[2px] bg-white/20" />
              <div>
                <div className="text-white font-semibold text-[15px]">
                  Early Adopter
                </div>
                <div className="text-white/40 text-[13px]">AI Engineer</div>
              </div>
            </div>
            <div className="flex gap-2 mt-8">
              <div className="w-2 h-2 rounded-full bg-white/60" />
              <div className="w-2 h-2 rounded-full bg-white/20" />
              <div className="w-2 h-2 rounded-full bg-white/20" />
            </div>
          </div>
          <div className="w-[200px] h-[250px] bg-neutral-800 rounded-xl hidden lg:block" />
        </div>
      </section>

      {/* ──── Ingest anything ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left — ingestion mockup */}
          <div className="relative rounded-3xl overflow-hidden min-h-[450px]">
            <div className="absolute inset-0 bg-gradient-to-br from-[#5a3520] via-[#3d1f0e] to-[#1a0f08]" />
            <div className="absolute inset-6 lg:inset-8 bg-[#0a0a0a] rounded-xl border border-white/[0.08] overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/[0.06]">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                <div className="w-3 h-3 rounded-full bg-[#28c840]" />
                <span className="ml-4 text-white/30 text-[11px]">Dopl</span>
              </div>
              <div className="p-4 space-y-3">
                <div className="text-white/30 text-[10px] uppercase tracking-wider">
                  Ingestion Pipeline
                </div>
                <div className="bg-white/[0.04] rounded-lg px-3 py-2 border border-white/[0.06]">
                  <span className="text-white/50 text-[12px]">https://x.com/user/status/18372...</span>
                </div>
                <div className="space-y-2 mt-4">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-500/20 flex items-center justify-center">
                      <svg width={8} height={8} viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2 2 4-4" stroke="#4ade80" strokeWidth={1.5} />
                      </svg>
                    </div>
                    <span className="text-white/60 text-[12px]">Content extracted</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-500/20 flex items-center justify-center">
                      <svg width={8} height={8} viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2 2 4-4" stroke="#4ade80" strokeWidth={1.5} />
                      </svg>
                    </div>
                    <span className="text-white/60 text-[12px]">README generated</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-500/20 flex items-center justify-center">
                      <svg width={8} height={8} viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2 2 4-4" stroke="#4ade80" strokeWidth={1.5} />
                      </svg>
                    </div>
                    <span className="text-white/60 text-[12px]">agents.md created</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-amber-500/20 animate-pulse flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-amber-500/60" />
                    </div>
                    <span className="text-white/40 text-[12px]">Indexing for search...</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right — text */}
          <div>
            <h2 className="text-[clamp(28px,3.5vw,40px)] font-normal mb-4">
              <em className="font-serif italic">Ingest</em> anything.
              <br />
              Instantly indexed.
            </h2>
            <p className="text-white/50 text-[16px] leading-relaxed mb-6 max-w-md">
              Paste a link from X, GitHub, or any blog. Dopl extracts
              the knowledge, generates AI-ready instructions, and makes it
              searchable in seconds.
            </p>
            <Link
              href="/canvas"
              className="inline-flex items-center gap-2 text-white/70 text-[15px] hover:text-white transition-colors"
            >
              Try ingesting <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ──── From chaos to clarity ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto bg-[#0a0a0a] rounded-3xl p-12 lg:p-16 border border-white/[0.06]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            <div>
              <h2 className="text-[clamp(28px,3.5vw,40px)] font-normal mb-4">
                <em className="font-serif italic">From scattered links</em>{" "}
                to organized intelligence
              </h2>
              <p className="text-white/40 text-[16px] leading-relaxed mb-10 max-w-md">
                Stop losing the best AI setups to browser tabs and bookmarks.
                Ingest, organize into clusters, and let the brain synthesize
                what matters.
              </p>

              <div className="space-y-8">
                {[
                  {
                    num: "1",
                    title: "Ingest your sources",
                    desc: "Paste any link \u2014 X posts, GitHub repos, blogs. Dopl extracts and structures the knowledge automatically.",
                  },
                  {
                    num: "2",
                    title: "Organize into clusters",
                    desc: "Group related setups on the infinite canvas. Each cluster gets its own synthesized brain \u2014 evolving institutional knowledge.",
                  },
                  {
                    num: "3",
                    title: "Let your AI use it",
                    desc: "Connect via MCP or export as Claude Code skills. Your agent now has context it never had before.",
                  },
                ].map((step) => (
                  <div key={step.num} className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center text-[14px] font-semibold shrink-0">
                      {step.num}
                    </div>
                    <div>
                      <h3 className="text-white font-semibold text-[15px] mb-1">
                        {step.title}
                      </h3>
                      <p className="text-white/40 text-[14px] leading-relaxed">
                        {step.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — canvas wireframe mockup */}
            <div className="flex items-center justify-center relative">
              <div className="w-full max-w-[400px] bg-[#111] rounded-xl border border-white/[0.08] p-4">
                <div className="flex items-center gap-1.5 mb-4">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                  <span className="ml-3 text-white/20 text-[10px]">
                    Canvas
                  </span>
                </div>
                {/* Mini panel mockups */}
                <div className="relative h-[280px]">
                  {/* Panel 1 */}
                  <div className="absolute top-0 left-0 w-[160px] bg-[#0a0a0a] rounded-lg border border-white/[0.08] p-3">
                    <div className="h-2 bg-white/[0.08] rounded w-3/4 mb-2" />
                    <div className="h-2 bg-white/[0.04] rounded w-full mb-1" />
                    <div className="h-2 bg-white/[0.04] rounded w-2/3" />
                    <div className="flex items-center gap-1 mt-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      <span className="text-[8px] text-white/30">Entry</span>
                    </div>
                  </div>
                  {/* Panel 2 */}
                  <div className="absolute top-4 right-0 w-[160px] bg-[#0a0a0a] rounded-lg border border-white/[0.08] p-3">
                    <div className="h-2 bg-white/[0.08] rounded w-1/2 mb-2" />
                    <div className="h-2 bg-white/[0.04] rounded w-full mb-1" />
                    <div className="h-2 bg-white/[0.04] rounded w-3/4" />
                    <div className="flex items-center gap-1 mt-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      <span className="text-[8px] text-white/30">Chat</span>
                    </div>
                  </div>
                  {/* Cluster outline */}
                  <div className="absolute bottom-0 left-2 right-2 h-[120px] border border-dashed border-amber-500/30 rounded-xl flex items-center justify-center">
                    <div className="bg-[#0a0a0a] rounded-lg border border-white/[0.08] p-3 w-[200px]">
                      <div className="text-[9px] text-amber-400/60 uppercase tracking-wider mb-1">Cluster Brain</div>
                      <div className="h-2 bg-white/[0.04] rounded w-full mb-1" />
                      <div className="h-2 bg-white/[0.04] rounded w-4/5" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ──── FAQ ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[640px] mx-auto">
          <h2 className="text-[clamp(28px,4vw,48px)] font-normal text-center mb-12">
            <em className="font-serif italic">Questions?</em>{" "}
            We&apos;ve got answers.
          </h2>
          <div>
            {faqItems.map((item, i) => (
              <FaqItem key={i} question={item.question} answer={item.answer} />
            ))}
          </div>
        </div>
      </section>

      {/* ──── Final CTA ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[740px] mx-auto text-center">
          <h2 className="text-[clamp(32px,5vw,56px)] font-normal mb-4">
            Start exploring
          </h2>
          <p className="text-white/40 text-[16px] mb-10">
            The cutting-edge AI knowledge base. Ingest anything. Search
            everything. Connect seamlessly.
          </p>
          <PromptInput />
        </div>
      </section>

      {/* ──── Footer ──── */}
      <footer className="border-t border-white/[0.06] py-16 px-4">
        <div className="max-w-[1200px] mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1fr_1fr] gap-10 mb-16">
            {/* Logo + language */}
            <div>
              <div className="flex items-center gap-2 mb-6">
                <Image
                  src="/favicons/favicon-32x32.png"
                  alt="Dopl"
                  width={20}
                  height={20}
                  className="rounded-md"
                />
                <span
                  className="text-white text-[16px]"
                  style={{
                    fontFamily: "var(--font-playfair), 'Playfair Display', Georgia, serif",
                    fontStyle: "italic",
                  }}
                >
                  Dopl
                </span>
              </div>
              <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/60 text-[13px]">
                <Globe size={14} />
                English
                <ChevronDown size={12} />
              </button>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-white font-semibold text-[14px] mb-4">
                Product
              </h4>
              <ul className="space-y-3">
                {[
                  { label: "Canvas", href: "/canvas" },
                  { label: "Browse", href: "/entries" },
                  { label: "Builder", href: "/build" },
                  { label: "Pricing", href: "/pricing" },
                  { label: "Settings", href: "/settings" },
                ].map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className="text-white/40 text-[14px] hover:text-white/70 transition-colors"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Features */}
            <div>
              <h4 className="text-white font-semibold text-[14px] mb-4">
                Features
              </h4>
              <ul className="space-y-3">
                {[
                  "Ingestion Engine",
                  "Semantic Search",
                  "Solution Composer",
                  "MCP Server",
                  "Cluster Brains",
                  "Skill Export",
                  "Infinite Canvas",
                ].map((item) => (
                  <li key={item}>
                    <Link
                      href="#"
                      className="text-white/40 text-[14px] hover:text-white/70 transition-colors"
                    >
                      {item}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-white font-semibold text-[14px] mb-4">
                Company
              </h4>
              <ul className="space-y-3">
                {[
                  { label: "Docs", href: "/docs" },
                  { label: "Contact", href: "#" },
                  { label: "Discord", href: "#" },
                ].map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className="text-white/40 text-[14px] hover:text-white/70 transition-colors"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-white font-semibold text-[14px] mb-4">
                Legal
              </h4>
              <ul className="space-y-3">
                {[
                  { label: "Privacy", href: "/privacy" },
                  { label: "Terms of Service", href: "/terms" },
                ].map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className="text-white/40 text-[14px] hover:text-white/70 transition-colors"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="flex items-center justify-between border-t border-white/[0.06] pt-6">
            <span className="text-white/30 text-[13px]">
              &copy; 2026 Dopl Intelligence. All rights reserved.
            </span>
            <div className="flex items-center gap-4">
              {/* Theme toggle */}
              <button className="text-white/30 hover:text-white/60 transition-colors">
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx={12} cy={12} r={5} />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              </button>
              <div className="w-px h-4 bg-white/10" />
              {/* Social icons */}
              {["X", "FB", "IG", "LI", "DC", "YT", "RD"].map((icon) => (
                <Link
                  key={icon}
                  href="#"
                  className="text-white/30 hover:text-white/60 transition-colors text-[12px] font-mono"
                >
                  {icon === "X" ? (
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-white/10" />
                  )}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
