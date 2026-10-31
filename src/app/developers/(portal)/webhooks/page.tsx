import { designFont } from "../_design/font";
import { WebhooksSection } from "../_sections/webhooks";

export default function Page() {
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <WebhooksSection />
    </div>
  );
}
