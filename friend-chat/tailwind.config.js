/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14181D",
        surface: "#1E242B",
        surface2: "#262D35",
        paper: "#F1EFEA",
        muted: "#8B939C",
        signal: "#3DDC97",
        signal2: "#2BB981",
        beacon: "#F4B740",
        danger: "#FF6B6B",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        sans: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        chip: "10px",
      },
    },
  },
  plugins: [],
};
