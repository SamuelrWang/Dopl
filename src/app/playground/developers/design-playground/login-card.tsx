import Image from "next/image";
import styles from "./design-playground.module.css";
import flag from "./flag.png";
import { Chevron, GoogleG } from "./icons";
import { T } from "./text-run";

export function LoginCard() {
  return (
    <>
      <div className={`${styles.card} ${styles.cardLogin}`} />
      <T n="loginTitle" />
      <T n="loginSub" />
      <div className={`${styles.box} ${styles.field}`} />
      <div className={styles.fieldGap} />
      <T n="phoneA" />
      <T n="phoneB" />
      <div className={styles.fieldDivider} />
      <Image className={`${styles.photo} ${styles.flag}`} src={flag} alt="" width={38} height={28} unoptimized />
      <T n="dial" />
      <Chevron x={1373.5} y={1031.5} w={15} h={8} color="#555555" stroke={1.75} />
      <T n="phone" />
      <T n="loginHelp" />
      <div className={`${styles.black} ${styles.btnLogin}`} />
      <T n="loginBtn" />
      <div className={`${styles.box} ${styles.btnGoogle}`} />
      <GoogleG />
      <T n="googleBtn" />
    </>
  );
}
