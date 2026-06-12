/** @type {import('tailwindcss').Config} */
// Catppuccin Mocha palette — https://catppuccin.com/palette
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Catppuccin Mocha base layers
        'pz-dark':    '#1e1e2e', // Base
        'pz-darker':  '#181825', // Mantle
        'pz-card':    '#313244', // Surface0
        'pz-border':  '#45475a', // Surface1

        // Accent — Mauve (purple)
        'pz-green':      '#cba6f7', // Mauve (primary accent, replaces green)
        'pz-green-dark': '#a57fdb', // Mauve darker

        // Status colors
        'pz-red':        '#f38ba8', // Red
        'pz-red-dark':   '#e06c8a',
        'pz-yellow':     '#f9e2af', // Yellow
        'pz-blue':       '#89b4fa', // Blue
        'pz-teal':       '#94e2d5', // Teal

        // Text
        'pz-text':  '#cdd6f4', // Text
        'pz-muted': '#6c7086', // Overlay0
        'pz-subtext': '#a6adc8', // Subtext0
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
