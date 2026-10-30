import { designFont } from "./_design/font";
import { OverviewSection } from "./_sections/overview";

export default function Page() {
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <OverviewSection />
    </div>
  );
}
