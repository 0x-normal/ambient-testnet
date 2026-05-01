import type { Config } from "tailwindcss";

/**
 * Design tokens ported from `open-design-page/index.html` (Linear/Lumen style).
 * Keep names aligned with CSS custom properties in globals.css.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          marketing: "#08090a",
          deepest: "#010102",
          panel: "#0f1011",
          surface3: "#191a1b",
          surface2: "#28282c",
        },
        ink: {
          primary: "#f7f8f8",
          secondary: "#d0d6e0",
          tertiary: "#8a8f98",
          quaternary: "#62666d",
        },
        brand: {
          DEFAULT: "#5e6ad2",
          accent: "#7170ff",
          hover: "#828fff",
        },
        line: {
          subtle: "rgba(255,255,255,0.05)",
          standard: "rgba(255,255,255,0.08)",
          primary: "#23252a",
          tint: "#141516",
        },
        fill: {
          1: "rgba(255,255,255,0.02)",
          2: "rgba(255,255,255,0.04)",
          3: "rgba(255,255,255,0.05)",
        },
        status: {
          green: "#27a644",
          emerald: "#10b981",
          amber: "#d4a13a",
          red: "#e5484d",
        },
      },
      fontFamily: {
        sans: [
          "Inter Variable",
          "Inter",
          "SF Pro Display",
          "-apple-system",
          "system-ui",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "Berkeley Mono",
          "ui-monospace",
          "SF Mono",
          "Menlo",
          "monospace",
        ],
      },
      borderRadius: {
        micro: "2px",
        comfortable: "6px",
        card: "8px",
        panel: "12px",
        large: "22px",
      },
      boxShadow: {
        elevated: "rgba(0,0,0,0.4) 0 2px 4px",
        ring: "rgba(0,0,0,0.2) 0 0 0 1px",
        focus: "rgba(0,0,0,0.1) 0 4px 12px",
      },
      letterSpacing: {
        display: "-0.04em",
        h1: "-0.022em",
      },
    },
  },
  plugins: [],
};

export default config;
