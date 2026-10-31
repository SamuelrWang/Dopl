import styles from "./design-playground.module.css";
import { CloseX, DropZoneOutline, PdfGlyph, Trash, UploadCloud } from "./icons";
import { T } from "./text-run";

export function UploadCard() {
  return (
    <>
      <div className={`${styles.card} ${styles.cardUpload}`} />
      <T n="uploadTitle" />
      <T n="uploadSub" />
      <CloseX />
      <DropZoneOutline />
      <UploadCloud />
      <T n="dropTitle" />
      <T n="dropSub" />
      <T n="limitType" />
      <T n="limitSize" />
      <div className={`${styles.box} ${styles.file1}`} />
      <PdfGlyph x={0} y={0} />
      <T n="file1Name" />
      <T n="file1Size" />
      <T n="file1State" />
      <T n="file1Pct" />
      <div className={styles.track} />
      <div className={styles.trackFill} />
      <div className={`${styles.box} ${styles.file2}`} />
      <PdfGlyph x={0} y={120.5} />
      <T n="file2Name" />
      <T n="file2Size" />
      <T n="file2State" />
      <Trash />
      <div className={`${styles.box} ${styles.btnCancel}`} />
      <T n="cancelLabel" />
      <div className={`${styles.black} ${styles.btnUpload}`} />
      <T n="uploadLabel" />
    </>
  );
}
