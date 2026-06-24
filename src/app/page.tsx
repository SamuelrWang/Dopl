import "@/features/marketing/marketing.css";

import { Hero } from "@/features/marketing/components/hero";
import { SiteNav } from "@/features/marketing/components/site-nav";

export default function Home() {
  return (
    <div className="lp">
      <SiteNav />
      <Hero />
    </div>
  );
}
