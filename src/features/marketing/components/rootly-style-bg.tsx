type HeroBackgroundProps = {
  variant?: "default" | "soft";
};

export function HeroBackground({ variant = "default" }: HeroBackgroundProps) {
  if (variant === "soft") {
    return (
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, #f3ecff 0%, #ffe9d0 55%, #faf2e8 100%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(60% 50% at 80% 60%, rgba(255,180,120,0.55) 0%, transparent 70%), radial-gradient(50% 40% at 15% 65%, rgba(170,140,220,0.5) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
      </div>
    );
  }

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, #5a4fb8 0%, #7a6dc9 28%, #9c8dd2 50%, #d3b5b8 78%, #e9c9a0 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(70% 55% at 88% 80%, rgba(255, 165, 100, 0.75) 0%, transparent 60%),
            radial-gradient(55% 45% at 10% 90%, rgba(90, 60, 140, 0.65) 0%, transparent 60%),
            radial-gradient(80% 50% at 50% 100%, rgba(255, 195, 145, 0.55) 0%, transparent 70%),
            radial-gradient(50% 40% at 65% 35%, rgba(255, 220, 200, 0.35) 0%, transparent 60%)
          `,
          filter: "blur(50px)",
        }}
      />
      <svg
        className="absolute inset-x-0 bottom-0 w-full"
        viewBox="0 0 1600 600"
        preserveAspectRatio="none"
        style={{ height: "70%" }}
      >
        <defs>
          <linearGradient id="mtnFar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8a73c0" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#6b53a5" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id="mtnMid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c89180" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#7a548a" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="mtnNear" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5e3f7f" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#a06752" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ddaa70" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="sunGlow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f7c08a" stopOpacity="0" />
            <stop offset="60%" stopColor="#f7c08a" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ffe2b6" stopOpacity="0.7" />
          </linearGradient>
        </defs>
        <path
          d="M0,360 C140,300 260,330 420,280 C560,240 720,300 880,260 C1040,220 1200,280 1360,250 C1480,230 1560,260 1600,250 L1600,600 L0,600 Z"
          fill="url(#mtnFar)"
        />
        <path
          d="M0,420 C100,380 240,400 400,340 C540,290 680,360 860,320 C1020,290 1180,360 1340,310 C1460,275 1560,320 1600,310 L1600,600 L0,600 Z"
          fill="url(#mtnMid)"
        />
        <path
          d="M0,500 C120,460 260,470 420,420 C580,375 760,440 920,400 C1080,365 1240,430 1400,390 C1500,365 1580,395 1600,390 L1600,600 L0,600 Z"
          fill="url(#mtnNear)"
        />
        <rect
          x="900"
          y="100"
          width="700"
          height="500"
          fill="url(#sunGlow)"
          opacity="0.7"
        />
      </svg>
      <div
        className="absolute inset-0 mix-blend-soft-light opacity-50"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.8'/%3E%3C/svg%3E\")",
        }}
      />
      <div
        className="absolute inset-0 mix-blend-overlay opacity-30"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='b'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.3 0 0 0 0 0.6 0 0 0 0.9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23b)'/%3E%3C/svg%3E\")",
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
