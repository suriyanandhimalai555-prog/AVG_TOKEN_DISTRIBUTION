import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        terminal: "var(--app-canvas)",
        surface: "var(--app-surface)",
        panel: "var(--app-panel)",
        border: "var(--app-border)",
        accent: "#3B82F6",
        "accent-light": "#60A5FA",
        "accent-dim": "var(--app-accent-dim)",
        "text-primary": "var(--app-text)",
        "text-secondary": "var(--app-text-secondary)",
        "text-muted": "var(--app-muted)",
        success: "#22C55E",
        warning: "#F59E0B",
        danger: "#EF4444",
        corp: {
          bg: "var(--app-canvas)",
          surface: "var(--app-surface)",
          elevated: "var(--app-panel)",
          text: "var(--app-text)",
          muted: "var(--app-muted)",
          secondary: "var(--app-text-secondary)",
          border: "var(--app-border)",
        },
      },      fontFamily: {
        /** UI body — Poppins regular/medium */
        sans: ["Poppins", "system-ui", "sans-serif"],
        /** Headlines / emphasis — same family, pair with font-semibold */
        display: ["Poppins", "system-ui", "sans-serif"],
        /** Supporting labels — same family, pair with font-medium or font-light */
        caption: ["Poppins", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        sm: "0.375rem",
        md: "0.5rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
      boxShadow: {
        card: "var(--app-shadow-card)",
      },      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.5s ease-out forwards",
        "slide-up": "slideUp 0.5s ease-out forwards",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(12px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
