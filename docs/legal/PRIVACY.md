<!--
DRAFTING NOTE — DELETE BEFORE PUBLISHING.
This draft is a starting point, not a substitute for advice from qualified privacy counsel. Bracketed [TODO]
items state practices that must be confirmed or implemented before publication; see
docs/legal/LEGAL-CHECKLIST.md. A mismatch between this policy and Dopl's actual practices is itself a
privacy violation.
-->

# Dopl Privacy Policy

Last updated: October 14, 2026

This Privacy Policy ("**Policy**") describes how Dopl collects, uses, discloses, retains, and protects Personal Information of you or the entity you represent ("**You**") and of other individuals in connection with the Services. This Policy is informational and does not form part of the Services Agreement. Capitalized terms not defined in this Policy have the meanings given in the Dopl Services Agreement at usedopl.com/services-agreement (the "**Agreement**").

---

## 1. Controller

### 1.1. Identity

Dopl is the controller of Personal Information processed under this Policy and the "business" for purposes of the CCPA:

> Dopl (Samuel Wang, an individual doing business as Dopl)
> 2603 California Street
> San Francisco, CA, United States
> build@usedopl.com

### 1.2. Representatives

Dopl has not appointed a data protection officer or a representative in the European Union or United Kingdom. [TODO: appoint a GDPR Art. 27 / UK GDPR Art. 27 representative if use by EEA or UK residents becomes more than occasional.]

### 1.3. Eligibility

The Services are intended only for individuals at least 18 years old.

---

## 2. Personal Information Dopl Collects

### 2.1. Account Information

Dopl collects the email address, display name, and password (stored only as a salted hash by Dopl's authentication subcontractor) You provide to register, and any optional profile information You add, including a profile photo, biography, website, X handle, and GitHub username. Dopl also collects Your responses to onboarding questions.

### 2.2. Sign-In Information

If You sign in with Google or GitHub, Dopl receives Your name, email address, profile photo, and account identifier from that provider. Dopl does not receive Your Google or GitHub password.

### 2.3. Content

Dopl collects Content that You, Your Agents, and other Members provide to the Services, including messages, threads, tasks, artifacts, knowledge entries, skills, ontology objects, saved chats, and Workspace names, icons, and settings, together with their revision history. Content provided by other Members may include Personal Information about You.

### 2.4. Workspace Information

Dopl collects information about the Workspaces and Channels You belong to, Your role, invitations You send or receive (including invitees' email addresses), join requests, and Membership changes.

### 2.5. Agent Session Information

When Agents run in the Services, the Desktop App transmits to Dopl each session's Agent name, status, AI runtime and model, Channel, and activity and usage metrics. Messages that Agents post to Channels are stored as Content.

### 2.6. MCP Activity

When an Agent or Connected Client calls the Dopl MCP Server, Dopl records the tool called, the arguments supplied (which may include Content), a summary of the result, timing, and errors, together with Credit usage. For each Connected Client You authorize, Dopl stores the authorization and the access tokens issued to it.

### 2.7. Billing Information

Stripe, Inc. processes payments. Dopl receives Your Stripe customer and subscription identifiers, Plan, Seat count, billing status, and billing dates. Dopl does not receive or store full payment card numbers.

### 2.8. Glasses Voice Data

If You pair Glasses with the Services and ask a question by voice, the Glasses transmit an audio recording of the question to Dopl. Dopl transmits the recording to a transcription subcontractor and processes the resulting text as Content. [TODO: confirm that audio is not retained after transcription.]

### 2.9. Device and Technical Information

Dopl collects:

(a) for the Desktop App, an installation identifier, device name, macOS version, application version, processor architecture, and time of last activity;

(b) through Dopl's hosting and database subcontractors, IP addresses, browser type, and request details; and

(c) through the download servers that deliver Desktop App and AI runtime updates (GitHub, the npm registry, and, for runtimes You select, xAI or Meta), the IP address of the requesting device.

### 2.10. Usage Information

Dopl collects information about Your use of the Services, including features used, sign-ins, sign-ups, Plan changes, and errors. Dopl collects this information with its own tools and does not use third-party analytics or advertising services.

### 2.11. Correspondence

Dopl retains correspondence You send to Dopl, including attachments.

### 2.12. Information Dopl Does Not Collect

(a) **AI Provider Credentials.** The Desktop App stores the credentials You use to sign in to AI Providers on Your computer, encrypted with the macOS Keychain where available. Dopl's servers do not receive them.

(b) **Agent Working History.** The Desktop App stores each Agent's tool calls and results on Your computer for 7 days. Dopl's servers receive only the information described in Sections 2.5 and 2.6 and the Content an Agent posts to the Services.

(c) **Dictation Audio.** Dictation in the Desktop App uses Apple's on-device speech recognition. The audio does not leave Your computer.

(d) **Sensitive Information.** Dopl does not request health, biometric, financial account, government identification, or precise geolocation information. Any such information You include in Content is processed as Content.

---

## 3. AI Providers

### 3.1. Your AI Providers

Agents use AI Providers that You select, under accounts You hold with them. The Desktop App transmits prompts, and any Content an Agent reads (including Content that other Members provided in a Shared Space), directly from Your computer to that AI Provider. Each AI Provider, and each Connected Client, processes that information under its own terms and privacy policy, and not as Dopl's subcontractor.

### 3.2. Shared Spaces

Content You provide in a Shared Space may be read by Agents of other Members and transmitted to the AI Providers those Members select.

### 3.3. Dopl's AI Subcontractors

Dopl uses OpenAI to generate search indexes (embeddings) of knowledge base Content, and OpenAI or Groq to transcribe Glasses voice data. Each acts as Dopl's subcontractor under business terms that prohibit use of Dopl's data to train its models.

### 3.4. No Model Training

Dopl does not use Content, or inputs to or Output of Agents, to train artificial intelligence models.

---

## 4. Purposes of Processing

Dopl processes Personal Information to:

(a) **provide the Services**, including registering Dopl Accounts, operating Workspaces and Channels, storing and displaying Content, routing messages to Agents, synchronizing with the Desktop App and Glasses, and providing search;

(b) **process payments**, manage Plans and Seats, and measure Credit usage;

(c) **secure the Services**, enforce Credit and rate limits, detect and prevent abuse, and investigate violations of the Agreement;

(d) **provide support** and resolve problems;

(e) **maintain and improve the Services** using usage and technical information. Dopl accesses Content for this purpose only as necessary to resolve a specific problem that You report or that Dopl detects;

(f) **communicate with You**, including account confirmation and password reset emails and service, security, and billing notices; and

(g) **comply with Law**, respond to lawful requests, maintain required records, and establish, exercise, or defend legal claims.

Dopl does not process Personal Information for advertising and does not make decisions based solely on automated processing that produce legal or similarly significant effects on individuals.

---

## 5. Legal Bases (EEA, United Kingdom, and Switzerland)

For individuals in the EEA, the United Kingdom, and Switzerland, Dopl relies on the following legal bases under Article 6 of the GDPR and the corresponding provisions of the UK GDPR and the Swiss Federal Act on Data Protection:

| Purpose | Legal basis |
|---|---|
| Sections 4(a) and 4(b) | Performance of a contract (Art. 6(1)(b)) |
| Section 4(d) | Performance of a contract and legitimate interests in resolving issues (Art. 6(1)(b), (f)) |
| Sections 4(c) and 4(e) | Legitimate interests in operating a secure and functioning service, limited to information that is necessary (Art. 6(1)(f)) |
| Content concerning other individuals provided by Members in Shared Spaces | Legitimate interests of Members and Dopl in collaboration (Art. 6(1)(f)) |
| Section 4(f) | Performance of a contract and legitimate interests (Art. 6(1)(b), (f)) |
| Section 4(g) | Compliance with a legal obligation (Art. 6(1)(c)) |

Individuals may object to processing based on legitimate interests under Section 11.

---

## 6. Disclosures of Personal Information

### 6.1. No Sale or Sharing

Dopl does not sell Personal Information and does not disclose Personal Information for cross-context behavioral advertising.

### 6.2. Members and Agents

Content provided in a Shared Space is available to its Members and the Agents they run there. Workspace Admins may view member lists, roles, and Workspace Content. Your display name and profile photo are visible to individuals with whom You share a Workspace or Channel. Saved chats marked public are available to the Members of their Workspace. Workspace icons and thumbnails are stored at public web addresses accessible to anyone with the address.

### 6.3. Subcontractors

Dopl discloses Personal Information to the following subcontractors, which process it on Dopl's behalf under written agreements and only to provide their services to Dopl:

| Subcontractor | Service | Personal Information | Location | Privacy policy |
|---|---|---|---|---|
| Supabase, Inc. | Database, authentication, file storage, real-time messaging | All information stored in the Services | United States | supabase.com/privacy |
| Vercel Inc. | Website and server hosting | Requests to the website and API, including IP addresses | United States and global edge network | vercel.com/legal/privacy-policy |
| Stripe, Inc. | Payment processing and billing portal | Email address, payment details entered with Stripe, Plan and Seat information | United States | stripe.com/privacy |
| OpenAI, L.L.C. | Search indexing; Glasses transcription | Knowledge base Content; Glasses voice data | United States | openai.com/policies/privacy-policy |
| Groq, Inc. | Glasses transcription | Glasses voice data | United States | groq.com/privacy-policy |
| GitHub, Inc. | Sign-in; Desktop App and runtime downloads | Sign-in information; IP addresses | United States | docs.github.com/site-policy/privacy-policies |
| Google LLC | Sign-in | Sign-in information | United States | policies.google.com/privacy |

### 6.4. Third-Party Services You Select

AI Providers, Connected Clients, Glasses manufacturers, and other Third-Party Services that You or Your Agents use receive information directly from You or Your devices under their own terms, as described in Section 3.

### 6.5. Legal Requirements

Dopl may disclose Personal Information if Dopl believes in good faith that disclosure is necessary to comply with Law or legal process, enforce the Agreement, prevent fraud or address security or technical issues, or protect the rights, property, or safety of Dopl, its users, or the public. Where Law permits and it is reasonable to do so, Dopl will notify the affected individual before disclosing Personal Information in response to a legal request.

### 6.6. Business Transfers

Dopl may transfer Personal Information to an entity Dopl forms to operate the Services, or in connection with a merger, acquisition, financing, reorganization, or sale of assets. Dopl will notify You before Personal Information becomes subject to a different privacy policy.

### 6.7. Consent

Dopl may disclose Personal Information in other circumstances at Your direction or with Your consent.

---

## 7. Cookies and Similar Technologies

### 7.1. Strictly Necessary Technologies

Dopl uses only the following strictly necessary technologies:

| Technology | Purpose | Provider | Duration |
|---|---|---|---|
| Authentication cookies (`sb-…`) | Maintain signed-in sessions | Supabase, on Dopl's behalf | Until sign-out or expiry |
| `dopl-login-bounce` cookie | Prevent sign-in redirect loops | Dopl | Short-lived |
| Browser local storage | Retain interface preferences | Dopl | Until cleared |

### 7.2. Google Sign-In

If You use Google One Tap sign-in, Google may set its own cookies under Google's privacy policy.

### 7.3. No Advertising or Analytics Cookies

Dopl does not use advertising or analytics cookies, and therefore does not display a cookie consent banner.

### 7.4. Do Not Track and Global Privacy Control

Dopl does not sell or share Personal Information for advertising. Dopl treats a Global Privacy Control signal as a valid opt-out request under applicable Law.

---

## 8. International Transfers

Dopl is located in the United States, and its subcontractors store and process Personal Information primarily in the United States. Personal Information of individuals outside the United States is transferred to the United States. For transfers from the EEA, the United Kingdom, or Switzerland, Dopl relies on its subcontractors' Standard Contractual Clauses (with the UK International Data Transfer Addendum) or certification under the EU-U.S. Data Privacy Framework and its UK and Swiss extensions, as applicable. Dopl will provide a copy of the relevant safeguards upon request.

---

## 9. Retention

### 9.1. Schedule

| Personal Information | Retention period |
|---|---|
| Account information | Until the Dopl Account is deleted |
| Content | Until deleted by You or a Workspace Admin, or until the Dopl Account is deleted, subject to Section 10.1(e) |
| Guest (Playground) accounts | Deleted automatically approximately 10 minutes after the session |
| Agent session information | For the life of the related Channel |
| MCP activity records | [TODO before publishing: implement] 90 days, after which they are deleted. On deletion of a Dopl Account, arguments and result summaries in that account's records are deleted |
| Credit and usage records | Until the Dopl Account is deleted, then retained only in de-identified form |
| Billing records | As required for tax and accounting purposes, generally up to 7 years |
| Correspondence | Up to 3 years |
| Agent working history (on Your computer) | 7 days |
| Backups | [TODO: confirm Supabase backup retention] Overwritten within [7] days |

### 9.2. De-Identified Information

Dopl may retain information that has been de-identified so that it can no longer reasonably be linked to an individual, and will not attempt to re-identify it.

---

## 10. Account Deletion

### 10.1. Effect of Deletion

When You delete Your Dopl Account under Section 2.6 of the Agreement:

(a) Dopl immediately deletes Your account, profile, and Content linked only to You from its production database, and cancels each Plan You pay for;

(b) Dopl deletes thumbnail images You uploaded;

(c) Dopl retains usage records only in de-identified form;

(d) copies in backups are overwritten under Section 9.1;

(e) Content You provided in Workspaces that other Members continue to use may remain available to those Members [TODO: confirm whether such Content is deleted, retained with attribution, or retained without attribution, and state the result]; and

(f) Dopl retains records that Law requires, such as billing records, under Section 9.1.

### 10.2. Workspace Ownership

If You own a Workspace that has other Members, You must transfer ownership or remove the other Members before deleting Your Dopl Account.

---

## 11. Individual Rights

### 11.1. Rights

Subject to Law, each individual may request that Dopl:

(a) provide access to Personal Information Dopl holds about the individual;

(b) correct inaccurate Personal Information;

(c) delete Personal Information;

(d) provide Personal Information in a portable format;

(e) restrict, or cease, processing based on legitimate interests; and

(f) where processing is based on consent, cease processing upon withdrawal of consent.

### 11.2. Requests

Requests must be sent to build@usedopl.com from the email address associated with the relevant Dopl Account, where one exists. Dopl will verify the requester's identity using only the information necessary. Dopl will respond within 30 days, or within 45 days where the CCPA or another U.S. state Law applies, and may extend that period once where Law permits. An authorized agent may submit a request on an individual's behalf with proof of authority. Dopl will not discriminate against any individual for exercising these rights.

### 11.3. Appeals and Complaints

An individual may appeal a decision on a request by replying to Dopl's decision with "Appeal" in the subject line, and Dopl will respond within the period Law requires. An individual may also lodge a complaint with the competent data protection authority.

### 11.4. Content Provided by Others

An individual concerned about Personal Information that a Member provided in a Workspace may contact Dopl at build@usedopl.com, and Dopl will work with the relevant Workspace to address the concern.

### 11.5. Information on Your Computer

Information stored only on Your computer, including AI Provider credentials and Agent working history, is under Your control. You may remove it by signing out of AI Providers in the Desktop App, or by uninstalling the Desktop App and deleting its data folder.

---

## 12. Security

Dopl maintains reasonable administrative, technical, and physical safeguards, including encryption in transit (TLS), encryption at rest provided by Dopl's database subcontractor, row-level access controls that limit each Workspace's data to its Members, and encrypted local storage of AI Provider credentials. No system is completely secure. Dopl will notify affected individuals and Governmental Authorities of a breach of Personal Information as Law requires.

---

## 13. Children

The Services are not directed to individuals under 18, and Dopl does not knowingly collect Personal Information from individuals under 18. Any person who believes a minor has provided Personal Information to Dopl may notify build@usedopl.com, and Dopl will delete it.

---

## 14. Communications

### 14.1. Email

Dopl sends account confirmation and password reset emails and service, security, and billing notices. Dopl does not currently send marketing email. If Dopl begins to do so, it will obtain consent where Law requires and include an unsubscribe mechanism in each message.

### 14.2. Notifications

The Desktop App may display system notifications for Channel activity. You may disable notifications for each Channel, in the Desktop App's settings, or in macOS System Settings.

---

## 15. California

### 15.1. Categories Collected

During the preceding 12 months, Dopl collected the following categories of Personal Information as defined in the CCPA:

| CCPA category | Examples | Collected |
|---|---|---|
| A. Identifiers | Name, email address, account identifier, IP address, installation identifier | Yes |
| B. Customer records (Cal. Civ. Code § 1798.80(e)) | Name, email address; payment details are handled by Stripe | Yes |
| C. Protected classifications | — | No |
| D. Commercial information | Plan, Seats, billing history, Credits | Yes |
| E. Biometric information | — | No |
| F. Internet or network activity | Use of the Services, MCP activity records | Yes |
| G. Geolocation | Approximate location derived from IP address | Yes (approximate) |
| H. Audio or similar information | Glasses voice data | Yes, if Glasses are used |
| I. Professional information | Information included in a profile or Content | Only as provided |
| J. Education information | — | No |
| K. Inferences | — | No |
| L. Sensitive personal information | Account credentials; contents of messages in the Services of which Dopl is not the intended recipient | Yes |

### 15.2. Sources, Purposes, Recipients, and Retention

Dopl collects Personal Information from individuals, their devices, other Members, and Google, GitHub, and Stripe, for the purposes in Section 4. Dopl discloses Personal Information for business purposes to the subcontractors in Section 6.3, and retains it as described in Section 9.

### 15.3. Sensitive Personal Information

Dopl uses sensitive personal information only for purposes permitted under Cal. Code Regs. tit. 11, § 7027(m), and therefore does not offer a right to limit its use.

### 15.4. No Sale or Sharing

Dopl does not sell or share Personal Information as those terms are defined in the CCPA, has not done so in the preceding 12 months, and does not knowingly sell or share Personal Information of consumers under 16.

### 15.5. Rights

California residents have the right to know, access, correct, delete, and port their Personal Information; to opt out of sale and sharing; to limit the use of sensitive personal information; and not to be discriminated against for exercising these rights. Requests are handled under Section 11.

### 15.6. Shine the Light

Dopl does not disclose Personal Information to third parties for their own direct marketing purposes.

---

## 16. Other U.S. States

### 16.1. Rights

Residents of U.S. states with comprehensive privacy Laws, including Colorado, Connecticut, Delaware, Indiana, Iowa, Kentucky, Maryland, Minnesota, Montana, Nebraska, New Hampshire, New Jersey, Oregon, Rhode Island, Tennessee, Texas, Utah, and Virginia, may have rights to access, correct, delete, and port their personal data, and to opt out of targeted advertising, sale, and certain profiling. Dopl does not sell personal data, engage in targeted advertising, or engage in profiling that produces legal or similarly significant effects. Requests and appeals are handled under Section 11.

### 16.2. Nevada

Nevada residents may submit a request regarding the sale of covered information to build@usedopl.com with "Nevada Opt-Out" in the subject line. Dopl does not sell covered information.

---

## 17. EEA, United Kingdom, and Switzerland

Individuals in the EEA, the United Kingdom, and Switzerland have the rights stated in Articles 15 through 22 of the GDPR and the corresponding provisions of the UK GDPR and the Swiss Federal Act on Data Protection, including the rights of access, rectification, erasure, restriction, portability, and objection, the right not to be subject to solely automated decisions with significant effects, and the right to withdraw consent. Legal bases are stated in Section 5 and transfer safeguards in Section 8. Complaints may be lodged with the competent supervisory authority, including an EEA authority listed at edpb.europa.eu, the UK Information Commissioner's Office (ico.org.uk), or the Swiss Federal Data Protection and Information Commissioner (edoeb.admin.ch).

---

## 18. Other Jurisdictions

The rights in Section 11 are available to all individuals. Law in other jurisdictions may provide additional rights and the right to complain to a regulator, including the Office of the Privacy Commissioner of Canada and Quebec's Commission d'accès à l'information, Brazil's Autoridade Nacional de Proteção de Dados, the Office of the Australian Information Commissioner, New Zealand's Office of the Privacy Commissioner, Japan's Personal Information Protection Commission, Korea's Personal Information Protection Commission, India's Data Protection Board, and South Africa's Information Regulator.

---

## 19. Changes to this Policy

Dopl may update this Policy by publishing the updated version and amending the "Last updated" date. For material changes, Dopl will provide notice through the Services or by email before the changes take effect. Dopl will provide prior versions upon request.

---

## 20. Contact

> Dopl
> Attn: Samuel Wang
> 2603 California Street
> San Francisco, CA, United States
> build@usedopl.com

---

## Appendix 1 (Definitions)

"**CCPA**" means the California Consumer Privacy Act of 2018, as amended by the California Privacy Rights Act, Cal. Civ. Code § 1798.100 et seq., and its implementing regulations.

"**GDPR**" means Regulation (EU) 2016/679.

"**Personal Information**" means information that identifies, relates to, or could reasonably be linked with an identified or identifiable individual, and includes "personal data" under the GDPR and "personal information" under the CCPA.

"**UK GDPR**" means the GDPR as retained in the law of the United Kingdom.

All other capitalized terms have the meanings given in the Agreement.
