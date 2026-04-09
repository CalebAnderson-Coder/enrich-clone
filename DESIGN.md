---
name: Enrich Clone Design System
description: A clean, agentic UI dashboard for an AI Marketing Agency, featuring a sidebar-based layout, a central chat interface, and a right-side metrics panel. Minimalist, premium SaaS aesthetic.
---

# Global

## Colors
- **Primary:** `#2563EB` (Blue for primary buttons and accents)
- **Secondary:** `#10B981` (Emerald green for positive indicators/success)
- **Background:** `#F8FAFC` (Slate-50 for app background/sidebars)
- **Surface:** `#FFFFFF` (White for main content areas and cards)
- **Text:** 
  - **Primary:** `#0F172A` (Slate-900)
  - **Secondary:** `#475569` (Slate-600)
  - **Muted:** `#94A3B8` (Slate-400)
- **Border:** `#E2E8F0` (Slate-200)

## Typography
- **Font Family:** Inter or system sans-serif.
- **Headings:** Bold, dark text (`#0F172A`).
- **Body:** Regular weight, secondary text (`#475569`).
- **Small Elements:** Semi-bold uppercase for category headers in sidebars (e.g., `CHANNELS`, `DIRECT MESSAGES`).

## Layout
- **Structure:** 3-column app layout.
  - **Left Sidebar:** Navigation (Channels, DMs, Chat History, Files, Profile), approx width 260px.
  - **Middle Area:** Main chat/execution timeline with AI agents.
  - **Right Sidebar:** Contextual data (Metrics, Tasks, Knowledge Base), approx width 320px.
- **Spacing:** Generous padding (16px to 24px).
- **Rounding:** Large rounding on inner cards (`rounded-xl` or `rounded-2xl`).
- **Shadows:** Soft, diffused shadows for cards and popups.

# Components

## Sidebar Navigation
- Small, muted uppercase headers for sections.
- Clickable items have a clear hover state (light gray background).
- Active items are highlighted (e.g., `# main` channel).

## Chat/Timeline Interface
- Messages from Agents include an avatar and the agent's name.
- Status indicators for tasks (e.g., green dot `Getting your content`, yellow dot `Working on it...`).
- Clean separation between dates (e.g., a subtle line with a pill `Monday, April 6`).

## Metrics Cards
- Used in the right sidebar.
- White background, light border, small data points.
- "Connect now" links in green (`#10B981`).

## Buttons
- **Primary Button:** Blue (`#2563EB`), white text, rounded rectangle (`rounded-lg` or `rounded-xl`), smooth hover effect.
- **Secondary Button:** Light gray or outlined.

## Empty States
- Clean, centered empty states with a soft icon and muted explanatory text (e.g., "No workspace files yet").

# Appearance
- **Color Mode:** Light Mode primarily, but dark mode variants use `slate-900` backgrounds with `slate-100` text.
- **Vibe:** Professional, efficient, automated. The UI should fade away while the agents do the work.
