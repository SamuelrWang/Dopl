import { designFont } from "../_design/font";
import { IssuesSection } from "../_sections/issues";

export default function Page() {
  return (
    <div className={designFont.className} style={{ display: "contents" }}>
      <IssuesSection />
    </div>
  );
}
