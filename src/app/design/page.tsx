/**
 * Design system showcase page.
 *
 * Reference page for all design tokens, primitive components, and a
 * reproduction of the target aesthetic. Use this to verify the design
 * system matches the reference before overhauling actual product pages.
 */

import Image from "next/image";
import {
  Surface,
  Pill,
  PillBar,
  GlowText,
  GlassCard,
  GlassDivider,
  GlassNavbar,
  GlassNavLink,
  StatusDot,
  MonoLabel,
} from "@/components/design";

const colorSwatches = [
  { name: "bg-base", value: "var(--bg-base)", oklch: "oklch(0.08 0.002 260)" },
  { name: "bg-elevated", value: "var(--bg-elevated)", oklch: "oklch(0.14 0.003 260)" },
  { name: "bg-elevated-hover", value: "var(--bg-elevated-hover)", oklch: "oklch(0.16 0.003 260)" },
  { name: "bg-inset", value: "var(--bg-inset)", oklch: "oklch(0.11 0.002 260)" },
  { name: "bg-inset-hover", value: "var(--bg-inset-hover)", oklch: "oklch(0.13 0.002 260)" },
  { name: "bg-overlay", value: "var(--bg-overlay)", oklch: "oklch(0.12 0.003 260)" },
];

const borderSwatches = [
  { name: "border-subtle", value: "var(--border-subtle)" },
  { name: "border-default", value: "var(--border-default)" },
  { name: "border-strong", value: "var(--border-strong)" },
  { name: "border-highlight", value: "var(--border-highlight)" },
];

const textSwatches = [
  { name: "text-primary", value: "var(--text-primary)" },
  { name: "text-secondary", value: "var(--text-secondary)" },
  { name: "text-muted", value: "var(--text-muted)" },
  { name: "text-disabled", value: "var(--text-disabled)" },
];

const accentSwatches = [
  { name: "accent-primary", value: "var(--accent-primary)", oklch: "oklch(0.78 0.16 240)" },
  { name: "accent-glow", value: "var(--accent-glow)", oklch: "oklch(0.68 0.22 250)" },
  { name: "accent-soft", value: "var(--accent-soft)", oklch: "oklch(0.45 0.12 245)" },
];

const radiusExamples = [
  { name: "radius-sm", value: "var(--radius-sm)" },
  { name: "radius-md", value: "var(--radius-md)" },
  { name: "radius-lg", value: "var(--radius-lg)" },
  { name: "radius-xl", value: "var(--radius-xl)" },
  { name: "radius-2xl", value: "var(--radius-2xl)" },
  { name: "radius-3xl", value: "var(--radius-3xl)" },
  { name: "radius-pill", value: "var(--radius-pill)" },
];

// Simple inline icons (to match the screenshot's clean line aesthetic)
function HomeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 9.5L10 4l7 5.5V16a1 1 0 0 1-1 1h-3v-5h-6v5H4a1 1 0 0 1-1-1V9.5z" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M3 11h4l1 2h4l1-2h4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="6" />
      <path d="M14 14l4 4" strokeLinecap="round" />
    </svg>
  );
}

function BuilderIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 17l4-12 4 12M6 13h4M14 5v12M11 5h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function DesignSystemPage() {
  return (
    <div className="min-h-screen w-full">
      {/* Hero — reproduction of the screenshot aesthetic */}
      <section className="min-h-[60vh] flex flex-col items-center justify-center px-8 py-24 relative">
        <div className="text-center mb-12 space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">
            Dopl
          </p>
          <h1 className="text-5xl font-bold text-[var(--text-primary)]">
            <GlowText>Design System</GlowText>
          </h1>
          <p className="text-[var(--text-secondary)] max-w-md mx-auto text-sm">
            Foundation for the dark, glowing aesthetic. Reference these primitives when building new pages.
          </p>
        </div>

        {/* Reproduction of the screenshot navbar */}
        <PillBar leading={<Image src="/favicons/favicon-32x32.png" alt="Logo" width={24} height={24} className="rounded-md" />}>
          <Pill icon={<HomeIcon />} variant="active">
            Home
          </Pill>
          <Pill icon={<InboxIcon />}>Measure Advanced</Pill>
          <Pill icon={<SearchIcon />}>Search</Pill>
          <Pill icon={<BuilderIcon />}>Builder</Pill>
        </PillBar>

        <p className="mt-8 text-xs text-[var(--text-muted)]">
          ↑ Reproduction of the reference screenshot using new primitives
        </p>
      </section>

      {/* ── LIQUID GLASS PRIMITIVES (canonical) ────────────────────── */}
      <section className="max-w-6xl mx-auto px-8 py-16 space-y-16 border-t border-white/[0.06]">
        <div className="space-y-3">
          <MonoLabel accentColor="var(--coral)" tone="strong">
            Canonical Primitives
          </MonoLabel>
          <h2 className="text-3xl font-bold text-white/90">
            Liquid Glass
          </h2>
          <p className="text-sm text-white/50 max-w-2xl">
            Frosted translucent panels with backdrop blur and luminous borders.
            Direct port from openclaw-cloud with exact class strings preserved.
            Sharp edges on navbars, soft corners on cards.
          </p>
        </div>

        {/* GlassNavbar reproduction */}
        <TokenSection
          title="GlassNavbar"
          subtitle="Sharp-cornered navigation bar — height 48/56px, rounded-[3px]"
        >
          <GlassNavbar
            leading={
              <span className="font-mono text-[10px] uppercase tracking-wide text-white/80">
                Dopl
              </span>
            }
            trailing={<StatusDot state="online" label="Live" />}
          >
            <GlassNavLink href="/design">Design</GlassNavLink>
            <GlassNavLink href="/canvas">Canvas</GlassNavLink>
            <GlassNavLink href="/browse">Browse</GlassNavLink>
            <GlassNavLink href="/build">Builder</GlassNavLink>
          </GlassNavbar>
          <p className="text-[10px] text-white/40 font-mono uppercase tracking-wide mt-3">
            Navbar corners: rounded-[3px] · Hairline border: white/10
          </p>
        </TokenSection>

        {/* GlassCard variants */}
        <TokenSection
          title="GlassCard Variants"
          subtitle="Three levels of frost intensity — default, elevated, subtle"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <GlassCard variant="default" label="Default" labelDivider>
              <p className="text-sm text-white/80 leading-relaxed">
                --card-surface
                <br />
                oklch(0.21 0 0)
                <br />
                border-white/[0.2]
              </p>
            </GlassCard>
            <GlassCard variant="elevated" label="Elevated" labelDivider>
              <p className="text-sm text-white/80 leading-relaxed">
                --card-surface-elevated
                <br />
                oklch(0.24 0 0)
                <br />
                border-white/[0.28]
              </p>
            </GlassCard>
            <GlassCard variant="subtle" label="Subtle" labelDivider>
              <p className="text-sm text-white/80 leading-relaxed">
                --card-surface-subtle
                <br />
                oklch(0.19 0 0)
                <br />
                border-white/[0.12]
              </p>
            </GlassCard>
          </div>
        </TokenSection>

        {/* GlassCard with accent bars */}
        <TokenSection
          title="GlassCard Accents"
          subtitle="Coral / mint / gold accent bars for semantic categorization"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <GlassCard label="Alert" accentColor="var(--coral)" labelDivider>
              <p className="text-sm text-white/70">
                Coral accent — use for errors, warnings, destructive
                confirmations.
              </p>
            </GlassCard>
            <GlassCard label="Success" accentColor="var(--mint)" labelDivider>
              <p className="text-sm text-white/70">
                Mint accent — use for successful states, completed actions,
                positive feedback.
              </p>
            </GlassCard>
            <GlassCard label="Notice" accentColor="var(--gold)" labelDivider>
              <p className="text-sm text-white/70">
                Gold accent — use for warnings, important notices, review
                items.
              </p>
            </GlassCard>
          </div>
        </TokenSection>

        {/* GlassDivider example */}
        <TokenSection
          title="GlassDivider"
          subtitle="Soft gradient separator for use inside GlassCards"
        >
          <GlassCard label="With divider" variant="subtle">
            <p className="text-sm text-white/80">Section one content.</p>
            <GlassDivider />
            <p className="text-sm text-white/80">
              Section two content. Notice the soft gradient fade on the
              divider ends.
            </p>
          </GlassCard>
        </TokenSection>

        {/* Status dots */}
        <TokenSection
          title="StatusDot"
          subtitle="Square 2x2 status indicators — rounded-none is intentional"
        >
          <GlassCard variant="subtle" className="flex items-center gap-8 flex-wrap">
            <StatusDot state="online" />
            <StatusDot state="connecting" />
            <StatusDot state="offline" />
            <StatusDot state="neutral" />
          </GlassCard>
        </TokenSection>

        {/* MonoLabel */}
        <TokenSection
          title="MonoLabel"
          subtitle="font-mono text-[10px] uppercase tracking-wide — the canonical label pattern"
        >
          <GlassCard variant="subtle" className="space-y-3">
            <div>
              <MonoLabel tone="strong">Strong tone</MonoLabel>
            </div>
            <div>
              <MonoLabel tone="default">Default tone</MonoLabel>
            </div>
            <div>
              <MonoLabel tone="muted">Muted tone</MonoLabel>
            </div>
            <div>
              <MonoLabel accentColor="var(--coral)">With coral accent bar</MonoLabel>
            </div>
            <div>
              <MonoLabel accentColor="var(--mint)">With mint accent bar</MonoLabel>
            </div>
            <div>
              <MonoLabel accentColor="var(--gold)">With gold accent bar</MonoLabel>
            </div>
          </GlassCard>
        </TokenSection>

        {/* openclaw palette */}
        <TokenSection
          title="openclaw Palette"
          subtitle="Exact color values from openclaw-cloud — paper, forest, grid, coral, mint, gold"
        >
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Swatch name="paper" value="#0d0d12" oklch="main surface" />
            <Swatch name="forest" value="#e0e0e0" oklch="primary text" />
            <Swatch name="grid" value="#a0a0a0" oklch="secondary text" />
            <Swatch name="coral" value="#FF8C69" oklch="alerts" />
            <Swatch name="mint" value="#9EFFBF" oklch="success" />
            <Swatch name="gold" value="#F4D35E" oklch="warnings" />
          </div>
        </TokenSection>

        {/* UI/UX Pro Max guardrails */}
        <TokenSection
          title="UI/UX Pro Max Guardrails"
          subtitle="Design principles enforced across the system"
        >
          <GlassCard label="Accessibility & Touch" accentColor="var(--mint)" labelDivider>
            <ul className="text-xs text-white/70 space-y-1.5 leading-relaxed font-mono">
              <li>• Touch targets ≥44×44px with 8px+ spacing</li>
              <li>• Text contrast ≥4.5:1 (AA); large text ≥3:1</li>
              <li>• Visible focus rings on all interactive elements</li>
              <li>• aria-label required on icon-only buttons</li>
              <li>• Never convey information with color alone</li>
              <li>• Respect prefers-reduced-motion</li>
            </ul>
          </GlassCard>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <GlassCard label="Motion" accentColor="var(--gold)" labelDivider>
              <ul className="text-xs text-white/70 space-y-1.5 leading-relaxed font-mono">
                <li>• Micro-interactions: 150-300ms</li>
                <li>• Complex transitions: ≤400ms</li>
                <li>• Exit ~60-70% of enter duration</li>
                <li>• Only animate transform & opacity</li>
                <li>• Use ease-out for entering, ease-in for exiting</li>
              </ul>
            </GlassCard>
            <GlassCard label="Sharp Edges" accentColor="var(--coral)" labelDivider>
              <ul className="text-xs text-white/70 space-y-1.5 leading-relaxed font-mono">
                <li>• Navbars, status dots: rounded-[3px] / rounded-none</li>
                <li>• GlassCards: rounded-2xl (only exception)</li>
                <li>• Icons: SVG only, never emoji</li>
                <li>• Hairline borders: 1px white/10 standard</li>
                <li>• Consistent icon stroke width (1.5px)</li>
              </ul>
            </GlassCard>
          </div>
        </TokenSection>
      </section>

      {/* ── ACCENT PRIMITIVES (complementary) ──────────────────────── */}
      <section className="max-w-6xl mx-auto px-8 py-16 space-y-16 border-t border-white/[0.06]">
        <div className="space-y-3">
          <MonoLabel accentColor="var(--gold)" tone="strong">
            Complementary Primitives
          </MonoLabel>
          <h2 className="text-3xl font-bold text-white/90">
            Accent Elements
          </h2>
          <p className="text-sm text-white/50 max-w-2xl">
            Glowing accents for hero moments and brand expression. Use
            sparingly — the glass aesthetic is the primary language.
          </p>
        </div>

        {/* Surfaces */}
        <TokenSection title="Surfaces" subtitle="Background colors for layered depth">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {colorSwatches.map((s) => (
              <Swatch key={s.name} {...s} />
            ))}
          </div>
        </TokenSection>

        {/* Borders */}
        <TokenSection title="Borders" subtitle="Translucent white borders at increasing strength">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {borderSwatches.map((s) => (
              <BorderSwatch key={s.name} {...s} />
            ))}
          </div>
        </TokenSection>

        {/* Text */}
        <TokenSection title="Text" subtitle="Hierarchy from primary to disabled">
          <div className="space-y-2">
            {textSwatches.map((s) => (
              <div
                key={s.name}
                className="flex items-center gap-4 text-sm py-2 border-b border-[var(--border-subtle)]"
              >
                <code className="text-[var(--text-muted)] text-xs w-40 shrink-0">
                  {s.name}
                </code>
                <span style={{ color: s.value }} className="text-base">
                  The quick brown fox jumps
                </span>
              </div>
            ))}
          </div>
        </TokenSection>

        {/* Accent */}
        <TokenSection title="Accent" subtitle="The cyan/blue glow that defines the brand">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {accentSwatches.map((s) => (
              <Swatch key={s.name} {...s} />
            ))}
          </div>
        </TokenSection>

        {/* Radii */}
        <TokenSection title="Radii" subtitle="Border radius scale">
          <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
            {radiusExamples.map((r) => (
              <div key={r.name} className="flex flex-col items-center gap-2">
                <div
                  className="w-16 h-16 bg-[var(--bg-elevated)] border border-[var(--border-default)]"
                  style={{ borderRadius: r.value }}
                />
                <code className="text-[10px] text-[var(--text-muted)]">{r.name}</code>
              </div>
            ))}
          </div>
        </TokenSection>

        {/* Surface variants */}
        <TokenSection title="Surface Variants" subtitle="The container primitive in all variants and shapes">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <code className="text-xs text-[var(--text-muted)]">elevated / card</code>
              <Surface variant="elevated" shape="card" className="p-6 h-32 flex items-center justify-center">
                <span className="text-[var(--text-secondary)] text-sm">Elevated Card</span>
              </Surface>
            </div>
            <div className="space-y-2">
              <code className="text-xs text-[var(--text-muted)]">inset / panel</code>
              <Surface variant="inset" shape="panel" className="p-6 h-32 flex items-center justify-center">
                <span className="text-[var(--text-secondary)] text-sm">Inset Panel</span>
              </Surface>
            </div>
            <div className="space-y-2">
              <code className="text-xs text-[var(--text-muted)]">flat / tile</code>
              <Surface variant="flat" shape="tile" className="p-6 h-32 flex items-center justify-center">
                <span className="text-[var(--text-secondary)] text-sm">Flat Tile</span>
              </Surface>
            </div>
          </div>
        </TokenSection>

        {/* Logo sizes */}
        <TokenSection title="Logo" subtitle="The brand logo at different sizes">
          <div className="flex items-center gap-12 flex-wrap">
            <div className="flex flex-col items-center gap-3">
              <Image src="/favicons/favicon-32x32.png" alt="Logo" width={24} height={24} className="rounded-md" />
              <code className="text-[10px] text-[var(--text-muted)]">24px</code>
            </div>
            <div className="flex flex-col items-center gap-3">
              <Image src="/favicons/favicon-32x32.png" alt="Logo" width={32} height={32} className="rounded-lg" />
              <code className="text-[10px] text-[var(--text-muted)]">32px</code>
            </div>
            <div className="flex flex-col items-center gap-3">
              <Image src="/favicons/android-chrome-192x192.png" alt="Logo" width={56} height={56} className="rounded-xl" />
              <code className="text-[10px] text-[var(--text-muted)]">56px</code>
            </div>
            <div className="flex flex-col items-center gap-3">
              <Image src="/favicons/android-chrome-192x192.png" alt="Logo" width={80} height={80} className="rounded-2xl" />
              <code className="text-[10px] text-[var(--text-muted)]">80px</code>
            </div>
          </div>
        </TokenSection>

        {/* Pills */}
        <TokenSection title="Pills" subtitle="Button/link primitives matching the navbar items">
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill variant="default">Default</Pill>
              <Pill variant="inset">Inset</Pill>
              <Pill variant="active">Active</Pill>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Pill icon={<HomeIcon />} size="sm">Small</Pill>
              <Pill icon={<HomeIcon />} size="md">Medium</Pill>
              <Pill icon={<HomeIcon />} size="lg">Large</Pill>
            </div>
          </div>
        </TokenSection>

        {/* PillBar examples */}
        <TokenSection title="PillBar" subtitle="The navbar container">
          <div className="space-y-6">
            <PillBar>
              <Pill icon={<HomeIcon />} variant="active">Home</Pill>
              <Pill icon={<InboxIcon />}>Inbox</Pill>
              <Pill icon={<SearchIcon />}>Search</Pill>
            </PillBar>
            <PillBar leading={<Image src="/favicons/favicon-32x32.png" alt="Logo" width={24} height={24} className="rounded-md" />}>
              <Pill icon={<HomeIcon />} variant="active">Home</Pill>
              <Pill icon={<BuilderIcon />}>Builder</Pill>
            </PillBar>
          </div>
        </TokenSection>

        {/* GlowText */}
        <TokenSection title="GlowText" subtitle="Headings with accent glow">
          <div className="space-y-4">
            <h2 className="text-3xl font-bold">
              <GlowText intensity="subtle">Subtle Glow</GlowText>
            </h2>
            <h2 className="text-3xl font-bold">
              <GlowText intensity="default">Default Glow</GlowText>
            </h2>
            <h2 className="text-3xl font-bold">
              <GlowText intensity="strong">Strong Glow</GlowText>
            </h2>
          </div>
        </TokenSection>
      </section>
    </div>
  );
}

function TokenSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function Swatch({
  name,
  value,
  oklch,
}: {
  name: string;
  value: string;
  oklch?: string;
}) {
  return (
    <div className="space-y-2">
      <div
        className="h-16 rounded-lg border border-[var(--border-subtle)]"
        style={{ backgroundColor: value }}
      />
      <div className="space-y-0.5">
        <code className="block text-[10px] text-[var(--text-secondary)]">{name}</code>
        {oklch && (
          <code className="block text-[10px] text-[var(--text-muted)]">{oklch}</code>
        )}
      </div>
    </div>
  );
}

function BorderSwatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="space-y-2">
      <div
        className="h-16 rounded-lg bg-[var(--bg-elevated)]"
        style={{ border: `1px solid ${value}` }}
      />
      <code className="block text-[10px] text-[var(--text-secondary)]">{name}</code>
    </div>
  );
}
