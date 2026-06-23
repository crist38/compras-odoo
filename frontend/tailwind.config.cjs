/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f5f7ff',
          100: '#ebf0ff',
          200: '#d6e0ff',
          300: '#b3c7ff',
          400: '#85a3ff',
          500: '#5677fc', // Accent color
          600: '#3b51f5',
          700: '#2c3be0',
          800: '#2029b8',
          900: '#1a2094',
        },
        odoo: '#714B67', // Odoo color
      }
    },
  },
  plugins: [],
}
