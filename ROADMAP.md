# 🗺️ Roadmap — Enrich Clone (Empírika AI Fleet)
> Tareas para el Agente Autónomo Claw Code.
> Añade checkboxes con `[ ]`. Marca como completado con `[x]`.

### 🔀 Sistema de Ruteo Automático
- Etiqueta **[LOCAL]** → Usa Gemma local (gratis, tareas simples)
- Sin etiqueta → Usa **Claude 3.5 Sonnet** vía OpenRouter (arquitectura compleja)

---

## 🚨 BUGS CRÍTICOS — Prioridad Máxima

- [x] **[BUG-1]** ~~Corregir el mismatch de campos en `supabaseUtils.js → saveProspect()`.~~
  ✅ **RESUELTO:** `schema.sql` sincronizado con prod (2026-04-10). `supabaseUtils.js` tiene comentarios
  de mapeo explícito (review_count, mega_profile, metro_area). Validación Zod via `lib/schemas.js`.

- [x] **[BUG-2]** ~~`saveCampaignData()` insertaba en tabla `jobs` inexistente.~~
  ✅ **RESUELTO:** Ahora inserta en `campaign_enriched_data` (línea 96). Tabla `marketing_jobs`
  creada en `schema.sql` para el job queue real vía `createMarketingJob()`.

---

## ⚠️ MEJORAS DE ARQUITECTURA — Alta Prioridad

- [x] **[ARCH-1]** ~~Sin índices de rendimiento.~~
  ✅ **RESUELTO:** 8 índices añadidos en `schema.sql` (líneas 97-108):
  `idx_leads_metro`, `idx_leads_tier`, `idx_leads_outreach`, `idx_leads_rating`,
  `idx_campaign_status`, `idx_campaign_prospect`, `idx_outreach_dispatch`, `idx_jobs_status`, `idx_memory_agent`.

- [x] **[ARCH-2]** ~~Sin Row Level Security (RLS).~~
  ✅ **RESUELTO:** RLS habilitado en todas las tablas (leads, campaign_enriched_data, brands,
  marketing_jobs, agent_memory) con policies `service_role` full access (líneas 110-122).

- [x] **[LOCAL] [ARCH-3]** ~~`brandId` hardcodeado en `/draft-campaign`.~~
  ✅ **RESUELTO:** `index.js` línea 175 usa `process.env.BRAND_ID`.

---

## 🔧 MEJORAS DE CALIDAD — Media Prioridad

- [x] **[LOCAL] [QA-1]** ~~Añadir comentarios descriptivos a `schema.sql`.~~
  ✅ **RESUELTO:** 205 líneas con header, comentarios por tabla, columna, índice y sección RLS.

- [x] **[QA-2]** ~~Sin paginación en `GET /api/leads`.~~
  ✅ **RESUELTO:** `index.js` línea 454 acepta `?page=1&limit=20` via `getLeads()` en `tools/database.js`.

- [x] **[LOCAL] [QA-3]** ~~Las funciones en `supabaseUtils.js` no tienen JSDoc.~~
  ✅ **RESUELTO:** JSDoc completo en `saveProspect()`, `saveCampaignData()` y `createMarketingJob()`
  con mapeo de campos legacy→prod, tipos, y ejemplos.

---

## 🚀 NUEVAS FEATURES — Roadmap de Producto

- [x] **[FEAT-1]** ~~Crear endpoint `GET /api/leads/stats`.~~
  ✅ **RESUELTO:** `index.js` línea 442: `GET /api/leads/stats` → `getLeadsStats()` en `tools/database.js`.

- [x] **[FEAT-3]** ~~Diseño e Implementación de Interfaz Dashboard SaaS Premium.~~
  ✅ **RESUELTO:** Reemplazo de UI genérica por Dashboard con Dark Mode, Glassmorphism y Framer Motion (2026-04-12).
  Navegación completa validada en puertos 5173-5177.

---
*Última actualización: 2026-04-12 — Auditado y sincronizado por Antigravity (UI/UX Version 2.0 Ready)*
