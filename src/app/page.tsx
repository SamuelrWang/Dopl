import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  HeroBackground,
  SectionDivider,
} from "@/features/marketing/components/rootly-style-bg";
import {
  AISREMock,
  AlertingMock,
  IncidentResponseMock,
  OnCallMock,
  PhilosophyGrid,
} from "@/features/marketing/components/rootly-style-sections";

const NAV_LINKS = [
  { label: "Product", href: "#product" },
  { label: "Solutions", href: "#solutions" },
  { label: "Customers", href: "#customers" },
  { label: "Resources", href: "#resources" },
  { label: "Pricing", href: "/pricing" },
];

const LOGO_WALL = [
  "trivago",
  "Tripadvisor",
  "affirm",
  "SailPoint",
  "NVIDIA",
  "Figma",
  "replit",
  "Zillow",
  "zscaler",
  "WISE",
  "POSHMARK",
  "stackoverflow",
  "Dropbox",
  "LinkedIn",
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-neutral-900 antialiased">
      <TopNav />
      <Hero />
      <LogoWall />
      <Section
        eyebrow="AI SRE"
        title="Automated root cause analysis, complete with suggested fixes."
        description="Rapid investigation and remediation guidance that helps your team diagnose and resolve issues — before everyone's awake."
        ctaLabel="Explore AI SRE"
        ctaHref="#ai-sre"
        anchor="ai-sre"
      >
        <AISREMock />
      </Section>
      <Section
        eyebrow="On-Call"
        title="On-call that puts you first — designed for everyday life."
        description="AI-powered on-call built for simpler paging, scheduling, and coverage — so your responders can focus on fixing, not juggling."
        ctaLabel="Explore On-Call"
        ctaHref="#on-call"
        anchor="on-call"
      >
        <OnCallMock />
      </Section>
      <Section
        eyebrow="Alerting"
        title="All your alerts and context in one place."
        description="Unify signals from every monitoring tool you use. Triage, acknowledge, and resolve from a single surface."
        ctaLabel="Explore Alerting"
        ctaHref="#alerting"
        anchor="alerting"
      >
        <AlertingMock />
      </Section>
      <Section
        eyebrow="Incident Response"
        title="Fix issues faster, consistently — with fewer people and less effort."
        description="Incident management with built-in AI to automate your workflows for faster resolutions — directly inside Slack or Teams."
        ctaLabel="Explore Incident Response"
        ctaHref="#incident-response"
        anchor="incident-response"
      >
        <IncidentResponseMock />
      </Section>
      <Philosophy />
      <FinalCta />
      <Footer />
    </div>
  );
}

function TopNav() {
  return (
    <nav className="sticky top-0 z-50 w-full bg-white/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/favicons/favicon-32x32.png"
            alt="Dopl"
            width={28}
            height={28}
            className="rounded"
          />
          <span
            className="text-[22px] text-neutral-900"
            style={{
              fontFamily:
                "var(--font-playfair), 'Playfair Display', Georgia, serif",
              fontStyle: "italic",
            }}
          >
            Dopl
          </span>
        </Link>
        <div className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="text-[14px] text-neutral-700 transition-colors hover:text-neutral-900"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-[13px] text-neutral-700 transition-colors hover:bg-neutral-200 sm:inline-flex"
          >
            Log in
            <kbd className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 shadow-sm">
              L
            </kbd>
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-neutral-800"
          >
            Sign up
            <kbd className="rounded bg-neutral-700 px-1.5 py-0.5 text-[11px] font-medium text-white">
              S
            </kbd>
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <HeroBackground />
      <div className="relative z-10 mx-auto max-w-[1200px] px-6 pt-24 pb-32 text-center">
        <h1
          className="mx-auto max-w-[1000px] text-white"
          style={{
            fontSize: "clamp(44px, 6.5vw, 80px)",
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
          }}
        >
          The intelligence layer for your AI agents.
        </h1>
        <p className="mx-auto mt-8 max-w-[640px] text-[17px] leading-relaxed text-white/85">
          Knowledge, skills, and context — engineered so your AI tools resolve
          real work end-to-end, together with your team.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link
            href="/login"
            className="rounded-full bg-white/15 px-6 py-3 text-[14px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/25"
          >
            Get started for free
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-neutral-900 px-6 py-3 text-[14px] font-medium text-white transition-colors hover:bg-neutral-800"
          >
            Book a demo
          </Link>
        </div>
      </div>
    </section>
  );
}

function LogoWall() {
  return (
    <section className="relative -mt-16 pb-20">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="grid grid-cols-3 items-center gap-x-6 gap-y-8 md:grid-cols-7">
          {LOGO_WALL.map((name) => (
            <div
              key={name}
              className="flex items-center justify-center opacity-70 transition-opacity hover:opacity-100"
            >
              <span className="text-[15px] font-semibold tracking-tight text-neutral-700">
                {name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type SectionProps = {
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  anchor: string;
  children: React.ReactNode;
};

function Section({
  eyebrow,
  title,
  description,
  ctaLabel,
  ctaHref,
  anchor,
  children,
}: SectionProps) {
  return (
    <section id={anchor} className="border-t border-neutral-100 py-24">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr] md:items-end">
          <div>
            <span className="inline-block rounded-full bg-violet-100 px-3 py-1 text-[12px] font-medium text-violet-700">
              {eyebrow}
            </span>
            <h2
              className="mt-5 text-neutral-900"
              style={{
                fontSize: "clamp(32px, 3.6vw, 48px)",
                fontWeight: 500,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
              }}
            >
              {title}
            </h2>
          </div>
          <div className="text-[16px] leading-relaxed text-neutral-600">
            <p>{description}</p>
            <Link
              href={ctaHref}
              className="mt-3 inline-flex items-center gap-2 font-medium text-neutral-900 hover:underline"
            >
              {ctaLabel}
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        <div className="mt-14">{children}</div>
        <SectionDivider />
      </div>
    </section>
  );
}

function Philosophy() {
  return (
    <section className="border-t border-neutral-100 py-24">
      <div className="mx-auto max-w-[1200px] px-6">
        <h2
          className="text-neutral-900"
          style={{
            fontSize: "clamp(32px, 3.6vw, 44px)",
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          The Dopl philosophy.
        </h2>
        <p className="mt-4 max-w-[720px] text-[16px] leading-relaxed text-neutral-600">
          Built for modern agentic teams and codified from thousands of real
          workflows, Dopl is designed for teams that need their AI to actually
          ship work — yet simple enough for anyone to use.
        </p>
        <PhilosophyGrid />
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden">
      <HeroBackground variant="soft" />
      <div className="relative z-10 mx-auto max-w-[1200px] px-6 py-28 text-center">
        <h2
          className="mx-auto max-w-[760px] text-neutral-900"
          style={{
            fontSize: "clamp(32px, 4vw, 52px)",
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          You and your team deserve a smarter intelligence layer.
        </h2>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link
            href="/login"
            className="rounded-full bg-white/40 px-6 py-3 text-[14px] font-medium text-neutral-900 backdrop-blur-sm transition-colors hover:bg-white/60"
          >
            Get started for free
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-neutral-900 px-6 py-3 text-[14px] font-medium text-white transition-colors hover:bg-neutral-800"
          >
            Book a demo
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-neutral-950 text-neutral-300">
      <div className="mx-auto max-w-[1200px] px-6 py-16">
        <div className="mb-12 max-w-[560px]">
          <form className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 p-1.5">
            <input
              type="email"
              placeholder="Join our monthly newsletter"
              className="flex-1 bg-transparent px-4 py-2 text-[14px] text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-full bg-white px-5 py-2 text-[13px] font-medium text-neutral-900 transition-colors hover:bg-neutral-200"
            >
              Subscribe
            </button>
          </form>
        </div>
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <FooterColumn
            heading="Product"
            links={[
              "AI SRE",
              "On-Call",
              "Incident Response",
              "Retrospectives",
              "Status Page",
              "Pricing",
            ]}
          />
          <FooterColumn heading="Company" links={["Careers", "Security"]} />
          <FooterColumn
            heading="Resources"
            links={[
              "Documentation",
              "API Reference",
              "Blog",
              "Changelog",
              "System Status",
            ]}
          />
          <FooterColumn
            heading="Community"
            links={["Labs", "GitHub", "Events", "Customer Stories"]}
          />
        </div>
        <div className="mt-16 flex items-end justify-between">
          <div className="flex items-baseline gap-2">
            <Image
              src="/favicons/favicon-32x32.png"
              alt="Dopl"
              width={36}
              height={36}
              className="rounded"
            />
            <span
              className="text-[42px] text-white"
              style={{
                fontFamily:
                  "var(--font-playfair), 'Playfair Display', Georgia, serif",
                fontStyle: "italic",
              }}
            >
              Dopl
            </span>
          </div>
          <p className="text-[12px] text-neutral-500">
            © Dopl {new Date().getFullYear()}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: string[];
}) {
  return (
    <div>
      <h4 className="mb-4 text-[12px] font-medium uppercase tracking-wider text-neutral-500">
        {heading}
      </h4>
      <ul className="space-y-3">
        {links.map((l) => (
          <li key={l}>
            <Link
              href="#"
              className="text-[14px] text-neutral-300 transition-colors hover:text-white"
            >
              {l}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
