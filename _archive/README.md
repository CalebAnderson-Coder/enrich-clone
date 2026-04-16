# _archive/

Código abandonado / deprecated conservado como referencia histórica. **Nada aquí se deploya ni se ejecuta.**

## Contenido

| Carpeta / archivo | Qué es | Por qué archivado |
|---|---|---|
| `enrich-dashboard/` | Frontend Vite + Playwright (experimento) | Reemplazado por `dashboard/` (único frontend de producción). Contenía Bearer token hardcoded en `src/App.jsx`. |
| `frontend/` | Frontend Next.js (experimento) | Redundante con `dashboard/`. Contenía `API_SECRET_KEY` hardcoded en 2 archivos. |
| `agent-dashboard-ui/` | Template Next.js + Bun de "Kiran" (experimento OMC) | Nunca llegó a producción. Redundante. |
| `scratch/` | Scripts scratchpad (`trigger_prospect.js`, `launch_fleet_mission.js`, `oh-my-openagent/`, `openclaw/`) | Experimentos locales. `trigger_prospect.js` tenía `API_SECRET_KEY` hardcoded. |
| `firecrawl_brand_extract.js` | Script one-off (`scripts/`) | `FIRECRAWL_API_KEY` hardcoded sin fallback a env. |
| `.github-workflows/playwright-qa.yml` | Workflow de CI que testeaba `enrich-dashboard/` | Sin frontend activo al que apuntar. |

## Secretos

Todos los secretos que estaban hardcoded en este código **ya fueron rotados** (ver plan de auditoría). Los valores que aparecen aquí son **inválidos** tras la rotación — se mantienen tal cual como evidencia histórica, no como código funcional.

## Política

No restaurar nada desde `_archive/` sin antes:
1. Confirmar que no duplica funcionalidad de `dashboard/` o código activo.
2. Eliminar cualquier secreto hardcoded que pudiera quedar.
3. Actualizar a las APIs/dependencias actuales.
