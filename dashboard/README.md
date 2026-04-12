# Enrich SaaS Dashboard

Interfaz de usuario premium para la gestión autónoma de leads y campañas de marketing.

## 🚀 Tecnologías
- **Core:** React 19
- **Build Tool:** Vite 8
- **Styling:** Vanilla CSS (Modern CSS variables) + Tailwind-merge (utilities)
- **Animaciones:** Framer Motion 12
- **Iconos:** Lucide-React
- **Database Link:** Supabase JS Client

## 🎨 Características de Diseño
- **Estética Agentic:** Basada en un modo oscuro profundo con efectos de desenfoque (glassmorphism).
- **Responsive:** Adaptable a diferentes tamaños de pantalla.
- **Micro-interactividad:** Animaciones de entrada, efectos hover y transiciones de estado de agentes.

## 🛠️ Ejecución Local

1. Instalar dependencias:
   ```bash
   npm install
   ```
2. Iniciar servidor de desarrollo:
   ```bash
   npm run dev
   ```
3. El dashboard buscará el backend en `http://localhost:4000/api` por defecto.

## 📁 Estructura del Proyecto
- `src/components/`: Componentes UI modulares.
- `src/App.jsx`: Orquestación de vistas y ruteo.
- `index.css`: Sistema de tokens de diseño y variables globales.
