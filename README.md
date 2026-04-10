# Empirika Enrich Clone

Pipeline autónomo de agentes de IA para descubrimiento, perfilamiento y "Enrichment" avanzado de leads B2B (basado en el stack de Supabase, Node.js y Agentes Langchain/Gemini).

## Componentes y Arquitectura

*   **Agents**: Sistema de agentes con diferentes especialidades para evaluar e investigar al lead.
    *   **Carlos**: Estratega jefe. Encargado de formular los "Attack Angles" y las explicaciones técnicas usando contenido previo y extraído de redes/web.
    *   **Scout**: Encargado de validación superficial y puntuación inicial (Lead Scoring).
    *   **Manager**: Coordinador de agentes.
    *   **TrueResearcher**: Agente especializado en investigación profunda utilizando búsquedas en DuckDuckGo. Da con los URLs correctos de Facebook, LinkedIn e Instagram de la empresa.
*   **Herramientas Externas**:
    *   **DuckDuckGo Search**: Ocupado para encontrar y limpiar los links correctos de las entidades.
    *   **Firecrawl**: Utilizado para conectarse al sitio web de cada lead, hacer scrape en tiempo real sin ser bloqueado por protección anti-bots y convertir toda la página a formato Markdown para el cerebro del agente `Carlos`.
*   **Database**: Supabase PostgreSQL.

## Flujo de Trabajo

1.  Se obtienen Leads en bruto.
2.  `TrueResearcher` limpia y actualiza sus perfiles de Web/Redes.
3.  `Scout` y `Manager` validan perfiles básicos.
4.  `Carlos` consume la extracción MD en vivo recolectada por **Firecrawl** de las webs corporativas aportadas y en base a ello genera "Radiografía Técnica" y "Ángulo de Ataque" en Supabase.
5.  Todo se sirve a través de la interfaz Dashboard **enrich-dashboard** conectada a la base de datos de Supabase.

## Actualización Reciente / Firecrawl + DuckDuckGo

Se ha agregado búsqueda por DuckDuckGo para enriquecer links perdidos y **Firecrawl API** (`@mendable/firecrawl-js`) para extraccion de contenido HTML/MD profundo de las URL de los leads, impulsando la lógica pre-ventas de los promots a Gemini M2.0.
