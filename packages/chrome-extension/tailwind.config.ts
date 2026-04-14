import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "bg-base": "var(--bg-base)",
        "bg-elevated": "var(--bg-elevated)",
        "bg-elevated-hover": "var(--bg-elevated-hover)",
        "bg-inset": "var(--bg-inset)",
        "bg-inset-hover": "var(--bg-inset-hover)",
        "bg-overlay": "var(--bg-overlay)",
        "border-subtle": "var(--border-subtle)",
        "border-default": "var(--border-default)",
        "border-strong": "var(--border-strong)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
        "accent-primary": "var(--accent-primary)",
        "accent-glow": "var(--accent-glow)",
        "accent-soft": "var(--accent-soft)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        paper: "#1a1a1a",
        coral: "#FF8C69",
        mint: "#9EFFBF",
        gold: "#F4D35E",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      borderRadius: {
        sm: "calc(0.625rem * 0.6)",
        md: "calc(0.625rem * 0.8)",
        lg: "0.625rem",
        xl: "calc(0.625rem * 1.4)",
      },
    },
  },
  plugins: [],
} satisfies Config;
