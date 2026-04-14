import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Dopl Automation Engine",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen px-6 py-16 flex justify-center relative z-10">
      <div className="w-full max-w-2xl">
        {/* Back link */}
        <Link
          href="/login"
          className="inline-block mb-10 font-mono text-[10px] uppercase tracking-wider text-white/40 hover:text-white transition-colors"
        >
          &larr; Back
        </Link>

        {/* Header */}
        <h1
          className="text-2xl font-bold mb-2"
          style={{
            fontFamily: "var(--font-playfair), 'Playfair Display', serif",
            fontStyle: "italic",
            color: "white",
          }}
        >
          Privacy Policy
        </h1>
        <p className="font-mono text-[10px] uppercase tracking-wider text-white/40 mb-12">
          Last updated: April 2026
        </p>

        {/* Content */}
        <div className="space-y-10 text-[14px] leading-relaxed text-white/70">
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              1. Introduction
            </h2>
            <p>
              Dopl (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates Dopl Automation Engine
              (&quot;the Service&quot;). This Privacy Policy explains how we collect, use, store, and
              protect your information when you use the Service.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              2. Information We Collect
            </h2>

            <h3 className="font-mono text-[10px] uppercase tracking-wider text-white/60 mt-4 mb-2">
              Account Information
            </h3>
            <p>
              When you create an account, we collect your name, email address, and authentication
              credentials. If you sign in via Google OAuth, we receive your name, email, and profile
              picture from Google.
            </p>

            <h3 className="font-mono text-[10px] uppercase tracking-wider text-white/60 mt-4 mb-2">
              Usage Data
            </h3>
            <p>
              We collect information about how you interact with the Service, including pages visited,
              features used, search queries, canvas configurations, and workspace activity.
            </p>

            <h3 className="font-mono text-[10px] uppercase tracking-wider text-white/60 mt-4 mb-2">
              Conversations and AI Interactions
            </h3>
            <p>
              When you use AI-powered features such as the solution builder, search, or chat
              functionality, your queries, prompts, and the resulting AI-generated responses are
              stored. This data is used to provide the Service and to improve the quality, accuracy,
              and reliability of our AI features over time.
            </p>

            <h3 className="font-mono text-[10px] uppercase tracking-wider text-white/60 mt-4 mb-2">
              Technical Data
            </h3>
            <p>
              We automatically collect technical information including IP address, browser type,
              device information, and operating system for security and analytics purposes.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              3. How We Use Your Information
            </h2>
            <p>We use your information to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-white/60">
              <li>Provide, maintain, and improve the Service</li>
              <li>Authenticate your identity and secure your account</li>
              <li>Process and respond to your queries and requests</li>
              <li>Improve AI model quality, accuracy, and relevance using stored interaction data</li>
              <li>Analyze usage patterns to enhance features and user experience</li>
              <li>Communicate service updates, security alerts, and support messages</li>
              <li>Detect, prevent, and address technical issues or abuse</li>
            </ul>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              4. Data Storage and Security
            </h2>
            <p>
              Your data is stored on Supabase (PostgreSQL) infrastructure hosted in the United States.
              We implement industry-standard security measures including encryption in transit (TLS)
              and at rest, access controls, and regular security reviews to protect your information.
            </p>
            <p className="mt-3">
              While we strive to protect your data, no method of electronic storage or transmission
              is 100% secure. We cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              5. Data Retention
            </h2>
            <p>
              We retain your personal data for as long as your account is active or as needed to
              provide the Service. Conversation and interaction data used for improvement purposes
              is retained in anonymized or aggregated form. Upon account deletion, your personal
              data will be permanently removed within 30 days. You may request data export prior to
              deletion.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              6. Third-Party Services
            </h2>
            <p>
              We use the following third-party services to operate the Service:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-white/60">
              <li>Supabase — database, authentication, and real-time infrastructure</li>
              <li>Anthropic — AI model provider (Claude)</li>
              <li>OpenAI — AI model provider</li>
              <li>Vercel — hosting and deployment</li>
              <li>Google — OAuth authentication</li>
            </ul>
            <p className="mt-3">
              Each third-party service operates under its own privacy policy. We only share the
              minimum data necessary for these services to function.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              7. Data Sharing
            </h2>
            <p>
              We do not sell your personal information. We may share your data only in the following
              circumstances:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-white/60">
              <li>With third-party service providers as described above</li>
              <li>When required by law, regulation, or legal process</li>
              <li>To protect the rights, safety, or property of Dopl, our users, or others</li>
              <li>In connection with a merger, acquisition, or sale of assets (with notice)</li>
            </ul>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              8. Your Rights
            </h2>
            <p>You have the right to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-white/60">
              <li>Access and export your personal data</li>
              <li>Correct inaccurate information</li>
              <li>Delete your account and associated data</li>
              <li>Object to certain processing of your data</li>
              <li>Request restriction of processing</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, contact us at the address below.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              9. California Residents
            </h2>
            <p>
              If you are a California resident, you have additional rights under the California
              Consumer Privacy Act (CCPA), including the right to know what personal information we
              collect, request deletion, and opt out of the sale of personal information. We do not
              sell personal information.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              10. Cookies and Tracking
            </h2>
            <p>
              We use essential cookies for authentication and session management. We do not use
              third-party advertising or tracking cookies. Analytics data is collected in aggregate
              form to improve the Service.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              11. Children
            </h2>
            <p>
              The Service is not directed to individuals under the age of 18. We do not knowingly
              collect personal information from children. If we become aware that we have collected
              data from a child, we will take steps to delete it promptly.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              12. Changes to This Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. Material changes will be
              communicated via the Service or email. Continued use of the Service after changes
              constitutes acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              13. Contact
            </h2>
            <p>
              If you have questions about this Privacy Policy or your data, contact us at:
            </p>
            <div className="mt-3 font-mono text-[12px] text-white/50 space-y-1">
              <p>Dopl</p>
              <p>2603 California Street</p>
              <p>San Francisco, CA</p>
              <p>
                <a href="mailto:build@usedopl.com" className="text-white/70 hover:text-white transition-colors">
                  build@usedopl.com
                </a>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
