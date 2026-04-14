"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
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

/* ──────────────────────────────────────────────────────────────────── */
/*  Reusable prompt input (hero + final CTA)                          */
/* ──────────────────────────────────────────────────────────────────── */
const ROTATING_PROMPTS = [
  "Paste a link to an X post...",
  "Describe your automation workflow...",
  "Connect my CRM to Slack...",
  "Build an AI agent that monitors...",
  "Set up a webhook pipeline...",
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

  return (
    <div className="w-full max-w-[740px] mx-auto">
      <div className="bg-[#141414] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="relative p-4 pb-2 min-h-[100px]">
          {showPlaceholder && (
            <div className="absolute inset-0 p-4 pb-2 pointer-events-none text-left">
              <span className="text-white/30 text-[15px] italic font-serif">
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
                handleLandingSend(value);
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
          <button
            onClick={() => handleLandingSend(value)}
            aria-label="Send"
            className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white/90 border border-white/[0.12] hover:border-white/[0.22] rounded-[3px] transition-colors bg-white/[0.04] hover:bg-white/[0.08]"
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
            >
              <path d="M7 11V3" />
              <path d="M3 7l4-4 4 4" />
            </svg>
          </button>
        </div>
      </div>
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

  const logos = [
    "GlydeXP",
    "RevivalBio",
    "Stacker",
    "NUROTEK",
    "ASIA",
    "Collab Creative",
    "AI Enthusiasts",
    "Feedoor",
  ];

  const showcaseProjects = [
    { title: "Cinematic Cyber Warfare Visualizer", author: "samuel rondot", forks: "2" },
    { title: "Earth Explorer Three D", author: "Baboo" },
    { title: "Three Dimensional Street Fighter", author: "Baboo" },
    { title: "Ai Virtual Employee Marketplace", author: "Baboo" },
    { title: "Hr Payroll Management Platform", author: "Baboo" },
    { title: "Dark Payments Dashboard Showcase", author: "samuel rondot" },
    { title: "Stunning Content Platform Alternative", author: "samuel rondot" },
    { title: "Ultra Luxury Yacht Experience", author: "samuel rondot" },
  ];

  const faqItems = [
    {
      question: "What is Capacity?",
      answer:
        "Capacity is an AI-powered platform that helps you build full-stack web and mobile applications through natural conversation. Just describe what you want to build, and our AI Co-founder will help you create it.",
    },
    {
      question: "Do I need coding experience?",
      answer:
        "No! Capacity is designed for everyone. Our AI handles all the technical complexity, so you can focus on describing your vision.",
    },
    {
      question: "What technologies does Capacity use?",
      answer:
        "We generate production-ready full-stack applications using React, TypeScript, and Tailwind CSS for web, and React Native for mobile. Each app gets an Express backend and SQLite database. You own all the code \u2014 no vendor lock-in.",
    },
    {
      question: "Can I export my code?",
      answer:
        "Yes! You own 100% of the code you create. Export to GitHub or download directly anytime.",
    },
    {
      question: "How does pricing work?",
      answer:
        "We use a credit-based system. You pay for what you use, and credits never expire. Start free and upgrade when ready.",
    },
    {
      question: "What's the difference between Vibe and Spec modes?",
      answer:
        "Vibe mode is for quick prototyping - just describe and build. Spec mode helps you plan first with detailed specifications before coding.",
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
                width={20}
                height={20}
                className="rounded-md"
              />
              <span
                className="text-white text-[18px]"
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
                href="/canvas"
                className="text-white/60 text-[14px] hover:text-white transition-colors"
              >
                Canvas
              </Link>
              <Link
                href="/entries"
                className="text-white/60 text-[14px] hover:text-white transition-colors"
              >
                Browse
              </Link>
              <Link
                href="/build"
                className="text-white/60 text-[14px] hover:text-white transition-colors"
              >
                Builder
              </Link>
              <Link
                href="/pricing"
                className="text-white/60 text-[14px] hover:text-white transition-colors"
              >
                Pricing
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="hidden sm:block text-white/60 text-[14px] hover:text-white transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              className="bg-white/[0.08] border border-white/[0.12] text-white text-[14px] px-4 py-1.5 rounded-full hover:bg-white/[0.12] transition-colors"
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
              Introducing Capacity 3.0
            </span>
            <ArrowRight size={14} className="text-white/50" />
          </div>

          {/* Main heading */}
          <h1 className="mb-6 font-serif font-normal text-[clamp(48px,6vw,60px)] leading-[0.9] tracking-tighter text-white">
            Cutting-edge AI
            <br />
            <span className="italic">ingested into one intelligence layer.</span>
          </h1>

          {/* Subtext */}
          <p className="text-white/60 text-[18px] mb-12 tracking-wide font-mono">
            Bridging the frontier with your AI. Seamlessly connected.
          </p>

          {/* Prompt Input */}
          <PromptInput />

          {/* Product Hunt Badge */}
          <div className="mt-8 inline-flex items-center gap-3 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08]">
            <div className="w-8 h-8 rounded-full bg-amber-600 flex items-center justify-center text-white font-bold text-[12px]">
              3
            </div>
            <div className="text-left">
              <div className="text-white/40 text-[10px] font-semibold uppercase tracking-wider">
                Product Hunt
              </div>
              <div className="text-white font-semibold text-[14px]">
                #3 Product of the Day
              </div>
            </div>
          </div>
        </div>

        {/* Fade to black at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black to-transparent z-10" />
      </section>

      {/* ──── Logo Bar ──── */}
      <section className="py-8 border-t border-white/[0.04] overflow-hidden">
        <div className="relative">
          <div className="flex logo-carousel whitespace-nowrap">
            {[...logos, ...logos].map((logo, i) => (
              <div
                key={i}
                className="flex-shrink-0 px-10 text-white/30 text-[18px] font-bold tracking-wider uppercase"
              >
                {logo}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──── Built by the community ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-[clamp(28px,4vw,48px)] font-normal mb-4">
              Built by the community
            </h2>
            <p className="text-white/40 text-[16px] mb-6">
              Explore what others are building with Capacity
            </p>
            <Link
              href="#"
              className="inline-flex items-center gap-2 text-white/60 text-[15px] hover:text-white transition-colors"
            >
              View all <ArrowRight size={16} />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {showcaseProjects.map((project, i) => (
              <div key={i} className="group cursor-pointer">
                {/* Image placeholder */}
                <div className="aspect-[16/10] bg-neutral-900 rounded-xl mb-3 border border-white/[0.06] overflow-hidden group-hover:border-white/[0.12] transition-colors" />
                <h3 className="text-white text-[14px] font-medium mb-1.5">
                  {project.title}
                </h3>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-neutral-700" />
                  <span className="text-white/40 text-[13px]">
                    {project.author}
                  </span>
                  {project.forks && (
                    <span className="text-white/30 text-[13px] ml-auto flex items-center gap-1">
                      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <circle cx={12} cy={18} r={3} />
                        <circle cx={6} cy={6} r={3} />
                        <circle cx={18} cy={6} r={3} />
                        <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
                        <path d="M12 12v3" />
                      </svg>
                      {project.forks}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──── Features section (sticky left, scrolling right) ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            {/* Left — sticky heading with snowflake pattern */}
            <div className="relative lg:sticky lg:top-32 lg:self-start">
              <SnowflakeGrid />
              <h2 className="relative text-[clamp(30px,4.5vw,48px)] font-normal leading-tight">
                Your app ideas
                <br />
                deserve to
                <br />
                exist.{" "}
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
                  title: "Build apps using words",
                  desc: "Just describe what you want in plain English. No coding skills needed. Watch your web or mobile app appear before your eyes.",
                },
                {
                  title: "Refine your vision, then build",
                  desc: "Not sure exactly what you need? We help you clarify your ideas step by step. Once your vision is clear, we turn it into reality.",
                },
                {
                  title: "Real backend, real database",
                  desc: "Every full-stack app gets its own Express server and SQLite database. No Supabase, no third-party glue. You own the code and the infra.",
                },
                {
                  title: "Go live in one click",
                  desc: "When you're happy with your app, publish it to the world instantly. No technical setup, no waiting. Just click and you're live.",
                },
              ].map((feature, i) => (
                <div
                  key={i}
                  className="py-12 border-t border-white/[0.06] first:border-t-0"
                >
                  <h3 className="text-white text-[22px] font-semibold mb-4">
                    {feature.title}
                  </h3>
                  <div className="flex gap-4">
                    <div className="mt-1 shrink-0">
                      <ArrowRight
                        size={18}
                        className="text-amber-500"
                      />
                    </div>
                    <p className="text-white/50 text-[16px] leading-relaxed">
                      {feature.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ──── Build apps. Your way. ──── */}
      <section className="py-12 px-4">
        <div className="max-w-[1200px] mx-auto text-center">
          <p className="text-white/20 text-[14px] tracking-wide mb-2">
            Build apps. Your way.
          </p>
        </div>
      </section>

      {/* ──── Why builders choose Capacity ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto text-center">
          <h2 className="text-white/30 text-[clamp(28px,4vw,48px)] font-normal mb-3">
            Why builders choose Capacity
          </h2>
          <p className="text-white/20 text-[16px] mb-16">
            Join thousands of makers shipping faster than ever before
          </p>

          {/* Stats + cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto mb-16">
            <div className="bg-[#111] rounded-2xl p-8 border border-white/[0.06] text-left">
              <div className="text-white/80 text-[14px] mb-2">+13k</div>
              <h3 className="text-white font-semibold text-[16px] mb-2">
                Never build alone
              </h3>
              <p className="text-white/40 text-[14px] leading-relaxed">
                Your AI Co-founder works alongside you 24/7. Get instant help,
                suggestions, and code whenever you need it.
              </p>
            </div>
            <div className="bg-[#111] rounded-2xl p-8 border border-white/[0.06] text-left">
              <h3 className="text-white font-semibold text-[16px] mb-2">
                Make beautiful apps
              </h3>
              <p className="text-white/40 text-[14px] leading-relaxed">
                Create stunning web and mobile apps without any design skills.
                Just describe your vision and watch it come to life.
              </p>
            </div>
            <div className="bg-[#111] rounded-2xl p-8 border border-white/[0.06] text-left">
              <h3 className="text-white font-semibold text-[16px] mb-2">
                No technical skills needed
              </h3>
              <p className="text-white/40 text-[14px] leading-relaxed">
                No coding, no design experience required. Just describe what you
                want in plain English and we handle the rest.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ──── Meet Your AI Co-Founder ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto">
          <div className="relative rounded-3xl overflow-hidden bg-[#1a0f08] min-h-[500px] grid grid-cols-1 lg:grid-cols-2">
            {/* Left text */}
            <div className="p-12 lg:p-16 flex flex-col justify-center">
              <h2 className="text-[clamp(28px,3.5vw,40px)] font-normal mb-4">
                <em className="font-serif italic">Meet</em>{" "}
                Your AI Co-Founder
              </h2>
              <p className="text-white/50 text-[16px] leading-relaxed mb-6 max-w-md">
                A human-AI partnership, orders of magnitude more effective than
                any developer alone.
              </p>
              <Link
                href="#"
                className="inline-flex items-center gap-2 text-white/70 text-[15px] hover:text-white transition-colors"
              >
                Learn about Co-Founder{" "}
                <span className="text-amber-500">&#10095;</span>
              </Link>
            </div>

            {/* Right — chat mockup over Mars background */}
            <div className="relative min-h-[400px]">
              {/* Mars landscape placeholder */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#8b5e3c] via-[#6b3a1f] to-[#3d1f0e]" />
              {/* Chat window */}
              <div className="absolute inset-8 lg:inset-12 bg-[#0a0a0a] rounded-2xl border border-white/[0.08] flex flex-col">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
                  <div className="w-8 h-8 rounded-full bg-neutral-700" />
                  <span className="text-white text-[14px] font-medium">
                    Co-founder
                  </span>
                </div>
                <div className="flex-1" />
                <div className="px-4 pb-4">
                  <div className="bg-[#1a1a1a] rounded-xl px-4 py-3 flex items-center gap-2">
                    <span className="text-white/40 text-[14px] flex-1">
                      What should I do next?
                    </span>
                    <button className="text-white/30">
                      <ArrowUp size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ──── Testimonial ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-12 items-center">
          <div>
            <p className="text-white text-[clamp(24px,3vw,36px)] font-normal leading-snug mb-8">
              &ldquo;I built a new project for Poppins from scratch thanks to
              capacity and I&apos;ve been kind of blown away&rdquo;
            </p>
            <div className="flex items-center gap-4">
              <div className="w-10 h-[2px] bg-white/20" />
              <div>
                <div className="text-white font-semibold text-[15px]">
                  Fran&ccedil;ois Vonthron
                </div>
                <div className="text-white/40 text-[13px]">CEO</div>
              </div>
            </div>
            {/* Pagination dots */}
            <div className="flex gap-2 mt-8">
              <div className="w-2 h-2 rounded-full bg-white/60" />
              <div className="w-2 h-2 rounded-full bg-white/20" />
              <div className="w-2 h-2 rounded-full bg-white/20" />
            </div>
          </div>
          <div className="w-[200px] h-[250px] bg-neutral-800 rounded-xl hidden lg:block" />
        </div>
      </section>

      {/* ──── Build faster and better with Specs ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left — app screenshot */}
          <div className="relative rounded-3xl overflow-hidden min-h-[450px]">
            {/* Mars background */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#5a3520] via-[#3d1f0e] to-[#1a0f08]" />
            {/* App window mockup */}
            <div className="absolute inset-6 lg:inset-8 bg-[#0a0a0a] rounded-xl border border-white/[0.08] overflow-hidden">
              {/* Window chrome */}
              <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/[0.06]">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                <div className="w-3 h-3 rounded-full bg-[#28c840]" />
                <span className="ml-4 text-white/30 text-[11px]">
                  Capacity
                </span>
              </div>
              {/* Sidebar + content */}
              <div className="flex h-full">
                <div className="w-[180px] border-r border-white/[0.06] p-3">
                  <div className="text-white/30 text-[10px] uppercase tracking-wider mb-3">
                    Specifications
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.04]">
                      <div className="w-4 h-4 rounded bg-green-500/20 flex items-center justify-center">
                        <svg width={8} height={8} viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2 2 4-4" stroke="#4ade80" strokeWidth={1.5} />
                        </svg>
                      </div>
                      <span className="text-white text-[12px]">
                        Project Brief
                      </span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded">
                      <div className="w-4 h-4 rounded bg-white/[0.06]" />
                      <span className="text-white/40 text-[12px]">
                        User Experience
                      </span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded">
                      <div className="w-4 h-4 rounded bg-white/[0.06]" />
                      <span className="text-white/40 text-[12px]">
                        Design
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex-1 p-4">
                  <div className="text-white text-[13px] font-medium mb-3">
                    Project Brief
                  </div>
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 mb-3">
                    <span className="text-green-400 text-[12px]">
                      &#9989; Project Brief Successfully Generated!
                    </span>
                  </div>
                  <p className="text-white/40 text-[11px] leading-relaxed">
                    Your comprehensive project brief has been created and saved.
                    This document now serves as the foundation for all subsequent
                    product development work.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right — text */}
          <div>
            <h2 className="text-[clamp(28px,3.5vw,40px)] font-normal mb-4">
              Build{" "}
              <em className="font-serif italic">faster</em> and{" "}
              <em className="font-serif italic">better</em>
              <br />
              with Specs
            </h2>
            <p className="text-white/50 text-[16px] leading-relaxed mb-6 max-w-md">
              Plan before you code. With Spec, define your vision in natural
              language and get a detailed implementation plan.
            </p>
            <Link
              href="#"
              className="inline-flex items-center gap-2 text-white/70 text-[15px] hover:text-white transition-colors"
            >
              Learn about Spec <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ──── From website to real business ──── */}
      <section className="py-24 px-4">
        <div className="max-w-[1200px] mx-auto bg-[#0a0a0a] rounded-3xl p-12 lg:p-16 border border-white/[0.06]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            <div>
              <h2 className="text-[clamp(28px,3.5vw,40px)] font-normal mb-4">
                <em className="font-serif italic">From website</em>{" "}
                to real business
              </h2>
              <p className="text-white/40 text-[16px] leading-relaxed mb-10 max-w-md">
                Start with a website, then add a mobile app to reach every
                customer. Build a complete business &mdash; not just a project.
              </p>

              <div className="space-y-8">
                {[
                  {
                    num: "1",
                    title: "Start with a website",
                    desc: "Build your fullstack web app with AI. Real backend, real database, production-ready.",
                  },
                  {
                    num: "2",
                    title: "Add a mobile app",
                    desc: "Expand to iOS and Android with React Native. Same backend, same database, one codebase.",
                  },
                  {
                    num: "3",
                    title: "Grow your business",
                    desc: "Web + mobile = complete reach. Your customers find you everywhere.",
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

            {/* Right — web + mobile wireframes */}
            <div className="flex items-center justify-center gap-6 relative">
              {/* Web app wireframe */}
              <div className="w-[280px] bg-[#111] rounded-xl border border-white/[0.08] p-4">
                <div className="flex items-center gap-1.5 mb-4">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                  <div className="ml-3 flex-1 h-6 rounded bg-white/[0.04] flex items-center justify-center">
                    <span className="text-white/20 text-[10px]">
                      myapp.capacity.studio
                    </span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="h-3 bg-white/[0.06] rounded w-3/4" />
                  <div className="h-3 bg-white/[0.06] rounded w-1/2" />
                  <div className="flex gap-3 mt-2">
                    <div className="h-20 flex-1 bg-white/[0.04] rounded-lg" />
                    <div className="h-20 flex-1 bg-white/[0.04] rounded-lg" />
                  </div>
                  <div className="h-10 bg-white/90 rounded-lg" />
                </div>
                <div className="flex items-center gap-1.5 mt-4">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-white/40 text-[11px]">Web App</span>
                </div>
              </div>

              {/* Shared backend connector */}
              <div className="absolute left-1/2 -translate-x-1/2 bottom-4 bg-[#1a1a1a] border border-white/[0.08] rounded-full px-3 py-1 flex items-center gap-1.5 z-10">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-white/50 text-[10px]">
                  Shared Backend
                </span>
              </div>

              {/* Mobile app wireframe */}
              <div className="w-[160px] bg-[#111] rounded-2xl border border-white/[0.08] p-4">
                <div className="space-y-3">
                  <div className="h-3 bg-white/[0.06] rounded w-3/4 mx-auto" />
                  <div className="h-3 bg-white/[0.06] rounded w-1/2 mx-auto" />
                  <div className="h-24 bg-white/[0.04] rounded-lg" />
                  <div className="h-10 bg-white/90 rounded-lg" />
                  <div className="h-3 bg-white/[0.06] rounded w-2/3 mx-auto" />
                </div>
                <div className="flex items-center gap-1.5 mt-4 justify-center">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-white/40 text-[11px]">Mobile App</span>
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
            Start building
          </h2>
          <p className="text-white/40 text-[16px] mb-10">
            Join thousands of makers who are building beautiful web and mobile
            apps with Capacity.
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
                <svg width={24} height={24} viewBox="0 0 24 24" fill="white">
                  <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
                </svg>
                <span className="text-white font-semibold text-[16px]">
                  Capacity
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
                  "Changelog",
                  "Roadmap",
                  "Pricing",
                  "Support",
                  "Tools",
                  "Learn",
                  "Use Cases",
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

            {/* Resources */}
            <div>
              <h4 className="text-white font-semibold text-[14px] mb-4">
                Resources
              </h4>
              <ul className="space-y-3">
                {[
                  "AI Landing Page Builder",
                  "Custom Web App Development",
                  "React Boilerplate Generator",
                  "AI MVP Builder",
                  "AI Mobile App Builder",
                  "Wedding Website Builder",
                  "Alternatives",
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
                  "Blog",
                  "Contact",
                  "About",
                  "Affiliate Program",
                  "Discord",
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

            {/* Legal */}
            <div>
              <h4 className="text-white font-semibold text-[14px] mb-4">
                Legal
              </h4>
              <ul className="space-y-3">
                {["Privacy", "Terms of Service", "Report Abuse"].map(
                  (item) => (
                    <li key={item}>
                      <Link
                        href="#"
                        className="text-white/40 text-[14px] hover:text-white/70 transition-colors"
                      >
                        {item}
                      </Link>
                    </li>
                  )
                )}
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="flex items-center justify-between border-t border-white/[0.06] pt-6">
            <span className="text-white/30 text-[13px]">
              &copy; 2026 Capacity.so, All rights reserved
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
