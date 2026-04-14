import Link from "next/link";

export const metadata = {
  title: "Terms of Service — Dopl Intelligence",
};

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p className="font-mono text-[10px] uppercase tracking-wider text-white/40 mb-12">
          Last updated: April 2026
        </p>

        {/* Content */}
        <div className="space-y-10 text-[14px] leading-relaxed text-white/70">
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              1. Acceptance of Terms
            </h2>
            <p>
              By accessing or using Dopl Intelligence (&quot;the Service&quot;), operated by Dopl
              (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), you agree to be bound by these Terms of Service.
              If you do not agree, do not use the Service. You must be at least 18 years of age to use
              the Service.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              2. Description of Service
            </h2>
            <p>
              Dopl Intelligence is a platform for discovering, organizing, and composing AI and
              automation setups. The Service provides a knowledge base of proven implementations, a
              visual canvas workspace, and AI-assisted solution building tools.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              3. User Accounts
            </h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials and
              for all activity under your account. You agree to provide accurate, current, and complete
              information during registration. We reserve the right to suspend or terminate accounts
              that violate these Terms.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              4. User Data and Content
            </h2>
            <p>
              You retain ownership of any content you submit to the Service, including workspace
              configurations, clusters, and custom setups. By using the Service, you grant us a
              limited license to store, process, and display your content solely to provide and
              improve the Service.
            </p>
            <p className="mt-3">
              Conversations, queries, and interactions with AI-powered features may be stored and
              used to improve the quality, accuracy, and reliability of the Service. This data is
              handled in accordance with our{" "}
              <Link href="/privacy" className="text-white/90 underline hover:text-white transition-colors">
                Privacy Policy
              </Link>.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              5. Acceptable Use
            </h2>
            <p>You agree not to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-white/60">
              <li>Use the Service for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to any part of the Service</li>
              <li>Interfere with or disrupt the integrity or performance of the Service</li>
              <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
              <li>Use automated systems to scrape or extract data from the Service</li>
              <li>Resell or redistribute the Service without prior written consent</li>
            </ul>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              6. AI-Generated Content
            </h2>
            <p>
              The Service uses artificial intelligence to generate recommendations, solutions, and
              content. AI-generated output is provided as-is and may not always be accurate or
              complete. You are responsible for reviewing and verifying any AI-generated content
              before relying on it.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              7. Third-Party Services
            </h2>
            <p>
              The Service may integrate with or reference third-party tools, platforms, and services.
              We are not responsible for the availability, accuracy, or practices of any third-party
              services. Your use of third-party services is subject to their respective terms and policies.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              8. Intellectual Property
            </h2>
            <p>
              The Service, including its design, features, and underlying technology, is owned by
              Dopl and protected by applicable intellectual property laws. Knowledge base entries may
              reference open-source projects and third-party tools, each subject to their own licenses.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              9. Limitation of Liability
            </h2>
            <p>
              To the maximum extent permitted by law, Dopl shall not be liable for any indirect,
              incidental, special, consequential, or punitive damages arising from your use of the
              Service. The Service is provided &quot;as is&quot; and &quot;as available&quot; without
              warranties of any kind, express or implied.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              10. Termination
            </h2>
            <p>
              We may suspend or terminate your access to the Service at any time for violation of
              these Terms or for any other reason at our discretion. Upon termination, your right to
              use the Service ceases immediately. You may request export of your data within 30 days
              of account deletion.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              11. Changes to Terms
            </h2>
            <p>
              We reserve the right to modify these Terms at any time. Material changes will be
              communicated via the Service or email. Continued use after changes constitutes
              acceptance of the revised Terms.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              12. Governing Law
            </h2>
            <p>
              These Terms are governed by and construed in accordance with the laws of the State of
              California, without regard to conflict of law principles. Any disputes shall be resolved
              in the state or federal courts located in San Francisco, California.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-white/90 mb-3">
              13. Contact
            </h2>
            <p>
              If you have questions about these Terms, contact us at:
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
