import localFont from "next/font/local";
import { SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";
import { AiToolsCard } from "./ai-tools-card";
import styles from "./design-playground.module.css";
import { LoginCard } from "./login-card";
import { RichTextCard } from "./rich-text-card";
import { ScaleToFit } from "./scale-to-fit";
import { SearchCard } from "./search-card";
import { UploadCard } from "./upload-card";
import { VerifyCard } from "./verify-card";

/** The reference is set in Inter. Loaded here, for this page only. */
const inter = localFont({ src: "../../../fonts/inter-latin.woff2", weight: "100 900", style: "normal", display: "block" });

const GRID_X = [174, 424, 674, 924, 1174, 1424, 1674, 1924];
const GRID_Y = [250.1, 501.35, 752.6, 1003.85, 1255.1];

export default function Page() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-9 shrink-0 items-center px-5 pb-1 pt-4">
        <h1 className={SECTION_HEADING_TEXT}>Design Playground</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-5 pt-1">
        <ScaleToFit>
          <div className={`${styles.canvas} ${inter.className}`}>
            {GRID_X.map((left) => (
              <div key={left} className={styles.gridV} style={{ left }} />
            ))}
            {GRID_Y.map((top) => (
              <div key={top} className={styles.gridH} style={{ top }} />
            ))}
            <UploadCard />
            <VerifyCard />
            <AiToolsCard />
            <SearchCard />
            <RichTextCard />
            <LoginCard />
          </div>
        </ScaleToFit>
      </div>
    </div>
  );
}
