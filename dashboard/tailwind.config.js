/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#F2F2F2',   // Primary text
          100: '#E6E8EA',
          200: '#C9CDD2',
          300: '#A9AFB7',
          400: '#8A8F98',  // Secondary text
          500: '#5E6AD2',  // Linear Purple Accent
          600: '#4D58B4',
          700: '#3A4493',
          800: '#2A306E',
          900: '#1A1D47',
          950: '#0F0A2D',
        },
        surface: {
          50: '#F7F8F8', 
          100: '#EAECEF',
          200: '#D5D8DD',
          300: '#B0B5BD',
          400: '#8A8F98', 
          500: '#646973',
          600: '#3E434D',
          700: '#262931', // Base border
          800: '#16181D', // Card bg
          900: '#0F1115', // Sidebar bg
          950: '#08090A', // Main background
        }
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 4px 20px -2px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
        'glow': '0 0 15px rgba(94, 106, 210, 0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
      }
    },
  },
  plugins: [],
}
