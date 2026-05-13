type HeroBackgroundProps = {
  variant?: "default" | "soft";
};

export function HeroBackground({ variant = "default" }: HeroBackgroundProps) {
  const isDefault = variant === "default";
  return (
    <div aria-hidden className="absolute inset-0 -z-10">
      <div
        className="absolute inset-0"
        style={{
          background: isDefault
            ? "linear-gradient(180deg, #6c63d6 0%, #8c7dd6 35%, #b7a4d4 65%, #d8c2c0 100%)"
            : "linear-gradient(180deg, #efe7f7 0%, #f7ddc8 60%, #f4eee7 100%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background: `
            radial-gradient(60% 50% at 85% 70%, rgba(255, 170, 110, 0.7) 0%, transparent 60%),
            radial-gradient(40% 40% at 15% 75%, rgba(140, 110, 200, 0.7) 0%, transparent 60%),
            radial-gradient(50% 35% at 50% 100%, rgba(255, 200, 150, 0.5) 0%, transparent 70%)
          `,
          filter: "blur(40px)",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-2/3"
        style={{
          background: `
            radial-gradient(ellipse at 20% 90%, rgba(80, 60, 130, 0.55) 0%, transparent 55%),
            radial-gradient(ellipse at 80% 95%, rgba(220, 130, 80, 0.55) 0%, transparent 55%),
            radial-gradient(ellipse at 50% 100%, rgba(120, 90, 150, 0.4) 0%, transparent 60%)
          `,
        }}
      />
      <div
        className="absolute inset-0 mix-blend-soft-light opacity-40"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}

export function SectionDivider() {
  return (
    <div className="mx-auto mt-16 flex max-w-[120px] items-center justify-center gap-1.5">
      <span className="h-1.5 w-8 rounded-full bg-neutral-200" />
      <span className="h-1.5 w-8 rounded-full bg-violet-500" />
      <span className="h-1.5 w-8 rounded-full bg-neutral-200" />
      <span className="h-1.5 w-8 rounded-full bg-neutral-200" />
    </div>
  );
}
