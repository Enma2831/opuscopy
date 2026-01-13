/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0b0d12",
        haze: "#f6f0ea",
        ember: "#ff6b4a",
        neon: "#24d4ff",
        moss: "#2f6f63"
      },
      boxShadow: {
        glow: "0 20px 80px rgba(36, 212, 255, 0.25)",
        ember: "0 20px 60px rgba(255, 107, 74, 0.25)"
      }
    }
  },
  plugins: []
};
