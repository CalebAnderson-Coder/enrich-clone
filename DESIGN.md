---
name: Enrich Clone Design System V2
description: A premium, agentic AI SaaS dashboard with a sleek dark-mode aesthetic, glassmorphism, and fluid animations.
---

# Global Aesthetics

## theme: Dark Mode (Premium)
- **Primary Background:** `#030712` (Zinc-950) - Deep, dark interface.
- **Surface Background:** `rgba(17, 24, 39, 0.7)` (Zinc-900 with Alpha) - Glassmorphic cards.
- **Accents:**
  - **Primary:** Gradient from Blue-600 (`#2563EB`) to Indigo-500 (`#6366F1`).
  - **Success:** Emerald-500 (`#10B981`) for positive growth and active agents.
  - **Energy:** Amber-400 (`#FBBF24`) for pending tasks and notifications.
- **Text:**
  - **Primary:** `#F8FAFC` (Slate-50) - Crisp white for readability.
  - **Secondary:** `#94A3B8` (Slate-400) - Muted labels.
- **Glassmorphism:** `backdrop-blur-xl` and thin borders (`border-white/10`).

## Typography
- **Font:** Inter (preferred) or sans-serif.
- **Headings:** Extra-bold, tight tracking, subtle text-shadow for depth.
- **Status Pills:** Semi-bold, monochromatic or themed backgrounds.

# Components

## Sidebar Navigation (Fluid)
- Vertical layout with iconic representation and descriptive labels.
- Smooth scale-up hover effects and active indicator bars.
- Transparent background with glassmorphic overlay for the active state.

## Dynamic Metrics (Dashboard)
- Glowing card borders representing active data flow.
- "Live" indicators (pulsing dots) for agents working in real-time.
- Minimalist line charts with indigo gradients.

## Agent Control Panel
- Central area for monitoring agent logs.
- Interactive toggle buttons with spring-based animations.
- Dark-themed code snippets/logs for technical transparency.

# Motion & Interaction
- **Entrance:** Staggered fade-in animations for dashboard cards.
- **Hovers:** Smooth transitions (`easeInOut`, 0.3s) for all interactive elements.
- **Feedback:** Subtle scale and shadow changes when clicking buttons.
- **Library:** Framer Motion for coordinate-based layout transitions.

# Vibe
The interface should feel like a high-tech control center where AI agents operate autonomously. It avoids browser-default behaviors in favor of an "OS-like" immersive experience.
