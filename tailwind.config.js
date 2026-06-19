/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Segoe UI Variable Text", "Segoe UI", "system-ui", "sans-serif"] },
      colors: {
        accent: { DEFAULT: "#D42E86", dim: "#bb2474" },
      },
    },
  },
};
