import { SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";
import { designFont } from "../_design/font";
import tokens from "../_design/tokens.module.css";
import { AiToolsCard } from "./ai-tools-card";
import { CloneBox } from "./clone-box";
import { Gallery } from "./gallery";
import styles from "./design-playground.module.css";
import { LoginCard } from "./login-card";
import { RichTextCard } from "./rich-text-card";
import { SearchCard } from "./search-card";
import { UploadCard } from "./upload-card";
import { VerifyCard } from "./verify-card";

export default function Page() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-9 shrink-0 items-center px-5 pb-1 pt-4">
        <h1 className={SECTION_HEADING_TEXT}>Design Playground</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-5 pt-1">
        <div className={`${styles.canvas} ${designFont.className} ${tokens.scope}`}>
          <div className={styles.clone}>
            <div className={styles.cloneSide}>
              <CloneBox x={138.9} y={213.9} w={505.2} h={660.2}>
                <UploadCard />
              </CloneBox>
              <CloneBox x={138.9} y={901.8} w={505.2} h={383.8}>
                <VerifyCard />
              </CloneBox>
            </div>
            <div className={styles.cloneMain}>
              <CloneBox x={673.55} y={214.2} w={1187} h={356.5}>
                <AiToolsCard />
              </CloneBox>
              <div className={styles.cloneRow}>
                <CloneBox x={673.7} y={600.3} w={520.1} h={685.3}>
                  <SearchCard />
                </CloneBox>
                <div className={styles.cloneCol}>
                  <CloneBox x={1222.9} y={600.4} w={637.7} h={234.5}>
                    <RichTextCard />
                  </CloneBox>
                  <CloneBox x={1222.9} y={864.8} w={637.7} h={420.8}>
                    <LoginCard />
                  </CloneBox>
                </div>
              </div>
            </div>
          </div>
          <Gallery />
        </div>
      </div>
    </div>
  );
}
