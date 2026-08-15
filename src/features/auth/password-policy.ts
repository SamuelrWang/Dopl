/**
 * Password policy for surfaces that SET a password (sign-up + reset). Sign-in
 * never re-validates. ⚠ Single source — form UI, validation and error copy all
 * derive from here or they drift.
 */

export const PASSWORD_MIN_LENGTH = 10;

export type PasswordCheck = { id: string; label: string; met: boolean };

export type PasswordStrength = "weak" | "fair" | "good" | "strong";

export type PasswordEvaluation = {
  checks: PasswordCheck[];
  /** True only when every check passes. */
  valid: boolean;
  /** 0–4, for the strength meter. */
  score: number;
  strength: PasswordStrength;
};

export function evaluatePassword(pw: string): PasswordEvaluation {
  const checks: PasswordCheck[] = [
    { id: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: pw.length >= PASSWORD_MIN_LENGTH },
    { id: "upper", label: "An uppercase letter", met: /[A-Z]/.test(pw) },
    { id: "lower", label: "A lowercase letter", met: /[a-z]/.test(pw) },
    { id: "number", label: "A number", met: /[0-9]/.test(pw) },
    { id: "symbol", label: "A symbol", met: /[^A-Za-z0-9]/.test(pw) },
  ];
  const met = checks.filter((c) => c.met).length;
  const valid = met === checks.length;
  // Short password stays weak regardless of character-class count.
  const score = pw.length < PASSWORD_MIN_LENGTH ? Math.min(1, met) : Math.min(4, Math.max(0, met - 1));
  const strength: PasswordStrength =
    score <= 1 ? "weak" : score === 2 ? "fair" : score === 3 ? "good" : "strong";
  return { checks, valid, score, strength };
}

/** Error-banner line when a new password is rejected. */
export const PASSWORD_REQUIREMENT_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include an uppercase letter, a lowercase letter, a number, and a symbol.`;
