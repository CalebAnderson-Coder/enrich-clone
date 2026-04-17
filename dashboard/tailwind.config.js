/** @type {import('tailwindcss').Config} */
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // --- Existing Empírika palette (PRESERVED — consumed across app as primary-500, surface-*) ---
        primary: {
          50: '#F2F2F2',
          100: '#E6E8EA',
          200: '#C9CDD2',
          300: '#A9AFB7',
          400: '#8A8F98',
          500: '#5E6AD2',  // Linear Purple Accent
          600: '#4D58B4',
          700: '#3A4493',
          800: '#2A306E',
          900: '#1A1D47',
          950: '#0F0A2D',
          // shadcn aliases — resolve via CSS vars
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
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
        },
        // --- Semantic tokens (NEW) ---
        semantic: {
          success: '#10b981', // emerald — HOT lead, outreach sent
          warning: '#f59e0b', // amber — awaiting approval
          danger:  '#ef4444', // red — rejected, error
          info:    '#3b82f6', // blue — in progress
        },
        // --- shadcn theme tokens mapped to CSS variables in index.css ---
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 4px 20px -2px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
        'glow': '0 0 15px rgba(94, 106, 210, 0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
        // Progressive elevation (Linear/Vercel dark glassmorphism)
        'elevation-1': '0 1px 2px 0 rgba(0,0,0,0.4), 0 1px 3px 0 rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)',
        'elevation-2': '0 4px 8px -2px rgba(0,0,0,0.5), 0 2px 4px -2px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
        'elevation-3': '0 12px 32px -4px rgba(0,0,0,0.65), 0 6px 12px -3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.07)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
