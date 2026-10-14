# Dopl Privacy Policy

**Last updated:** October 14, 2026
**Effective date:** [EFFECTIVE_DATE — the date this version is published at usedopl.com/privacy]

## At a glance

| Topic | Summary |
|---|---|
| Who we are | Samuel Wang, doing business as Dopl, San Francisco, California |
| What we collect | Your account details, the content you and your agents put in Dopl, billing records from Stripe, device and usage information, and voice questions from glasses if you connect them |
| What stays on your Mac | Your AI-provider sign-ins, your agents' working history, and dictation audio |
| Who we share it with | The people and agents you share with, and the service providers that run Dopl (Supabase, Vercel, Stripe, OpenAI, Groq, GitHub). Your agents send content to the AI provider *you* chose |
| What we don't do | We don't sell your personal information, show ads, use tracking cookies, or train AI models on your content |
| Your choices | Access, correct, export, or delete your information. Delete your account any time in settings |
| Contact | build@usedopl.com |

*This summary is for convenience only. The full policy below controls.*

---

## 1. About this policy

This Privacy Policy explains how **Samuel Wang, doing business as Dopl** (**"Dopl,"** **"we,"** **"us,"** or **"our"**) collects, uses, shares, and protects information about you when you use Dopl — the website at usedopl.com, the web app, the Dopl desktop app for macOS, the Dopl MCP server, and the Dopl glasses integration (together, the **"Service"**).

This policy describes our practices. It is not a contract. Your use of the Service is governed by our [Services Agreement](https://usedopl.com/terms).

The Service is for people **18 and older**.

---

## 2. Who we are

The **controller** of your personal information (the **"business"** under California law) is:

> **Samuel Wang, doing business as Dopl**
> 2603 California Street
> San Francisco, CA, United States
> build@usedopl.com

We have not appointed a Data Protection Officer or an EU or UK representative. [TODO: appoint an EU/UK Art. 27 representative if EU/UK use becomes more than occasional.]

---

## 3. The information we collect

### 3.1 Account and profile information *(You give us)*

Your email address, display name, password (stored only as a secure hash by our authentication provider), and any optional profile details you add, such as a profile photo, bio, website, X (Twitter) handle, and GitHub username. If you answer our onboarding questions, we keep your answers.

### 3.2 Sign-in information *(From third parties)*

If you sign in with **Google** or **GitHub**, we receive your name, email address, profile photo, and a unique account identifier from that provider. We never receive your Google or GitHub password.

### 3.3 Content you and your agents create *(You give us)*

Everything you or your agents put into Dopl, including:

- Channel messages, threads, tasks, reactions, and artifacts
- Knowledge bases and entries, skills, ontology objects and relationships, and their revision history
- Saved chats (summaries of an AI session, and optionally its full text)
- Workspace names, icons, and settings
- Messages, questions, and answers sent to or from connected glasses

When members of a shared workspace or channel post content, it may include information about you (for example, your name in a message).

### 3.4 Workspace and membership information *(You give us / Others give us)*

The workspaces and channels you belong to, your role, invitations you send or receive (including invitees' email addresses), join requests, and workspace activity such as members joining or leaving.

### 3.5 Agent and session information *(Collected automatically)*

When agents run in Dopl, the desktop app sends us information about each session so that channels can show it: the agent's name and status, the AI runtime and model it uses, the channel it is in, and activity and usage figures. Messages agents post to channels are stored like any other message.

### 3.6 MCP and API activity *(Collected automatically)*

When an agent or AI tool calls the Dopl MCP server, we log the call: which tool was used, the **arguments sent with it** (which can include content, such as the text of a message or knowledge entry), a short summary of the result, timing, and any error. We also keep records of credits used. If you connect an AI tool through OAuth, we store the connection and the access tokens issued to it.

### 3.7 Billing information *(From Stripe)*

Paid plans are processed by **Stripe**. We receive your Stripe customer and subscription identifiers, plan, seat count, billing status, and billing dates. **We do not receive or store your full card number.**

### 3.8 Glasses voice data *(You give us)*

If you connect smart glasses (currently Even Realities G2) and ask a question by voice, the glasses send us a recording of your question. We send that audio to a transcription provider (Section 7) to turn it into text, then use the text like any other message. [TODO: confirm whether glasses audio is kept after transcription; this policy assumes it is discarded once transcribed.]

### 3.9 Device and technical information *(Collected automatically)*

- **Desktop app:** an install identifier, device name, macOS version, app version, processor architecture, and when the app was last active
- **Web and server logs:** IP address, browser type, and request details, recorded by our hosting and database providers
- **Updates:** when the desktop app checks for updates or downloads AI runtimes, the download servers (GitHub, npm, and, if you choose those runtimes, xAI or Meta) receive your IP address

### 3.10 Usage information *(Collected automatically)*

How you use the Service — for example, which features you use, sign-ins, sign-ups, upgrades, and errors. We collect this with our own tools; we do not use third-party analytics or advertising services.

### 3.11 Support correspondence *(You give us)*

If you email us, we keep the conversation and anything you attach.

### 3.12 Information we do not collect

- **Your AI-provider credentials.** When you sign in to Claude, Codex, Grok, Muse, or Cursor from the desktop app, the credential is stored **on your Mac** (encrypted with the macOS Keychain where available). It is not sent to Dopl's servers.
- **Your agents' working history.** The step-by-step activity of an agent (its tool calls and their results) is stored on your Mac for 7 days and is not uploaded, except what the agent chooses to post in Dopl.
- **Dictation audio.** Dictation in the desktop app uses Apple's on-device speech recognition; the audio does not leave your Mac.
- **Sensitive categories.** We do not ask for health, biometric, financial-account, government ID, or precise location information. Please do not put such information in Dopl unless you need to; if you do, it is treated as Your Content.

---

## 4. How AI providers fit in

There are two different situations, and they work differently:

**Your agents and your AI providers.** Agents you run from the desktop app use an AI provider **you** choose — such as Anthropic (Claude), OpenAI (Codex), xAI (Grok), Meta (Muse), or Cursor — under **your own account** with that provider. Your Mac sends your prompts, and any Dopl content the agent reads (including content other members shared in that channel), **directly to that provider**. That provider handles the data under **its own** terms and privacy policy, as your service provider, not ours. The same applies to AI tools you connect to the Dopl MCP server (for example Claude Code or Cursor): content they read from Dopl goes to them under their terms.

This also means that, in a shared channel, **content you post may be read by other members' agents and sent to the AI providers those members use.**

**AI providers Dopl uses.** Dopl's own servers use **OpenAI** to create search indexes (embeddings) of knowledge-base content, and **OpenAI** or **Groq** to transcribe voice questions from glasses. These providers act as our service providers. We use their business APIs, under which they do not use our data to train their models.

**We do not train AI models on your content, and we do not sell your content to anyone.**

---

## 5. How we use information

| Purpose | What this means | Information used |
|---|---|---|
| **Provide the Service** | Create your account, run workspaces and channels, store and show your content, route messages to agents, sync with the desktop app and glasses, power search | Account, content, workspace, agent/session, MCP, glasses, device |
| **Billing** | Process payments, manage plans and seats, count credits | Billing, account, MCP and credit records |
| **Security and abuse prevention** | Protect accounts, enforce limits, detect misuse, investigate violations of our Services Agreement | Device, technical, usage, MCP logs |
| **Support** | Answer your questions and fix problems | Support correspondence, account, device, usage |
| **Improve the Service** | Understand which features are used, find bugs, measure performance. We do this with usage and technical information, not by reading your content, except when needed to fix a specific problem you report or that we detect | Usage, technical, MCP logs |
| **Communicate with you** | Send account emails (such as sign-up confirmation and password reset), service and security notices, and billing notices | Account |
| **Comply with law** | Respond to lawful requests, keep required records, establish or defend legal claims | Any, as needed |

We do not use your information for advertising, and we do not make decisions about you based solely on automated processing that have legal or similarly significant effects.

---

## 6. Legal bases (EEA, UK, and Switzerland)

If you are in the EEA, the UK, or Switzerland, we rely on these legal bases under GDPR Article 6 (and the UK GDPR and Swiss revFADP equivalents):

| Purpose | Legal basis |
|---|---|
| Providing the Service, billing | **Contract** (Art. 6(1)(b)) |
| Support | **Contract** and **legitimate interests** (Art. 6(1)(f)) in resolving issues |
| Security, abuse prevention, improving the Service | **Legitimate interests** (Art. 6(1)(f)) in running a secure, working product. We limit data to what is necessary |
| Processing content about other people that members post in shared spaces | **Legitimate interests** of the members and us in collaborating |
| Keeping records required by law | **Legal obligation** (Art. 6(1)(c)) |

You can object to processing based on legitimate interests — see [Section 12](#12-your-rights-and-choices).

---

## 7. How we share information

**We do not sell your personal information, and we do not share it for cross-context behavioural advertising.**

### 7.1 With the people and agents you choose

Content you post in a shared workspace or channel is visible to its members and to the agents they run there. Workspace owners and admins can see member lists, roles, and workspace content. Your display name and profile photo are visible to people you share a workspace or channel with. Saved chats marked public are visible to your workspace. Workspace icons and thumbnails are stored at public web addresses that anyone with the address can open.

### 7.2 With our service providers

These companies process information for us under contract, only to provide their services to us:

| Provider | What they do for us | Information they receive | Location | Privacy policy |
|---|---|---|---|---|
| **Supabase, Inc.** | Database, authentication, file storage, real-time messaging | All information stored in the Service | United States | <https://supabase.com/privacy> |
| **Vercel Inc.** | Website and server hosting | Requests to the website and API, including IP address | United States / global edge | <https://vercel.com/legal/privacy-policy> |
| **Stripe, Inc.** | Payment processing and billing portal | Your email, payment details (entered directly with Stripe), plan and seat information | United States | <https://stripe.com/privacy> |
| **OpenAI, L.L.C.** | Search indexing (embeddings); transcription of glasses voice questions | Knowledge-base text; glasses audio | United States | <https://openai.com/policies/privacy-policy> |
| **Groq, Inc.** | Transcription of glasses voice questions (alternative provider) | Glasses audio | United States | <https://groq.com/privacy-policy> |
| **GitHub, Inc.** | Sign-in (if you choose it); hosting desktop app downloads and updates | Sign-in details; IP address of downloads | United States | <https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement> |
| **Google LLC** | Sign-in (if you choose it) | Sign-in details | United States | <https://policies.google.com/privacy> |

The desktop app also downloads AI runtimes from the **npm registry** (operated by GitHub) and, if you choose them, from **xAI** and **Meta**; those servers receive your IP address.

### 7.3 With providers you choose

Your AI providers and connected AI tools, glasses manufacturers, and any services your agents access receive information directly from you or your devices, under their own terms — see [Section 4](#4-how-ai-providers-fit-in). They are not our service providers.

### 7.4 For legal reasons

We may disclose information if we believe in good faith that it is needed to comply with law or legal process, enforce our Services Agreement, protect against fraud, security, or technical issues, or protect the rights, property, or safety of us, our users, or the public. Where lawful and reasonable, we will tell you before disclosing your information in response to a legal request.

### 7.5 Business transfers

If Dopl is transferred to a company we form to run it, or is involved in a merger, acquisition, financing, or sale of assets, your information may be transferred as part of it. We will tell you before your information becomes subject to a different privacy policy.

### 7.6 With your consent

We may share information in other ways when you ask us to or agree.

---

## 8. Cookies and similar technologies

We use only **strictly necessary** cookies and browser storage:

| Cookie / storage | Purpose | Provider | Duration |
|---|---|---|---|
| Supabase authentication cookies (`sb-…`) | Keep you signed in | Supabase (first-party) | Session / until sign-out or expiry |
| `dopl-login-bounce` | Prevent sign-in redirect loops | Dopl | Short-lived |
| Local storage | Remember interface preferences | Dopl | Until cleared |

If you use **Google One Tap** sign-in, Google may set its own cookies under Google's policy. We do not use advertising or analytics cookies. Because we use only necessary cookies, we do not show a cookie banner.

**Do Not Track and Global Privacy Control.** We do not sell or share personal information for advertising, so there is nothing for these signals to opt you out of. We treat a Global Privacy Control signal as a valid opt-out request under applicable state law.

---

## 9. International data transfers

We are based in the United States, and our service providers store and process information mainly in the United States. If you use the Service from outside the U.S., your information will be transferred to the U.S. For transfers from the EEA, UK, or Switzerland, we rely on our providers' **Standard Contractual Clauses** (with the UK Addendum) or their certification under the **EU-U.S. Data Privacy Framework** and its UK and Swiss extensions, as applicable. Contact us for a copy of the relevant safeguards.

---

## 10. How long we keep information

| Information | How long |
|---|---|
| Account and profile | Until you delete your account |
| Your content | Until you or a workspace admin delete it, or you delete your account. Content you added to a workspace other people still use may remain there after you leave (see [Section 11](#11-deleting-your-account)) |
| Guest (Playground) accounts | Deleted automatically about 10 minutes after the session |
| Agent session information | While the related channel exists |
| MCP call logs (including arguments) | [TODO before publishing: implement] Up to 90 days, then deleted. When you delete your account, logs are separated from your account and their arguments and result summaries are deleted |
| Credit and usage records | While your account exists, then kept only in a form that does not identify you |
| Billing records | As long as required for tax and accounting (generally up to 7 years); Stripe keeps its own records under its policy |
| Support emails | Up to 3 years |
| Agent working history on your Mac | 7 days, on your Mac |
| Backups | [TODO: confirm Supabase backup retention for the project plan] Overwritten within [7] days |

---

## 11. Deleting your account

You can delete your account at any time from your account settings. When you do:

- Your account, profile, and the content linked only to you are **deleted immediately** from our production database, and any subscription you pay for is cancelled
- Images you uploaded as thumbnails are deleted
- Usage and analytics records are kept only with the link to your account removed
- Copies in backups are overwritten on our backup schedule ([Section 10](#10-how-long-we-keep-information))
- Messages and other content you posted in **workspaces that other members still use** may remain visible to those members. [TODO: confirm exact behaviour — whether such content is deleted, kept with your name, or kept anonymised — and state it here.]
- Records we must keep by law (such as billing records) are retained as described above

If you own a workspace that still has other members, you need to transfer ownership or remove them before you can delete your account. You can export your knowledge and other content before deleting.

---

## 12. Your rights and choices

Wherever you live, you can ask us to:

- **Access** the personal information we hold about you
- **Correct** inaccurate information (most of it you can edit yourself in settings)
- **Delete** your information (or delete your account yourself — [Section 11](#11-deleting-your-account))
- **Export** your information in a portable format
- **Object to** or **restrict** certain processing
- **Withdraw consent** where we rely on it

Email **build@usedopl.com** from your account email address. We may need to verify your identity, and we will ask for no more than we need. We respond within 30 days (45 days where California or other U.S. state law applies), and we may extend that once where the law allows. You may use an authorised agent; we may ask for proof of their authority. We will not discriminate against you for exercising your rights.

If we deny your request, you may appeal by replying to our decision with "Appeal" in the subject; we will respond within the time your law requires. You can also complain to your data-protection authority.

**Content about you posted by others.** If another member posted personal information about you in a workspace, contact us and we will work with the workspace to address it.

**Desktop-app data.** Information stored only on your Mac (such as AI-provider sign-ins and agent history) is under your control; you can remove it by signing out of providers in the app or uninstalling the app and deleting its data folder.

---

## 13. Security

We use reasonable safeguards, including encryption in transit (TLS), encryption at rest provided by our database host, row-level access controls that limit each workspace's data to its members, and encrypted local storage of AI-provider credentials on your Mac. No system is perfectly secure. If a breach affects your personal information, we will notify you and regulators as the law requires.

---

## 14. Children

The Service is **not for anyone under 18**, and we do not knowingly collect personal information from anyone under 18. If you believe a minor has given us personal information, email build@usedopl.com and we will delete it.

---

## 15. Notifications and emails

We send account emails (sign-up confirmation, password reset) and service, security, and billing notices. We do not currently send marketing email; if we start, we will ask for your consent where required and include an unsubscribe link. The desktop app can show system notifications for channel activity; you can turn them off per channel or in the app's settings, and in macOS System Settings.

---

## 16. Notice to California residents

This section supplements the rest of this policy for California residents under the California Consumer Privacy Act, as amended (CCPA), and the California Online Privacy Protection Act.

### 16.1 Categories collected in the past 12 months

| CCPA category | Examples | Collected? |
|---|---|---|
| A. Identifiers | Name, email, account ID, IP address, install ID | Yes |
| B. Customer records (Cal. Civ. Code § 1798.80(e)) | Name, email; payment details are handled by Stripe | Yes |
| C. Protected classifications | — | No |
| D. Commercial information | Plan, seats, billing history, credits | Yes |
| E. Biometric information | — | No |
| F. Internet or network activity | Usage of the Service, MCP call logs | Yes |
| G. Geolocation | Approximate location inferred from IP address only | Yes (approximate) |
| H. Audio or similar information | Glasses voice questions | Yes, if you use glasses |
| I. Professional information | Anything you choose to put in your profile or content | Only as you provide |
| J. Education information | — | No |
| K. Inferences | — | No |
| L. Sensitive personal information | Account sign-in credentials (password); content of messages in Dopl where we are not the intended recipient | Yes |

**Sources:** you, your devices, other members of your workspaces, and Google, GitHub, and Stripe. **Purposes:** those in [Section 5](#5-how-we-use-information). **Recipients:** our service providers in [Section 7.2](#72-with-our-service-providers), for business purposes. **Retention:** see [Section 10](#10-how-long-we-keep-information).

We use sensitive personal information only for purposes permitted by the CCPA regulations (to provide the Service, keep it secure, and comply with law), so we do not offer a "limit" right.

### 16.2 No sale or sharing

**We do not sell or share personal information** as those terms are defined in the CCPA, and we have not done so in the past 12 months. We do not knowingly sell or share personal information of consumers under 16.

### 16.3 Your rights

You have the right to know, access, correct, delete, and port your personal information, to opt out of sale or sharing (which we do not do), to limit use of sensitive personal information (which we use only as permitted), and not to be discriminated against for exercising these rights. To exercise them, see [Section 12](#12-your-rights-and-choices).

### 16.4 Shine the Light

We do not disclose personal information to third parties for their own direct-marketing purposes.

---

## 17. Notice to residents of other U.S. states

Residents of states with comprehensive privacy laws — including Colorado, Connecticut, Delaware, Indiana, Iowa, Kentucky, Maryland, Minnesota, Montana, Nebraska, New Hampshire, New Jersey, Oregon, Rhode Island, Tennessee, Texas, Utah, and Virginia — may have rights to access, correct, delete, and port their personal data, and to opt out of targeted advertising, sale, and certain profiling. **We do not sell personal data, engage in targeted advertising, or profile people in ways that produce legal or similarly significant effects.** To exercise your rights or appeal a decision, see [Section 12](#12-your-rights-and-choices).

**Nevada residents** may email build@usedopl.com with "Nevada Opt-Out" in the subject; we do not sell covered information.

---

## 18. Notice to EEA, UK, and Swiss residents

You have the rights in GDPR Articles 15–22 (and their UK and Swiss equivalents): access, rectification, erasure, restriction, portability, objection, and not to be subject to solely automated decisions with significant effects, plus the right to withdraw consent. Our legal bases are in [Section 6](#6-legal-bases-eea-uk-and-switzerland) and transfer safeguards in [Section 9](#9-international-data-transfers). You may complain to your local supervisory authority (EU list: <https://edpb.europa.eu/about-edpb/about-edpb/members_en>), the UK **Information Commissioner's Office** (<https://ico.org.uk/make-a-complaint/>), or the Swiss **FDPIC** (<https://www.edoeb.admin.ch/>).

---

## 19. Notice to residents of other countries

The rights in [Section 12](#12-your-rights-and-choices) are available to everyone. Depending on where you live, local law may give you further rights and a regulator to complain to — for example, the Office of the Privacy Commissioner of Canada (and, in Quebec, the Commission d'accès à l'information), Brazil's ANPD under the LGPD, the Office of the Australian Information Commissioner, New Zealand's Privacy Commissioner, Japan's Personal Information Protection Commission, Korea's Personal Information Protection Commission, India's Data Protection Board, or South Africa's Information Regulator.

---

## 20. Changes to this policy

We may update this policy. The "Last updated" date shows when. For material changes, we will notify you in the Service or by email before they take effect. Previous versions are available on request.

---

## 21. Contact us

- **Email:** build@usedopl.com
- **Mail:** Samuel Wang, d/b/a Dopl, 2603 California Street, San Francisco, CA, United States

---

## 22. Legal disclaimer

*This policy was prepared with reference to the GDPR, the UK GDPR, the Swiss revFADP, the California Consumer Privacy Act as amended by the CPRA, CalOPPA, the comprehensive privacy laws of other U.S. states in effect as of October 2026, COPPA, Brazil's LGPD, Canada's PIPEDA and Quebec Law 25, Australia's Privacy Act, and other applicable laws.*

*It is a starting point, **not a substitute for advice from a qualified attorney**. Before publishing, have it reviewed by privacy counsel.*

*Dopl is responsible for making sure this policy matches what the Service actually does. A mismatch is itself a privacy violation; please report any you spot to build@usedopl.com.*
