/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.ts"],
  theme: {
    extend: {
      colors: {
        paper: "#faf8f4",
        ink: "#2b2a28",
        muted: "#8a857d",
        hair: "#e5e0d8",
        open: "#5f7a5f",
        shut: "#a8836b",
      },
    },
  },
  plugins: [],
};
