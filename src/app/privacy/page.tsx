import {
  LegalContactAddress,
  LegalPage,
  LegalSection,
  LegalSubheading,
} from "@/features/marketing/components/legal-page";

export const metadata = {
  title: "Privacy Policy — Dopl Intelligence",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <LegalSection title="1. Introduction">
        <p>
          Dopl (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates Dopl Intelligence
          (&quot;the Service&quot;). This Privacy Policy explains how we collect, use, store, and
          protect your information when you use the Service.
        </p>
      </LegalSection>

      <LegalSection title="2. Information We Collect">

        <LegalSubheading>Account Information</LegalSubheading>
        <p>
          When you create an account, we collect your name, email address, and authentication
          credentials. If you sign in via Google OAuth, we receive your name, email, and profile
          picture from Google.
        </p>

        <LegalSubheading>Usage Data</LegalSubheading>
        <p>
          We collect information about how you interact with the Service, including pages visited,
          features used, search queries, canvas configurations, and workspace activity.
        </p>

        <LegalSubheading>Conversations and AI Interactions</LegalSubheading>
        <p>
          When you use AI-powered features such as the solution builder, search, or chat
          functionality, your queries, prompts, and the resulting AI-generated responses are
          stored. This data is used to provide the Service and to improve the quality, accuracy,
          and reliability of our AI features over time.
        </p>

        <LegalSubheading>Technical Data</LegalSubheading>
        <p>
          We automatically collect technical information including IP address, browser type,
          device information, and operating system for security and analytics purposes.
        </p>
      </LegalSection>

      <LegalSection title="3. How We Use Your Information">
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
      </LegalSection>

      <LegalSection title="4. Data Storage and Security">
        <p>
          Your data is stored on Supabase (PostgreSQL) infrastructure hosted in the United States.
          We implement industry-standard security measures including encryption in transit (TLS)
          and at rest, access controls, and regular security reviews to protect your information.
        </p>
        <p className="mt-3">
          While we strive to protect your data, no method of electronic storage or transmission
          is 100% secure. We cannot guarantee absolute security.
        </p>
      </LegalSection>

      <LegalSection title="5. Data Retention">
        <p>
          We retain your personal data for as long as your account is active or as needed to
          provide the Service. Conversation and interaction data used for improvement purposes
          is retained in anonymized or aggregated form. Upon account deletion, your personal
          data will be permanently removed within 30 days. You may request data export prior to
          deletion.
        </p>
      </LegalSection>

      <LegalSection title="6. Third-Party Services">
        <p>
          We use the following third-party services to operate the Service:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 text-white/60">
          <li>Supabase — database, authentication, and real-time infrastructure</li>
          <li>OpenAI — AI model provider</li>
          <li>Vercel — hosting and deployment</li>
          <li>Google — OAuth authentication</li>
        </ul>
        <p className="mt-3">
          Each third-party service operates under its own privacy policy. We only share the
          minimum data necessary for these services to function.
        </p>
      </LegalSection>

      <LegalSection title="7. Data Sharing">
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
      </LegalSection>

      <LegalSection title="8. Your Rights">
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
      </LegalSection>

      <LegalSection title="9. California Residents">
        <p>
          If you are a California resident, you have additional rights under the California
          Consumer Privacy Act (CCPA), including the right to know what personal information we
          collect, request deletion, and opt out of the sale of personal information. We do not
          sell personal information.
        </p>
      </LegalSection>

      <LegalSection title="10. Cookies and Tracking">
        <p>
          We use essential cookies for authentication and session management. We do not use
          third-party advertising or tracking cookies. Analytics data is collected in aggregate
          form to improve the Service.
        </p>
      </LegalSection>

      <LegalSection title="11. Children">
        <p>
          The Service is not directed to individuals under the age of 18. We do not knowingly
          collect personal information from children. If we become aware that we have collected
          data from a child, we will take steps to delete it promptly.
        </p>
      </LegalSection>

      <LegalSection title="12. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. Material changes will be
          communicated via the Service or email. Continued use of the Service after changes
          constitutes acceptance of the revised policy.
        </p>
      </LegalSection>

      <LegalSection title="13. Contact">
        <p>
          If you have questions about this Privacy Policy or your data, contact us at:
        </p>
        <LegalContactAddress />
      </LegalSection>
    </LegalPage>
  );
}
