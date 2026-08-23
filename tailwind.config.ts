import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fbf7f4",
          100: "#f4e9e1",
          200: "#e6cebb",
          300: "#d5ac8d",
          400: "#c28a63",
          500: "#a86e46",
          600: "#8a5738",
          700: "#6d4530",
          800: "#4f3223",
          900: "#332016",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
