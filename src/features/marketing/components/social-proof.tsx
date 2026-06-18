import { SOCIAL } from "../constants";
import { ImageSlot } from "./image-slot";

/** Green section — social-proof headline, logo row, illustration. */
export function SocialProof() {
  return (
    <section className="green">
      <h2 className="serif">{SOCIAL.heading}</h2>
      <div className="logos">
        <span className="lg">Mercury</span>
        <span className="lg">COUPON</span>
        <span className="lg">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4 22 21H2z" />
          </svg>
          Vercel
        </span>
        <span className="lg">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="3" width="7" height="7" rx="2" />
            <rect x="14" y="3" width="7" height="7" rx="2" />
            <rect x="3" y="14" width="7" height="7" rx="2" />
          </svg>
          replit
        </span>
        <span className="lg">nuuly</span>
        <span className="lg">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 5 9 19h2l1-7 1 7h2l3-14h-2.2l-1.7 9-1.3-9h-1.6l-1.3 9-1.7-9z" />
          </svg>
          warp
        </span>
        <span className="lg spaced">RIVIAN</span>
        <span className="lg">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <path d="M8 7h8M8 11h8M8 15h5" />
          </svg>
          Notion
        </span>
      </div>
      <div className="illo">
        <ImageSlot shape="rect" placeholder="Illustration" />
      </div>
    </section>
  );
}
