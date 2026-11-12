/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        // GridSentinel X runs on cool technical paper, not cream: white surfaces that lift by
        // value rather than shadow, hairline rules, and ink-dark type.
        //
        // Colour is rationed. Structure (navigation, buttons, focus) uses ink and one blue;
        // every other colour carries a meaning that is fixed across the whole console —
        // honest-labelled, theft-labelled, missing readings, simulated — so a reader never has
        // to relearn what a colour means between two pages.
        ground: "#F1F4F8",
        surface: "#FFFFFF",
        "surface-alt": "#F7F9FC",
        tint: "#EDF1F6",
        line: "#D4DCE6",
        "line-soft": "#E5EAF1",
        ink: "#141B26",
        "ink-2": "#4D5A6B",
        "ink-3": "#6B7A8D",

        // Text and icons drawn on top of a filled accent (a primary button, a solid badge).
        "on-accent": "#FFFFFF",

        // The navigation rail: a slightly deeper paper than the page, so it reads as a margin.
        rail: "#E9EEF5",
        "rail-2": "#FFFFFF",
        "rail-line": "#D0D9E5",
        "rail-text": "#46556A",
        "rail-muted": "#76859A",

        // Machine output (run logs, saved JSON) stays dark: it is quoted, not authored, and the
        // contrast makes a terminal legible at 11px.
        console: "#10161F",
        "console-2": "#1A2230",
        "console-line": "#27313F",
        "console-text": "#D4DBE4",
        "console-muted": "#7D8A9B",

        cobalt: "#0D5BB9",
        "cobalt-ink": "#0A4793",
        "cobalt-bg": "#E7F0FB",
        "cobalt-soft": "#F2F7FD",
        electric: "#1D6FD0",
        risk: "#BF2E1A",
        "risk-ink": "#8E2214",
        "risk-text": "#A32817",
        "risk-bg": "#FCEBE8",
        amber: "#A86400",
        "amber-ink": "#7A4900",
        "amber-bg": "#FBF1E0",
        ok: "#0F7045",
        "ok-bg": "#E6F4EE",
        violet: "#5B46B8",
        "violet-bg": "#EDEBFA",
        neutral: "#8A97A8",
      },
      fontFamily: {
        // Headings are set in the serif of the same superfamily as the body: this is a technical
        // report, and the serif says so without a second voice fighting the data.
        display: ["'IBM Plex Serif'", "Georgia", "serif"],
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        md: "6px",
        lg: "8px",
        xl: "10px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(20, 27, 38, 0.04)",
        raised: "0 2px 8px rgba(20, 27, 38, 0.07)",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        pulse: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.45" } },
      },
      animation: {
        "fade-up": "fade-up 240ms ease-out both",
        pulse: "pulse 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
