/** Static copy + data for the landing page. Cloned 1:1 from the reference
 *  layout; only the brand (Amigo → Dopl) and palette differ. */

export const NAV_LINKS = [
  "Platform",
  "Specialties",
  "Customers",
  "Guides",
  "Insights",
  "Company",
] as const;

export const NAV_PILL = {
  badge: "New",
  label: "The Platform Approach",
} as const;

export const CTA_LABEL = "Book a Demo";

export const HERO = {
  headline: "Where teams and agents work together",
  paragraph:
    "Make your care team feel 10x bigger while meeting the safety and reliability standards of healthcare.",
} as const;

export const DIAGRAM = {
  clinician: "Your Clinician",
  agent: "Dopl Clinical Agent",
  patient: "Patient 1",
  highlight: "Outbound Patient Engagement",
  capabilities: [
    "Cardiovascular Risk Monitoring",
    "Discharge & Transitions of Care",
    "PT Plan of Care Processing",
    "Pre-Op Preparation",
    "Post-Op Recovery",
    "PT Adherence",
    "Substance Use Disorder Support",
    "Mental Health Screening",
    "Side-Effect Management",
    "Patient-Provider Matching",
    "Outbound Patient Engagement",
    "Clinical Intake",
    "Appointment Management",
    "24/7 Health Assistant",
    "Urgent Care Triage",
    "Care Gap Closures",
    "Annual Wellness Visit Prep",
    "Chronic Care Management",
    "Medication Monitoring",
    "Patient Reactivation",
    "Lab and Biomarker Insights",
  ],
} as const;

export const TRUSTED_LABEL = "TRUSTED BY HEALTHCARE LEADERS WORLDWIDE";

export const LOGOS = [
  "SalvoHealth",
  "Juniper",
  "ViVim",
  "FAM",
  "ADAPTIC HEALTH",
  "Heal",
  "DispatchHealth",
] as const;

export const STATS = [
  { value: "100M+", label: "Patient encounters worldwide" },
  { value: "10x", label: "Increase in clinical capacity" },
  { value: "5x", label: "Return on investment" },
] as const;
