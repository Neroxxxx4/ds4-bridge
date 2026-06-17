/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
      colors: {
        surface: { DEFAULT: "#0f0f13", 1: "#16161d", 2: "#1c1c26", 3: "#24242f" },
        accent: { DEFAULT: "#6c63ff", dim: "#4e47c4" },
        ps: { blue: "#0066ff", cross: "#5bc8f5", circle: "#e84393", square: "#dc84f3", triangle: "#1bc49b" },
      },
      keyframes: {
        pulse_ring: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.4" } },
        slide_up: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        pulse_ring: "pulse_ring 2s ease-in-out infinite",
        slide_up: "slide_up 0.2s ease-out",
      },
    },
  },
};
