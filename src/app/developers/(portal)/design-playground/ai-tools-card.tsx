import styles from "./design-playground.module.css";
import { AttachmentClip, ReturnArrow, Sparkle, UseImageIcon } from "./icons";
import { T } from "./text-run";

export function AiToolsCard() {
  return (
    <>
      <div className={styles.aiFrame} />
      <div className={styles.aiHeader} />
      <T n="aiTitle" />
      <Sparkle />
      <div className={styles.aiBody} />
      <div className={styles.aiQuote} />
      <T n="aiLine1" />
      <T n="aiLine2" />
      <T n="aiLine3" />
      <T n="aiPrompt" />
      <div className={styles.cursor} />
      <T n="aiSend" />
      <ReturnArrow />
      <div className={styles.aiDivider} />
      <AttachmentClip />
      <T n="aiAttach" />
      <UseImageIcon />
      <T n="aiImage" />
      <T n="aiModel" />
    </>
  );
}
