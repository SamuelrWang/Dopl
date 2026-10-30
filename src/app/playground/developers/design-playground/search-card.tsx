import Image from "next/image";
import ada from "./avatar-ada.png";
import agus from "./avatar-agus.png";
import terus from "./avatar-terus.png";
import styles from "./design-playground.module.css";
import { Chevron, CommandKey, PdfGlyph, SearchGlass } from "./icons";
import { T } from "./text-run";

const PILL_CHEVRON = { w: 10, h: 5.6, color: "#6e6e6e", stroke: 1.5, y: 776.9 };

export function SearchCard() {
  return (
    <>
      <div className={`${styles.card} ${styles.cardSearch}`} />
      <div className={styles.searchInput} />
      <SearchGlass />
      <T n="searchLabel" />
      <CommandKey />
      <T n="searchKey" />
      <div className={`${styles.box} ${styles.panel}`} />
      <T n="filterBy" />
      <div className={`${styles.pill} ${styles.pillBox1}`} />
      <T n="pillAll" />
      <Chevron {...PILL_CHEVRON} x={766} />
      <div className={`${styles.pill} ${styles.pillBox2}`} />
      <T n="pillPeople" />
      <Chevron {...PILL_CHEVRON} x={887.2} />
      <div className={`${styles.pill} ${styles.pillBox3}`} />
      <T n="pillFile" />
      <Chevron {...PILL_CHEVRON} x={980} />
      <div className={`${styles.pill} ${styles.pillBox4}`} />
      <T n="pillProduct" />
      <Chevron {...PILL_CHEVRON} x={1110} />
      <T n="recent" />
      <Image className={`${styles.photo} ${styles.avatar1}`} src={ada} alt="" width={50} height={50} unoptimized />
      <T n="p1Name" />
      <T n="p1Role" />
      <Image className={`${styles.photo} ${styles.avatar2}`} src={terus} alt="" width={50} height={50} unoptimized />
      <T n="p2Name" />
      <T n="p2Role" />
      <Image className={`${styles.photo} ${styles.avatar3}`} src={agus} alt="" width={50} height={50} unoptimized />
      <T n="p3Name" />
      <T n="p3Role" />
      <div className={styles.searchDivider} />
      <T n="fileRecent" />
      <PdfGlyph x={536.25} y={530.25} />
      <T n="r1Name" />
      <T n="r1Meta" />
      <PdfGlyph x={536.25} y={598} />
      <T n="r2Name" />
      <T n="r2Meta" />
    </>
  );
}
