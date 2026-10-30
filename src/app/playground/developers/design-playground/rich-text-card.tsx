import styles from "./design-playground.module.css";
import { AlignIcons, BoldItalicUnderline, Chevron, ToolbarClip, ToolbarImage, ToolbarLink, ToolbarMore } from "./icons";
import { T } from "./text-run";

export function RichTextCard() {
  return (
    <>
      <div className={`${styles.card} ${styles.cardRich}`} />
      <T n="richText" />
      <div className={`${styles.richDivider} ${styles.richDivider1}`} />
      <div className={styles.swatch} />
      <T n="richBody" />
      <Chevron x={1343} y={709.7} w={11} h={5.6} color="#777777" stroke={1.5} />
      <BoldItalicUnderline />
      <div className={`${styles.toolSep} ${styles.toolSep1}`} />
      <AlignIcons />
      <div className={`${styles.toolSep} ${styles.toolSep2}`} />
      <ToolbarClip />
      <ToolbarImage />
      <ToolbarLink />
      <ToolbarMore />
      <div className={`${styles.richDivider} ${styles.richDivider2}`} />
      <div className={`${styles.box} ${styles.btnRichBack}`} />
      <T n="richBack" />
      <div className={`${styles.black} ${styles.btnSend}`} />
      <T n="richSend" />
      <div className={styles.sendDivider} />
      <Chevron x={1805.5} y={788} w={11} h={5.5} color="#ffffff" stroke={1.75} />
    </>
  );
}
