/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'pz-dark': '#0f1117',
        'pz-darker': '#080b0f',
        'pz-card': '#161b22',
        'pz-border': '#21262d',
        'pz-green': '#4ade80',
        'pz-green-dark': '#16a34a',
        'pz-red': '#f87171',
        'pz-red-dark': '#dc2626',
        'pz-yellow': '#fbbf24',
        'pz-blue': '#60a5fa',
        'pz-text': '#e6edf3',
        'pz-muted': '#8b949e',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
