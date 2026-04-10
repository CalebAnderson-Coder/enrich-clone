# 🗺️ Roadmap — Enrich Clone (Empírika AI Fleet)
> Tareas para el Agente Autónomo Claw Code.
> Añade checkboxes con `[ ]`. Marca como completado con `[x]`.

### 🔀 Sistema de Ruteo Automático
- Etiqueta **[LOCAL]** → Usa Gemma local (gratis, tareas simples)
- Sin etiqueta → Usa **Claude 3.5 Sonnet** vía OpenRouter (arquitectura compleja)

---

## 🚨 BUGS CRÍTICOS — Prioridad Máxima

- [ ] **[BUG-1]** Corregir el mismatch de campos en `supabaseUtils.js → saveProspect()`.
  La función inserta `review_count` pero el `schema.sql` define `reviews_count` (con 's').
  También inserta campos fantasma (`mega_profile`, `metro_area`, `industry`, `qualification_score`, `lead_tier`)
  que NO existen en la tabla `leads` del schema. Esto causa errores silenciosos en producción.
  **Acción:** Sincronizar los campos de `leadPayload` con las columnas reales del `schema.sql`.
  Archivos a modificar: `supabaseUtils.js` (líneas 27-42) y `schema.sql`.

- [ ] **[BUG-2]** La función `saveCampaignData()` en `supabaseUtils.js` inserta en una tabla `jobs`
  (`supabase.from('jobs')`) que no existe en el `schema.sql`.
  Esto provoca un error 404/400 en Supabase en cada enriquecimiento de lead.
  **Acción:** O crear la tabla `jobs` en el schema con los campos correctos (`agent_name`, `task_type`, `status`, `payload`, `result`),
  o eliminar esa inserción redundante ya que `index.js` ya maneja sus propios jobs.
  Archivos: `supabaseUtils.js` (líneas 60-83), `schema.sql`.

---

## ⚠️ MEJORAS DE ARQUITECTURA — Alta Prioridad

- [ ] **[ARCH-1]** El `schema.sql` no tiene índices de rendimiento.
  Con +1000 leads en producción, las queries de `index.js` se van a ralentizar.
  **Acción:** Añadir los siguientes índices al `schema.sql`:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_leads_rating ON leads(rating);
  CREATE INDEX IF NOT EXISTS idx_campaign_prospect ON campaign_enriched_data(prospect_id);
  CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaign_enriched_data(status);
  ```

- [ ] **[ARCH-2]** El `schema.sql` no tiene Row Level Security (RLS).
  Cualquiera con la clave `anon` puede leer/escribir todos los leads. Es un riesgo de seguridad.
  **Acción:** Añadir políticas RLS básicas al `schema.sql` para modo producción:
  ```sql
  ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
  ALTER TABLE campaign_enriched_data ENABLE ROW LEVEL SECURITY;
  -- Policy: service_role tiene acceso total
  CREATE POLICY "service_role_full" ON leads TO service_role USING (true) WITH CHECK (true);
  ```

- [ ] **[LOCAL] [ARCH-3]** El `index.js` tiene el `brandId` hardcodeado como constante en el endpoint `/draft-campaign`:
  `const brandId = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';`
  **Acción:** Moverlo a la variable de entorno `BRAND_ID` en `.env` y leerlo con `process.env.BRAND_ID`.

---

## 🔧 MEJORAS DE CALIDAD — Media Prioridad

- [ ] **[LOCAL] [QA-1]** Añadir comentarios descriptivos a `schema.sql`.
  El archivo actual no tiene documentación inline. Añadir comments SQL (`-- Descripción`) en cada tabla,
  columna clave y constraint para que cualquier desarrollador entienda el propósito.

- [ ] **[QA-2]** El endpoint `GET /api/leads` en `index.js` no tiene paginación.
  Si la tabla `leads` crece a 10,000 registros, este endpoint devolverá todo sin límite y reventará el servidor.
  **Acción:** Implementar paginación con parámetros `?page=1&limit=50` en la query de Supabase.
  Archivo: `index.js` (líneas 370-407), `tools/database.js`.

- [ ] **[LOCAL] [QA-3]** Las funciones en `supabaseUtils.js` no tienen JSDoc.
  Añadir documentación JSDoc a `saveProspect()`, `saveCampaignData()` y `createMarketingJob()`
  para que el agente sepa exactamente qué parámetros espera cada función.

---

## 🚀 NUEVAS FEATURES — Roadmap de Producto

- [ ] **[FEAT-1]** Crear endpoint `GET /api/leads/stats` que devuelva un resumen del pipeline:
  total de leads por tier (HOT/WARM/COOL/COLD), distribución por ciudad y por industria.
  Útil para el dashboard de Empírika. Archivo: `index.js`.

- [ ] **[FEAT-2]** Implementar un `lead_magnet_worker` que detecte leads con `lead_magnet_status = 'IDLE'`
  y genere automáticamente una landing page personalizada usando el `mega_profile` del lead.
  Basarse en el archivo existente `magnet_worker.js` como punto de partida.

---
*Última actualización: Auto-generado por Antigravity como Arquitecto del proyecto*
