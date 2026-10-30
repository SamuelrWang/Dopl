import styles from "./design-playground.module.css";
import { LogoMark } from "./icons";
import { T } from "./text-run";

export function VerifyCard() {
  return (
    <>
      <div className={`${styles.card} ${styles.cardVerify}`} />
      <div className={styles.logo} />
      <LogoMark />
      <T n="verifyTitle" />
      <T n="verifyLine1" />
      <T n="verifyLine2" />
      <T n="verifyRetry" />
      <div className={`${styles.box} ${styles.otpBox1}`} />
      <T n="otp1" />
      <div className={`${styles.box} ${styles.otpBox2}`} />
      <T n="otp2" />
      <div className={`${styles.box} ${styles.otpBox3}`} />
      <T n="otp3" />
      <div className={`${styles.box} ${styles.otpBox4}`} />
      <T n="otp4" />
      <div className={`${styles.box} ${styles.btnBack}`} />
      <T n="verifyBack" />
      <div className={`${styles.black} ${styles.btnConfirm}`} />
      <T n="verifyConfirm" />
    </>
  );
}
