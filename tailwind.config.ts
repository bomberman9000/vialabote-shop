import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f7f7fb",
          100: "#eceef6",
          200: "#d3d8ea",
          300: "#a9b3d1",
          400: "#7885b3",
          500: "#4f5c8f",
          600: "#333f6e",
          700: "#232c54",
          800: "#181f40",
          900: "#10152c",
        },
        gold: {
          50: "#fbf8f0",
          100: "#f3e9cf",
          200: "#e6d3a3",
          300: "#d6b96f",
          400: "#c9a24a",
          500: "#b8893a",
          600: "#96702f",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
