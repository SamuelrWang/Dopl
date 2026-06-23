import { LOGOS, TRUSTED_LABEL } from "../constants";

/** "Trusted by" label, divider rule, and the grayscale logo wall. */
export function TrustedBy() {
  return (
    <section className="dopl-trusted dopl-bound">
      <p className="dopl-trusted-label">{TRUSTED_LABEL}</p>
      <div className="dopl-rule" />
      <div className="dopl-logos">
        {LOGOS.map((name) => (
          <span key={name} className="dopl-logo">
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}
