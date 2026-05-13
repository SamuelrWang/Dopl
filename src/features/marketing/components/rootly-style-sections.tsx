import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Flag,
  GitPullRequest,
  MessageSquare,
  Puzzle,
  Rocket,
  Shield,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";

export function AISREMock() {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-200 via-violet-100 to-amber-100 p-8 shadow-[0_30px_80px_-30px_rgba(80,60,130,0.4)]">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-4">
          <div className="flex items-center gap-2">
            <Flag size={16} className="text-neutral-700" />
            <span className="text-[15px] font-semibold text-neutral-900">
              Root Cause Analysis
            </span>
          </div>
          <span className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700">
            Confidence: High
            <span className="flex gap-0.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-sm bg-emerald-500"
                />
              ))}
            </span>
          </span>
        </div>
        <ul className="mt-4 space-y-2 text-[14px] text-neutral-700">
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
            <span>
              Payment authorization requests were missing the{" "}
              <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">
                X-PAY-AUTH
              </code>{" "}
              header.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
            <span>
              <GitPullRequest
                size={12}
                className="mr-1 inline text-neutral-500"
              />
              PR #842 introduced the issue by refactoring request-building
              logic.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
            <span>Staging tests did not validate real provider headers.</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
            <span>Monitoring thresholds delayed alerting, slowing detection.</span>
          </li>
        </ul>
        <div className="mt-5 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 text-[12px]">
          <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-3 py-2 font-mono text-neutral-600">
            <span>config/featureFlags.ts</span>
            <span className="text-neutral-400">15 lines</span>
          </div>
          <pre className="m-0 p-3 font-mono text-neutral-700">
{`  22  22    "X-Request-ID": sessionId,
  23  23    "X-Trace-ID": traceId,
- 24       "X-PAY-AUTH": paymentToken,
  25  24    "Content-Type": "application/json",`}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function OnCallMock() {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-100 via-rose-100 to-violet-100 p-8 shadow-[0_30px_80px_-30px_rgba(80,60,130,0.4)]">
      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-lg">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[14px] font-semibold text-neutral-900">
              Schedule · Week
            </span>
            <span className="text-[12px] text-neutral-500">May 2026</span>
          </div>
          <div className="grid grid-cols-5 gap-2 text-[11px]">
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => (
              <div key={d}>
                <div className="mb-1.5 text-neutral-500">{d}</div>
                <div
                  className={`h-20 rounded-md ${
                    i === 2
                      ? "bg-violet-200"
                      : i === 3
                        ? "bg-amber-200"
                        : "bg-neutral-100"
                  }`}
                />
                <div className="mt-1 text-[10px] text-neutral-500">
                  09:00 — 17:00
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-neutral-900 p-5 text-white shadow-2xl">
          <div className="text-[13px] font-semibold">You&apos;re on-call</div>
          <div className="mt-3 rounded-lg bg-neutral-800 p-3">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400">
              Primary rotation
            </div>
            <div className="mt-1 text-[14px] font-medium">
              Until Friday, May 17
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <Stat label="Coverage requests" value="2" />
            <Stat label="Ongoing alerts" value="4" />
            <Stat label="Ongoing incidents" value="1" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-neutral-800 p-3 text-[11px]">
            <div>
              <div className="text-neutral-400">Time to ack</div>
              <div className="mt-0.5 text-[18px] font-semibold">4:32m</div>
            </div>
            <div>
              <div className="text-neutral-400">Time to resolve</div>
              <div className="mt-0.5 text-[18px] font-semibold">20:32m</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-neutral-800 px-3 py-2 text-[12px]">
      <span className="text-neutral-300">{label}</span>
      <span className="rounded-md bg-neutral-700 px-2 py-0.5 text-[11px] font-semibold">
        {value}
      </span>
    </div>
  );
}

export function AlertingMock() {
  const alerts = [
    {
      tag: "#CjdDtD",
      title: "PgBouncerUp stage ewr kube-vault-sync critical",
      status: "Triggered",
      severity: "High",
      ago: "30 mins ago",
      color: "rose",
      icon: Shield,
    },
    {
      tag: "#JDKTDV",
      title: "Error rate exceeded threshold in payment-service",
      status: "Acknowledged",
      severity: "Medium",
      ago: "43 mins ago",
      color: "amber",
      icon: AlertTriangle,
    },
    {
      tag: "#PLzQmX",
      title: "CPU utilization above 90% on node-pool-03 for 15 mins",
      status: "Resolved",
      severity: "High",
      ago: "1 hour ago",
      color: "emerald",
      icon: CheckCircle2,
    },
    {
      tag: "#XaVpKc",
      title: "Possible memory leak detected in user-service",
      status: "Triggered",
      severity: "High",
      ago: "12 mins ago",
      color: "rose",
      icon: Bell,
    },
  ] as const;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-200 via-violet-100 to-orange-100 p-8 shadow-[0_30px_80px_-30px_rgba(80,60,130,0.4)]">
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-lg">
        {alerts.map((a, i) => (
          <div
            key={a.tag}
            className={`flex items-start gap-4 px-5 py-4 ${
              i < alerts.length - 1 ? "border-b border-neutral-100" : ""
            }`}
          >
            <a.icon
              size={18}
              className={
                a.color === "rose"
                  ? "text-rose-500"
                  : a.color === "amber"
                    ? "text-amber-500"
                    : "text-emerald-500"
              }
            />
            <div className="flex-1">
              <div className="text-[14px] font-medium text-neutral-900">
                <span className="font-mono text-neutral-500">{a.tag}</span>{" "}
                {a.title}
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-neutral-500">
                <span
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                    a.color === "rose"
                      ? "bg-rose-50 text-rose-700"
                      : a.color === "amber"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {a.status}
                </span>
                <span>{a.severity}</span>
                <span>· {a.ago}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function IncidentResponseMock() {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-200 via-rose-100 to-amber-100 p-8 shadow-[0_30px_80px_-30px_rgba(80,60,130,0.4)]">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-lg">
        <div className="border-b border-neutral-100 pb-3">
          <div className="font-mono text-[14px] font-semibold text-neutral-900">
            #incident-checkout-failures
          </div>
        </div>
        <div className="mt-4 space-y-4 text-[14px]">
          <Message
            author="Dopl"
            badge="APP"
            time="1:45 PM"
            body={
              <>
                <div className="font-semibold text-neutral-900">
                  Checkout failures — customers unable to complete purchase
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionPill icon={Sparkles} label="Update" />
                  <ActionPill icon={Wrench} label="Action items" />
                  <ActionPill icon={Bell} label="Assign roles" />
                  <ActionPill icon={Zap} label="Escalate" />
                </div>
              </>
            }
          />
          <Message
            author="Allen"
            time="1:45 PM"
            body="We're seeing a spike in failures over the past ~30 minutes. Customers are getting stuck on the checkout 'Place order' step."
          />
          <Message
            author="Florence"
            time="1:46 PM"
            body={
              <>
                <span className="text-violet-700">@Dopl</span> looks familiar.
                Are there any related incidents open right now?
              </>
            }
          />
          <Message
            author="Dopl"
            badge="APP"
            time="1:46 PM"
            body={
              <>
                <span className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">
                  #incident-payment-gateway-timeouts
                </span>{" "}
                was opened at 1:10 PM.
                <ul className="mt-2 space-y-1 text-[13px] text-neutral-700">
                  <li>
                    <span className="font-semibold">Status:</span> Investigating;
                    elevated checkout failure rate.
                  </li>
                  <li>
                    <span className="font-semibold">Suspected cause:</span>{" "}
                    Upstream payment provider timeouts after deploy v2026.05.13.
                  </li>
                </ul>
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}

function Message({
  author,
  badge,
  time,
  body,
}: {
  author: string;
  badge?: string;
  time: string;
  body: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="h-9 w-9 shrink-0 rounded-lg bg-gradient-to-br from-violet-400 to-violet-600" />
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-neutral-900">
            {author}
          </span>
          {badge && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
              {badge}
            </span>
          )}
          <span className="text-[11px] text-neutral-500">{time}</span>
        </div>
        <div className="mt-1 text-neutral-700">{body}</div>
      </div>
    </div>
  );
}

function ActionPill({
  icon: Icon,
  label,
}: {
  icon: typeof Sparkles;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700">
      <Icon size={12} />
      {label}
    </span>
  );
}

const PHILOSOPHY = [
  {
    icon: Zap,
    title: "Opinionated defaults",
    body: "Responders are guided by proven best practices — simple, intuitive, and carefully crafted.",
  },
  {
    icon: Wrench,
    title: "Purpose-built",
    body: "Designed to prevent and resolve issues faster. We only ship what serves that mission.",
  },
  {
    icon: Shield,
    title: "Rooted in reliability",
    body: "We obsess over the boring work so you can count on us when you're down.",
  },
  {
    icon: Rocket,
    title: "Scales as you do",
    body: "Built to grow with you — simple at any size. Loved by fast-growing startups and the Fortune 500.",
  },
];

export function PhilosophyGrid() {
  return (
    <>
      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PHILOSOPHY.map((p) => (
          <div
            key={p.title}
            className="rounded-2xl bg-violet-50/50 p-6 transition-colors hover:bg-violet-50"
          >
            <p.icon size={22} className="text-neutral-900" />
            <h3 className="mt-5 text-[18px] font-semibold text-neutral-900">
              {p.title}
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed text-neutral-600">
              {p.body}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-6 rounded-2xl bg-violet-50/50 p-6 md:grid-cols-[1fr_1fr]">
        <div>
          <Puzzle size={22} className="text-neutral-900" />
          <h3 className="mt-5 text-[18px] font-semibold text-neutral-900">
            Extensible by design
          </h3>
          <p className="mt-3 max-w-[440px] text-[14px] leading-relaxed text-neutral-600">
            Connect all your existing tools — Slack, Jira, Zoom — and extend
            further with our Terraform provider, API, or MCP server.
          </p>
        </div>
        <div className="grid grid-cols-5 items-center gap-3">
          {[
            "Slack",
            "Datadog",
            "Atlassian",
            "Linear",
            "GitHub",
            "Teams",
            "Zoom",
            "Jira",
            "Sentry",
            "Notion",
          ].map((n) => (
            <div
              key={n}
              className="flex aspect-square items-center justify-center rounded-xl bg-white shadow-sm"
            >
              <MessageSquare size={18} className="text-neutral-700" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
