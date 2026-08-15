import "@/features/marketing/marketing.css";

import { AmbientAudio } from "@/features/marketing/components/ambient-audio";
import { ClickSound } from "@/features/marketing/components/click-sound";
import { Hero } from "@/features/marketing/components/hero";
import { SiteNav } from "@/features/marketing/components/site-nav";

export default function Home() {
  return (
    <div className="lp">
      <SiteNav />
      <Hero />
      {/* Landing only. It lives INSIDE `.lp` because the toggle's face reads
          the `--ink`/`--muted` custom properties declared there. */}
      <AmbientAudio />
      {/* Renders nothing — a document-level listener. Mounted with the toggle
          above, not with `.lp`, because that toggle is what mutes it. */}
      <ClickSound />
    </div>
  );
}
