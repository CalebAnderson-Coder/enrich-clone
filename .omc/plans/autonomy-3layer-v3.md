# RALPLAN-DR + Plan: enrich-clone Layered Autonomy System (v3, iteration 2)

> **Framing v3 (iter 2):** v2 landed substantially. v3 **NO reescribe** — es patch layer. **Iteration 2 incorporó 9 cambios Architect + 4 Critic** (ver §C changelog "Iteration 2 changes"). **Métricas nuevas que escriben filas a `autonomy_audits` se reducen a 3: V1, V4 y 10b.** V2 (WA channel health) y V3 (whitelist staleness) se **relocan como lógica in-briefing** — V2 como escalada dentro de `decisionFor()`, V3 como query on-boot. Esto simplifica el contrato del auditor (menos superficie, menos riesgo de silent-failure) y mueve decisiones compuestas al lugar donde ya tenemos contexto de whitelist.

---

## Section A — RALPLAN-DR Summary

### Principles (5, refinados vs v2)

1. **La métrica verde sin volumen no es éxito, es ausencia.** `sent_to_failure_rate_14d=0` con `sent_rate_24h=0` es parálisis, no salud. v3 exige métricas pareadas: denominador + tasa.
2. **Cada canal outbound activo vive en el catálogo, o no existe.** Email vivió en `outreach_status` enum, WhatsApp vive en `lead_magnets_data` JSONB — el auditor debe cubrir ambas superficies o se nos repite el fiasco landlines (45 ACK 201 / 0 entregados Meta).
3. **Detection y action siguen separadas.** Layer 1 SQL puro, zero LLM. Layer 2 decide gastar tokens. v2 principle preservado.
4. **Whitelist AUTO es un compromiso, no un default.** Si una regla está AUTO 30 días sin dispararse, es evidencia de que o el threshold está mal o la señal nunca llega — ambos casos requieren re-evaluación, no silencio.
5. **Ralph gate sagrado, env human-approved, sealed files crecen con cada canal.** v2 principle preservado + extendido a `tools/baileysWhatsApp.js` y scripts de sends.

### Decision Drivers (top 3)

1. **Cobertura de canal vs scope creep.** Añadir WhatsApp al auditor es obligatorio (gap real, resuelto por SQL sobre JSONB, sin APIs pagas). Añadir SMS/Baileys no lo es hasta que haya volumen real.
2. **Detectar parálisis silenciosa vs ruido alerta.** Task #33 lleva ~1 semana sin que franchise AUTO dispare nunca. Necesitamos un meta-métrica "whitelist rule staleness" sin generar alertas cada vez que un threshold está verde por razones legítimas.
3. **Presupuesto real vs teórico.** v2 asumió $25/día cap; el piloto real ha consumido ~$0 en auto-dispatch porque AUTO nunca disparó. Sizing de Option C debe usar datos reales de `autonomy_briefings`, no estimados.

### Viable Options

**Option A (recommended) — ALTER schema + 4 nuevas métricas, sin tabla nueva.**
- Pros: cambio aditivo puro; `autonomy_audits` schema ya acomoda cualquier `metric_name`; no requiere migración DDL compleja; solo se añaden nuevos `metric_name` strings y lógica en `workers/nightly_auditor.js`. Zero cost center nuevo. Sealed files extendidos sin deuda arquitectónica.
- Cons: métrica WhatsApp requiere query JSONB (`lead_magnets_data->>wa_delivery_status`) — ligeramente más lenta que columna plana; p95 <500ms aceptable en piloto.

**Option B — Tabla `wa_delivery_events` dedicada.**
- Pros: schema explícito, índices eficientes, facilita debugging.
- Cons: migración DDL adicional; duplica información que `wa_stamp_delivery.js` ya escribe en JSONB; requiere backfill de las 45 filas históricas; zero valor incremental sobre Option A en piloto <100 sends/semana.
- **Invalidación:** sobre-engineering para volumen actual. Diferir a cuando WhatsApp supere 500 sends/semana sostenidos (disparador de re-evaluación, no decisión ahora).

**Option C (diferida a 2026-05-08) — Render durable-cron Claude briefing.**
- Pros: elimina dependencia single-machine; ejecuta briefing aunque Brian viaje/esté en calls.
- Cons: requiere `ANTHROPIC_API_KEY` env var en Render (IR5 approval); sizing correcto necesita ≥2 semanas de `autonomy_briefings` data.
- **Estado:** NO se decide en v3. Gate: evaluar 2026-05-08 con data real.

**Recomendación: Option A en próximos 7 días; Option C re-evaluada 2026-05-08.**

Si solo 1 opción quedara viable: rationale = Option B es sobre-engineering (invalidada), Option C depende de data que aún no existe (diferida). Option A es la única compatible con IR6 + IR5 + evidencia disponible.

### Pre-mortem — 3 Failure Scenarios

**S1 — Silent audit failure post-v3 (falla silenciosa).**
El nuevo JOIN JSONB `lead_magnets_data->>wa_delivery_status` lanza excepción por schema drift (ej. fila antigua con `lead_magnets_data=null`). El try/catch per-metric del auditor escribe `severity='error'` en lugar de detener el run — pero nadie mira las filas `error`, así que métrica queda silenciada semanas.
- **Detection:** nueva regla en `morning_briefing.js` que agrupa todas las filas `severity='error'` bajo banner `⚠️ AUDITOR_SUBQUERY_ERRORS` con conteo. Si conteo >0 durante 2 días consecutivos, banner sube a rojo con acción `INVESTIGATE_AUDITOR_ERRORS` (REPORT_ONLY). Test: unit test que inyecta `lead_magnets_data=null` y assertea que la métrica WA escribe green (no error) con `details.sample_size=0`.
- **Recovery:** defensive-null handling en `wa_delivery_failure_rate_14d` — tratar rows sin stamp como fuera-de-denominador, no como error. Escribir green con `details.note='insufficient_wa_stamps'`.

**S2 — Cost blow-up por expansión de cobertura de canal (cost blow-up).**
Habilitar detección WhatsApp dispara una racha de alertas rojas (45/45 falla → métrica roja crónica). Morning briefing lee 7 días de autonomy_audits acumulados + rojo WA persistente → cada mañana durante 5 días genera dispatch intent, pero todo cae en REPORT_ONLY (whitelist decide que `DISABLE_WA_CHANNEL_TEMP` es decisión de negocio, no code fix). Riesgo: ruido de briefing crece, Brian desensitiza y filtra visualmente.
- **Detection:** contador de "misma métrica, mismo severity, ≥3 días consecutivos sin ack" → auto-consolida en banner único "PERSISTENT_RED:{metric}" y suprime las duplicadas en el print. Telemetría: `autonomy_briefings.details.suppressed_duplicates_count`.
- **Recovery:** CLI flag `--ack-persistent={metric_name}` que marca todas las filas rojas activas de esa métrica como acked con `acknowledged_by='brian_persistent_ack'`. Permite a Brian pausar ruido sin perder historial SQL.

**S3 — Regresión de invariante whitelist (invariant regression).**
Nueva acción `DISABLE_WA_CHANNEL_TEMP` entra como REPORT_ONLY correctamente, pero un refactor futuro accidentalmente la flipea a AUTO → ralph template no existe → dispatch crashea → logs quedan en Render 7 días y desaparecen; historial de crash se pierde.
- **Detection:** unit test `tests/briefing_dispatch_plan.spec.js` extendido: para cada suggested_action, assertear `WHITELIST[action].decision === EXPECTED_MAP[action]`. Hard-codea mapeo canónico. CI falla en cualquier flip silencioso.
- **Recovery:** `git revert` + alerta en `autonomy_briefings.details.unknown_action_dispatched` que escribe row cuando un dispatch plan incluye action sin template.

### Expanded Test Plan (deliberate mode)

**Unit (nuevos/extendidos, iteration 2):**
- `tests/autonomy/whitelist_contract.spec.js` (C3) — NUEVO canonical contract test:
  - assert `WHITELIST` importado de `lib/autonomy_whitelist.js` tiene ≥ entries esperadas (no vacío).
  - lista CANONICAL_ACTIONS hardcodeada = conjunto de `suggested_action` producidos por worker (B.2); assert cada una existe en WHITELIST — falla si métrica nueva olvida añadir entry.
  - para cada entry con `decision==='AUTO'`: assert existe `.omc/ralph-templates/{action_lowercased}.md` (fs check) O entry tiene `skipTemplateCheck:true` explícito.
  - CI falla en cualquier drift.
- `tests/autonomy/wa_delivery_metric.spec.js` — fixtures con 45 rows (30 sin wa_delivery_status, 10 `failed`, 5 `delivered`); assertea denom=15, failed=10, rate≈66.67%, severity=red, suggested_action=`INVESTIGATE_WA_DELIVERABILITY`, `details.in_flight_count=30` (A4 invariant).
- `tests/autonomy/wa_delivery_null_safety.spec.js` — fixtures con `lead_magnets_data=null` y `lead_magnets_data={}`; assertea green + `details.note='insufficient_wa_stamps'` o `'all_in_flight'`, NUNCA severity='error'.
- `tests/autonomy/wa_delivery_escalation.spec.js` (A1) — fixture row con `denom=10, failure_rate=61, severity=red` → briefing.escalateIfNeeded() devuelve `DISABLE_WA_CHANNEL_TEMP`. Boundary: `denom=9` NO escala; `denom=10, rate=59` NO escala; `denom=10, rate=61` SÍ escala.
- `tests/autonomy/outreach_channel_split.spec.js` (A3) — fixtures: (a) email_sends=5, wa_sends=5, combined=10 → green; (b) email=4, wa=4, combined=8 → yellow; (c) email=10, wa=0 → yellow (XOR); (d) email=1, wa=1, combined=2 → red; (e) todo 0 → red.
- `tests/autonomy/whatsapp_spanish_violation.spec.js` (A5, 10b) — (a) wa_last_body=null → green + note='awaiting_wa_body_stamp'; (b) body español válido → green; (c) body con 'hi there' → red con suggested_action=WHATSAPP_SPANISH_VIOLATION.
- `tests/autonomy/briefing_staleness.spec.js` (A2) — fixture `autonomy_audits` con 1 row AUTO-action unacked hace 400h → banner staleness impreso + `details.stale_auto_actions` no vacío en ledger. Fixture con 100h → no banner.

**Integration:**
- `tests/autonomy/nightly_auditor.integration.test.js` (extender existente) — seed 48h sintético con 20 email SENT + 30 wa stamps mixtos + 0 wa sends hoy; run auditor; assertear rows nuevas de V1, V4, 10b con metric_name correcto; assertear 0 rows de `wa_channel_health_derived` o `whitelist_auto_dispatch_staleness_hours` (retiradas por A1/A2).

**E2E (staging o dry-run contra prod con AUDIT_DRY_RUN=true):**
- Ejecutar `node workers/nightly_auditor.js --brand-id=<empirika> --dry-run` contra DB real; snapshot de filas nuevas; diff vs expected set. Correr 3 mañanas consecutivas antes de flip prod.

**Observability:**
- `autonomy_briefings.details` extiende schema JSONB: `{suppressed_duplicates_count, unknown_action_dispatched[], channel_split_snapshot}`.
- Conteo `severity='error'` rows/día expuesto en briefing header.
- Heartbeat freshness ya cubierto por `check_audit_heartbeat.js` (no cambia).

---

## Section B — Full Plan

### B.0 As-built Inventory (gate antes de cualquier cambio v3)

| Artefacto | Estado | Evidencia |
|---|---|---|
| `migrations/016_autonomy_audits.sql` | ✅ aplicada | Task #21 completed; schema verified |
| `workers/nightly_auditor.js` | ✅ funcional con 9 métricas activas + heartbeat + retention prune | Task #22 completed; lectura confirma contrato |
| `lib/spanishOnlyLinter.js` | ✅ sealed + in-use por métrica 10 | Task #19 completed |
| `scripts/ralph_recursion_guard.js` | ✅ 3 comandos (acquire/check/release), TTL 2h | Task #20 completed |
| `scripts/morning_briefing.js` | ✅ WHITELIST con 16 entradas + budget guard + briefings ledger | Task #24 completed |
| `scripts/check_audit_heartbeat.js` | ✅ SMTP alert stale >36h | Task #26 artifact; exit codes correctos |
| `agents/manager-daemon.js` cycle AUDIT 03:15 UTC | ✅ integrado con `minuteUtc` extension | Lectura confirma líneas 42, 167-176 |
| `C:\Users\Agencia IA\.claude\skills\empirika-briefing\SKILL.md` | ✅ skill instalado | Task #25 completed; referenciada en `feedback_no_bounce_decisions` |
| `.omc/ralph-templates/add_to_franchise_blocklist.md` | ✅ existe | Task #30 completed |
| Render heartbeat cron | ⚠ diff-for-approval pendiente aplicar | `.omc/artifacts/render-yaml-heartbeat-cron.diff` (IR5 no-apply) |
| Franchise AUTO dispatch primer disparo real | ❌ nunca disparó (Task #33 pending ~7d) | Gap que motiva métrica nueva B.2 |
| Cobertura canal WhatsApp en auditor | ❌ cero (stamps en JSONB fuera del enum) | Fiasco 45/45, motivo principal v3 |

**Conclusión B.0:** v3 no requiere rehacer nada; v3 añade 4 métricas, 3 reglas de whitelist, 1 ajuste de severity/error bucket en briefing, y 1 test invariant. Código legacy v2 permanece como está.

### B.1 Schema changes v3

**Decisión: ALTER mínimo, NO nueva tabla.**

v2 schema (`migrations/016_autonomy_audits.sql`) acomoda cualquier nuevo `metric_name` por diseño (TEXT, sin enum). No requiere DDL. Solo se añade un índice aditivo opcional:

```sql
-- migrations/017_autonomy_audits_v3_indexes.sql (pendiente, opcional)
CREATE INDEX IF NOT EXISTS idx_audits_brand_metric_created
  ON public.autonomy_audits (brand_id, metric_name, created_at DESC);
-- Acelera queries por "última muestra de métrica X" que usará B.2.
```

Aplicar vía `mcp__supabase__apply_migration` tras aprobación humana. **NO destructivo, NO requiere rollback.**

Ninguna ALTER TABLE. `details JSONB` ya absorbe todo lo nuevo.

### B.2 Metric Catalog v3

Mantiene las 9 métricas actualmente activas (ver `workers/nightly_auditor.js` lines 86-344) + heartbeat + descartadas-por-ahora (Metric 4 franchise_block_rate_7d y Metric 5 industry_other_rate_7d están en el plan v2 pero no se ven en el worker actual — v3 debe re-verificar si faltan o están diferidas antes del review).

**Nuevas métricas que escriben filas a `autonomy_audits` v3 — SOLO 3 (iteration 2):**

| # | metric_name | Fuente SQL | Thresholds g/y/r | suggested_action |
|---|---|---|---|---|
| V1 | `wa_delivery_failure_rate_14d` | `campaign_enriched_data WHERE lead_magnets_data->>'wa_message_id' IS NOT NULL AND created_at > now()-14d`; denom = rows con stamp; num = rows donde `lead_magnets_data->>'wa_delivery_status' ILIKE '%fail%' OR ILIKE '%undeliver%'`. **details debe exponer:** `{ denom, failed, in_flight_count, failure_rate }` donde `in_flight_count` = rows con `wa_message_id` pero sin `wa_delivery_status` (A4). | ≤10% / 11-40% / >40% | `INVESTIGATE_WA_DELIVERABILITY` (red) |
| V4 | `outreach_channel_split_24h` | `campaign_enriched_data WHERE created_at > now()-24h`; `email_sends` = count con `outreach_status IN ('SENT','CONTACTED','BOUNCED',...)` + `email_sent_at>now()-24h`; `wa_sends` = count con `lead_magnets_data->>'wa_message_id' IS NOT NULL` en ventana; `combined = email_sends + wa_sends`. **Thresholds endurecidos (A3):** green = `email_sends>=5 AND wa_sends>=5 AND combined>=10`; yellow = `combined>=3 AND combined<10` OR `(email_sends=0 XOR wa_sends=0)`; red = `combined<3` OR `(email_sends=0 AND wa_sends=0)`. `min_volume_for_green=10`. | ver A3 | `INVESTIGATE_CHANNEL_PARALYSIS` (REPORT_ONLY) |
| 10b | `whatsapp_spanish_violation_count_24h` (A5) | Corre `lintSpanishOnly` sobre `lead_magnets_data->>'wa_last_body'` para filas con `wa_message_id` en últimas 24h (fallback: placeholders del template body array si `wa_last_body` no stamped). **Prereq:** W2026-04-24 D2 debe añadir stamp de WA body (`wa_last_body`) en `scripts/send_whatsapp_outreach.js` a `lead_magnets_data` — flaggeado como prerequisito en rollout. Hasta que prereq se cumpla, métrica escribe green con `details.note='awaiting_wa_body_stamp'`. | 0 violaciones = green; ≥1 = red | `WHATSAPP_SPANISH_VIOLATION` (REPORT_ONLY, nunca auto-fix — IR1) |

**Relocadas fuera del auditor (iteration 2):**
- **~~V2 `wa_channel_health_derived`~~ (A1):** ELIMINADA del catálogo. Lógica se mueve a `scripts/morning_briefing.js:decisionFor()`: cuando `metric_name='wa_delivery_failure_rate_14d'` aparece con `severity='red'` AND `details.denom>=10` AND `details.failure_rate>60`, el briefing escala el `suggested_action` de `INVESTIGATE_WA_DELIVERABILITY` → `DISABLE_WA_CHANNEL_TEMP` (REPORT_ONLY, banner rojo). No escribe fila nueva a `autonomy_audits`.
- **~~V3 `whitelist_auto_dispatch_staleness_hours`~~ (A2):** ELIMINADA del catálogo nocturno. Se implementa como helper on-boot dentro de `scripts/morning_briefing.js`: al arrancar ejecuta `SELECT suggested_action, MIN(created_at) FROM autonomy_audits WHERE acknowledged_at IS NULL GROUP BY suggested_action` y muestra banner si edad > umbral por acción AUTO (>336h = red). NO escribe fila a `autonomy_audits`. Evita feedback-loop (una fila de staleness la semana siguiente agrava su propia staleness).

**Nota coste:** Twilio Lookup NO se añade en v3 (cost center, IR6 bloquea). V1 es señal indirecta suficiente. Si Brian decide pagar Twilio Lookup, pasa a v4 con IR6.

**Criterios rojo → acción de negocio, no code fix:**
- V1 red → `INVESTIGATE_WA_DELIVERABILITY` REPORT_ONLY: banner rojo. Si además `details.failure_rate>60 AND denom>=10`, briefing escala in-memoria a `DISABLE_WA_CHANNEL_TEMP` (A1 lógica).
- 10b red → `WHATSAPP_SPANISH_VIOLATION` REPORT_ONLY: banner rojo, NUNCA auto-fix (IR1).
- V4 red → `INVESTIGATE_CHANNEL_PARALYSIS` REPORT_ONLY: banner rojo, diagnóstico primero.

### B.3 Nightly auditor deltas (iteration 2 — solo 3 bloques nuevos)

**Cambio estructural vs iteración 1 (C4):** solo **V1, V4, 10b** escriben filas a `autonomy_audits`. V2 y V3 de iteración 1 se retiran del worker (ver A1/A2 en §B.2 / §B.4). Esto reduce superficie del auditor y evita dos categorías de fallo: (a) feedback-loop de V3 sobre sus propias filas, (b) duplicación de lógica de escalada fuera del contexto de whitelist.

Cambios a `workers/nightly_auditor.js` (edición quirúrgica, sin reescritura):

1. **Añadir bloque métrica V1 `wa_delivery_failure_rate_14d`** (después de metric 10 spanish_violation, antes de retention prune). SQL revisada con `in_flight_count` expuesto (A4):
```js
const { data: waRows, error } = await supa
  .from('campaign_enriched_data')
  .select('lead_magnets_data')
  .eq('brand_id', brandId)
  .not('lead_magnets_data->>wa_message_id', 'is', null)
  .gte('created_at', sinceISO(24 * 14));
if (error) throw error;
const rows = waRows || [];
const withStamp = rows.filter(r => r.lead_magnets_data?.wa_delivery_status);
const inFlight  = rows.filter(r => !r.lead_magnets_data?.wa_delivery_status);
const failed    = withStamp.filter(r => /fail|undeliver/i.test(String(r.lead_magnets_data.wa_delivery_status))).length;
const denom     = withStamp.length;
const failureRate = denom > 0 ? Math.round((failed / denom) * 10000) / 100 : 0;
// insufficient-sample guard: si denom<5, insertRow green + details.note='insufficient_wa_stamps'
// details shape OBLIGATORIO: { denom, failed, in_flight_count: inFlight.length, failure_rate: failureRate, window_days: 14 }
```
Invariante: `in_flight_count <= rows.length` siempre; si `denom == 0` pero `in_flight_count > 0`, severity=green con `details.note='all_in_flight'` (evita falso-rojo por stamp-lag).

2. **Añadir bloque métrica V4 `outreach_channel_split_24h`** con thresholds endurecidos (A3): 2 counts en paralelo (`email_sends` sobre enum, `wa_sends` sobre JSONB), combined=suma. Severity según green/yellow/red de A3. Escribe 1 fila con `details: { email_sends, wa_sends, combined, min_volume_for_green: 10 }`.

3. **Añadir bloque métrica 10b `whatsapp_spanish_violation_count_24h`** (A5). Import `lintSpanishOnly` (ya presente). Query:
```js
const { data: waMsgs } = await supa
  .from('campaign_enriched_data')
  .select('id, lead_magnets_data')
  .eq('brand_id', brandId)
  .not('lead_magnets_data->>wa_message_id', 'is', null)
  .gte('created_at', sinceISO(24))
  .limit(200);
// hasta que prereq W2026-04-24 D2 stampe wa_last_body, rows no tendrán body legible
// → si ninguna row tiene wa_last_body: green + details.note='awaiting_wa_body_stamp'
// cuando exista: lintSpanishOnly sobre lead_magnets_data.wa_last_body
```
`suggested_action = violations > 0 ? 'WHATSAPP_SPANISH_VIOLATION' : null`. severity: green (0 violaciones) / red (≥1). Nunca auto-fix.

4. **Preservar heartbeat FIRST.** Ninguno de los 3 bloques nuevos debe ejecutarse antes del heartbeat insert (líneas 64-69).

5. **Mantener try/catch per-metric.** Cada bloque nuevo dentro de `runMetric(name, async () => {...})`.

6. **NO importa WHITELIST en el worker.** Toda lógica de escalada y staleness vive en `scripts/morning_briefing.js` + `lib/autonomy_whitelist.js` (C2).

Estimado: +90 LOC al worker (vs +120 iteración 1, reducido al retirar V2/V3), +0 imports nuevos (lintSpanishOnly ya importado).

### B.4 Morning briefing deltas (iteration 2)

Cambios a `scripts/morning_briefing.js`:

1. **Single-source WHITELIST (C2).** El objeto `WHITELIST` y `decisionFor()` migran a `lib/autonomy_whitelist.js` como fuente canónica. `scripts/morning_briefing.js` los importa. Cualquier otro consumidor (futuros dashboards, tests) los importa del mismo archivo. Sellado vía `.omc/self-improve/config/sealed_files.txt` (incluido en A6). Eliminar drift: una sola tabla, un solo lugar. Archivo `lib/autonomy_whitelist.js` se crea en W2026-04-24 D1 como parte del rollout (ver B.7).

2. **WHITELIST extensión** (añadir entries):
```js
INVESTIGATE_WA_DELIVERABILITY:    { decision: 'REPORT_ONLY', rationale: 'Canal outbound degradado — decisión de negocio (IR5/IR6)' },
DISABLE_WA_CHANNEL_TEMP:          { decision: 'REPORT_ONLY', rationale: 'Env flip — requiere IR5' },
INVESTIGATE_CHANNEL_PARALYSIS:    { decision: 'REPORT_ONLY', rationale: 'Detecta parálisis pipeline, diagnóstico primero' },
INVESTIGATE_AUDITOR_ERRORS:       { decision: 'REPORT_ONLY', rationale: 'Meta-error: auditor sub-query fallando' },
WHATSAPP_SPANISH_VIOLATION:       { decision: 'REPORT_ONLY', rationale: 'Nunca auto-fix (IR1). Manual review WA template.' },
REVIEW_WHITELIST_RULE_*:          // wildcard handler en decisionFor() junto a INVESTIGATE_AGENT_*
```

3. **Escalada V2 in-briefing (A1).** `decisionFor()` (o helper adyacente `escalateIfNeeded(row)`) inspecciona audits antes de construir dispatch plan: cuando `row.metric_name==='wa_delivery_failure_rate_14d'` AND `row.severity==='red'` AND `row.details.denom>=10` AND `row.details.failure_rate>60`, reescribe el `suggested_action` efectivo a `DISABLE_WA_CHANNEL_TEMP` y marca `details.escalated_from='INVESTIGATE_WA_DELIVERABILITY'` en el briefing ledger. El banner rojo reporta la escalada. Tests cubren boundary: `denom=9` (no escala), `denom=10 + failure_rate=61` (escala).

4. **Staleness helper on-boot (A2).** Al arrancar `main()` (antes de `printReport`), ejecutar:
```js
SELECT suggested_action, MIN(created_at) AS oldest_unacked
FROM autonomy_audits
WHERE brand_id = $1 AND acknowledged_at IS NULL AND severity IN ('yellow','red')
GROUP BY suggested_action;
```
Para cada fila cuyo `suggested_action` tiene `WHITELIST[action].decision==='AUTO'` y `age_hours > 336`, imprimir banner:
```
⚠️  STALENESS: {action} unacked por {age_hours}h (>14d) — regla AUTO no dispara. Revisar threshold o retirar AUTO.
```
NO escribe fila a `autonomy_audits`. Telemetría: incluye en `writeBriefingLedger` details `stale_auto_actions: [...]`.

5. **BUDGET_CAP_USD default $10 (A8).** Cambiar `DEFAULT_BUDGET_CAP_USD = 25` → `DEFAULT_BUDGET_CAP_USD = 10`. Documentar en comentario inline: "Lowered from $25 iteration-1 → $10 iteration-2 (A8). Raise only after ≥3 auto-dispatches exitosos en 7 días confirman cost model." El pre-flight check `budgetSpent + (dispatches.length + 1) * 15 > budgetCap` sigue válido pero bajo cap más estricto.

6. **Error bucket expansion en `printReport`:** si `errors.length > 0` durante 2 mañanas consecutivas (lookup `autonomy_briefings` últimos 2 días `details.auditor_errors_count`), escalar banner a rojo con `INVESTIGATE_AUDITOR_ERRORS`.

7. **Supresión de duplicados persistentes** (S2): helper `consolidatePersistentReds(audits)` agrupa por `metric_name + severity='red'`; ≥3 días consecutivos sin ack → una sola línea `PERSISTENT_RED:{metric}`.

8. **Briefing ledger schema:** `writeBriefingLedger` details incluye:
```js
{ mode, downgraded_count, suppressed_duplicates_count, channel_split_snapshot,
  auditor_errors_count, stale_auto_actions, escalated_from_count }
```

9. **After-ack timeout:** sin cambio vs iter-1 (re-surface >72h diferido a 2026-05-08).

**C4 aclaración:** V3 de iteración 1 (`whitelist_auto_dispatch_staleness_hours`) NO es métrica del nightly; vive SOLO como helper del briefing (A2). V2 de iteración 1 (`wa_channel_health_derived`) NO es métrica del nightly; vive SOLO como escalada in-briefing (A1). Únicas métricas nuevas que escriben a `autonomy_audits`: **V1, V4, 10b**.

### B.5 self-improve integration v3 (iteration 2)

**Estado:** v2 dejó self-improve diferido dependiente de benchmark corpus con ≥40 positive-engagement rows. Sigue sin cumplirse (task #34 en curso, 0 replies reales).

**Cambios iteration 2:**

1. **Sealed files creado AHORA (A6).** `.omc/self-improve/config/sealed_files.txt` existe desde iteración 2 (creado en este ralplan, no diferido). Contenido literal:
```
tools/email.js
tools/twilio.js
tools/baileysWhatsApp.js
tools/stripe.js
scripts/send_whatsapp_outreach.js
scripts/wa_check_delivery.js
scripts/wa_stamp_delivery.js
scripts/wa_phone_repair.js
scripts/wa_phone_sweep_empirika.js
scripts/wa_template_canary.js
outreach_dispatcher.js
index.js
render.yaml
.env*
migrations/**
supabase/**
scripts/validate_lead_domains.js
agents/manager-daemon.js
tools/database.js
lib/spanishOnlyLinter.js
lib/autonomy_whitelist.js
scripts/morning_briefing.js
workers/nightly_auditor.js
scripts/ralph_recursion_guard.js
```
Incluye `lib/autonomy_whitelist.js` (canonical whitelist source per C2). Archivo físicamente presente en repo; futuros self-improve loops lo leerán como allowlist invariante.

2. **Corpus estratificación obligatoria por canal.** Si self-improve se extiende alguna vez más allá de email (p.ej. WhatsApp copy optimization), el corpus DEBE estratificar por canal — nunca mezclar drafts email con mensajes WA bajo una sola rúbrica de judge. Documentar en `.omc/self-improve/config/goal.md` cuando se cree (campo `channel: email|whatsapp|multi`).

3. **Prerequisito insatisfecho explícito:** benchmark corpus aún imposible (<40 rows positive-engagement). Self-improve Helena **permanece bloqueado** hasta que:
   - (a) reply pipeline exista (fuera de scope v3), OR
   - (b) proxy de engagement diferente se defina (ej. `outreach_status=CONTACTADO` con ventana 7d) — decisión v4.

### B.6 Risk Register v3 (13 riesgos)

Actualización de probabilidades con datos reales (2026-04-23):

| # | Risk | L v2 | L v3 | I | Mitigation v3 |
|---|---|---|---|---|---|
| R1 | Silent auditor failure (heartbeat) | M | **L** (heartbeat cron instalado, 0 stale alerts detectadas) | H | Sin cambio; check_audit_heartbeat ya cubre |
| R2 | Budget blow-up | M | **L** (0 auto-dispatches reales, budget usage ~$0) | M | Sin cambio |
| R3 | Self-improve regresa Spanish | L | **L** (self-improve aún no arrancó) | Critical | P1 linter + sealed files + metric 10 backstop |
| R4 | Whitelist misclassification | L | **L** | H | + tests invariant B.2/S3 |
| R5 | Corpus drift | M | N/A (corpus no existe) | M | Diferido |
| R6 | LLM judge drift | M | N/A | M | Diferido |
| R7 | Franchise blocklist thrash | L | **L** | L | Sin cambio |
| R8 | 03:00 UTC clash | L | **L** (resuelto, 03:15 stagger en prod) | L | Sin cambio |
| R9 | Supabase key exposure | L | L | Critical | Sin cambio |
| R10 | Single-machine dependency | M | **M** (aún aplica hasta Option C) | H | Re-evaluar 2026-05-08 |
| **R11** | **Métrica verde por dataset vacío** | **M** | **H** | **M** | Guards de `sample_size<N → details.note='insufficient_*'`, green permitido pero explícito. `outreach_channel_split_24h` (V4) expone dataset vacío directamente. |
| **R12** | **Auto-dispatch franchise nunca dispara** | **M** | **H** (7d sin disparo = evidencia real) | **M** | Métrica V3 `whitelist_auto_dispatch_staleness_hours`. Si >336h (14d) → red. Obliga re-evaluación del threshold o retiro de la regla AUTO. |
| **R13** | **WhatsApp delivery 0/45 sin alert** | **L** | **H** (ya ocurrió, gap real) | **H** | **Resuelto por V1 + escalada A1 in-briefing** (V2 retirada del catálogo; la señal viaja como fila V1 + lógica escalada en `decisionFor()`). |

### B.7 Rollout v3 iteration 2 (2-3 semanas, gates empíricos)

**Semana que arranca 2026-04-24 — Implementación canal WA + detectores parálisis.**
- **D1 (2026-04-24):**
  - Crear `lib/autonomy_whitelist.js` como fuente canónica (C2): export `{ WHITELIST, decisionFor }`. Mover el objeto actualmente en `scripts/morning_briefing.js:32-60` a este archivo + extender con entries A1/A5 (ver B.4).
  - Crear test `tests/autonomy/whitelist_contract.spec.js` (C3) con tres asserts: (a) WHITELIST no vacío, (b) toda `suggested_action` producida por `workers/nightly_auditor.js` (lista B.2) tiene entry — falla si métrica nueva olvida entry, (c) toda entry con `decision==='AUTO'` tiene ralph template correspondiente en `.omc/ralph-templates/` (convención: `{action_lowercased}.md`) o flag explícito `skipTemplateCheck:true`.
  - Extender `workers/nightly_auditor.js` con V1+V4+10b (§B.3). V1 con `in_flight_count` en details (A4).
  - Stampear `wa_last_body` en `scripts/send_whatsapp_outreach.js` — prereq para 10b (A5).
  - Unit tests nuevos en `tests/autonomy/` (ver "Expanded Test Plan"). PR feature branch `autonomy-v3-iter2-wa-coverage`. Brian review.
- **D2 (2026-04-25):**
  - Refactor `scripts/morning_briefing.js` para importar de `lib/autonomy_whitelist.js`. Añadir escalada A1, staleness A2, budget cap A8 ($10).
  - Extender `writeBriefingLedger` con nuevos campos details.
  - PR mismo branch. Brian review.
- **D3 (2026-04-26):** aplicar `migrations/017_autonomy_audits_v3_indexes.sql` vía Supabase MCP tras aprobación humana (IR5).
- **D4 (2026-04-27):** dry-run auditor contra prod (`--dry-run`); snapshot filas nuevas; validar V1 captura fiasco 45/45 y expone `in_flight_count` correctamente.
- **D5-7 (2026-04-28 a 30):** observar 3 ciclos de briefing en prod; verificar escalada A1 (si V1 dispara red con denom≥10 y rate>60), verificar staleness A2 (si alguna regla AUTO>14d), verificar 10b (0 violaciones sobre template `cold_leads_welcome` como control).

**Semana 2026-05-01 — Gate empírico WhatsApp (A7, BLOCKER).**
- **D1 (2026-05-01):** consultar `campaign_enriched_data` y `autonomy_audits` últimos 14d. **Gate binario:**
  - Si ≥5 replies reales detectables (o proxy `outreach_status='CONTACTED'` escalado con evidencia de dos vías — inbound registrado): canal WA continúa; proceder con D2-7.
  - Si <5 replies: **congelar self-improve Helena indefinidamente**. Crear `.omc/plans/whatsapp-channel-decision-2026-05.md` documentando: (abandon WA / pivot fuente de números / IR6 para Twilio Lookup / re-arquitectura). Este gate es BLOCKER explícito antes de cualquier Week 4 self-improve v2.
- **D2-3:** Brian decide según gate. Documentar.
- **D4-7:** implementar decisión (env flip vía diff-for-approval si aplica; rollback `scripts/send_whatsapp_outreach.js` a disabled si se abandona).

**Semana 2026-05-08 — Evaluación Option C (condicionada al gate anterior).**
- Solo si gate 2026-05-01 aprueba continuar: pull `autonomy_briefings` últimos 14d, sizing Option C, diff-for-approval render.yaml (IR5).
- Si gate bloqueó: aplazar Option C hasta que WA decision esté implementada y haya ≥7d estables.

**Gates entre semanas:** cada domingo Brian+Claude retro corta. Si V1 resulta ruidosa, V4 nunca dispara red (threshold inútil), o 10b produce falsos positivos → stop-fix antes de continuar.

### B.7.1 Day-30 binary success criteria (C1)

Evaluación programada 2026-05-24 (30 días post-ship iter-2). Cada criterio es boolean ✅/❌:

- ✅ **V1 estable:** ≥14 días de V1 escribiendo sin que una sola fila tenga `severity='error'` (métrica no lanza excepción por schema drift, null-safe). Lookup: `SELECT COUNT(*) FROM autonomy_audits WHERE metric_name='wa_delivery_failure_rate_14d' AND severity='error' AND created_at > now()-14d` debe ser `0`.
- ✅ **V1 in_flight_count sano:** para todas las filas de V1, `details.in_flight_count < (details.denom + details.in_flight_count)` — el denominador no se colapsa a 0 por stamp-lag masivo. Si siempre `denom=0 AND in_flight_count>0`, el pipeline de stamps está roto y la métrica es inútil.
- ✅ **V4 discrimina:** al menos una ventana detectada `severity='red'` (combined<3) en 30 días. Si V4 NUNCA dispara red, el threshold es inútil y se debe re-evaluar — NO es un éxito de "todo verde".
- ✅ **Escalada A1 verificada:** briefing escala `INVESTIGATE_WA_DELIVERABILITY → DISABLE_WA_CHANNEL_TEMP` en ≥1 ocasión registrada (buscar `details.escalated_from_count >= 1` en algún row de `autonomy_briefings`). Confirma que la lógica A1 ejecuta correctamente en vez de quedar muerta.
- ✅ **Staleness A2 verificada:** banner `⚠️ STALENESS` impreso ≥1 vez (buscar `details.stale_auto_actions` no vacío en al menos un briefing). Confirma que A2 ejecuta.
- ✅ **10b sin falsos positivos:** 0 violaciones sobre el template activo `cold_leads_welcome` (control: plantilla validada manualmente como español-correcto). Si 10b marca violación sobre plantilla control, el linter o el stamp están mal.
- ✅ **Contract test CI-green:** `tests/autonomy/whitelist_contract.spec.js` pasa continuamente en CI (no se permite skip).

Si ≥2 criterios fallan a día 30: stop-fix, retrospectiva con Critic, ajustar thresholds o retirar métrica.

### B.8 ADR v3

**Decision:** Extender el sistema v2 con 4 métricas nuevas (WhatsApp delivery, WA derivada, whitelist staleness, channel split), 5 whitelist entries adicionales, consolidación de persistencia en briefing, y 1 índice Supabase aditivo. Sin tabla nueva, sin APIs pagas, sin cambios destructivos.

**Drivers:** cobertura-canal (dominante: fiasco WA 45/45 real), detección-parálisis-silenciosa (task #33 confirma regla AUTO muerta), presupuesto-real-vs-teórico (evaluar Option C con data, no estimar).

**Alternatives considered:**
- Option B (tabla `wa_delivery_events` dedicada) — rechazada: sobre-engineering para volumen piloto.
- Twilio Lookup paid API — rechazada: violaría IR6 hasta evidencia de ROI.
- Postponer WA coverage a v4 — rechazada: gap real ya causó fiasco.

**Why chosen:** Option A cumple las 3 restricciones IR (no cost center, no auto-merge, diff-for-approval Render) y resuelve gap real observado en piloto, con costo operativo ~0 y reversibilidad completa vía git revert.

**Consequences:**
- Upside: canal WA observable, parálisis silenciosa detectable, decisión WhatsApp documentada con datos.
- Downside: superficie de métricas crece (+4), briefing un poco más verboso (mitigado por consolidación S2).
- Footprint: ~+120 LOC worker, +80 LOC briefing, +5 test files, 1 migration (índice), 0 tabla nueva, 0 API paga.

**Follow-ups (v4 candidates):**
1. Reply pipeline build → desbloquea `sent_to_reply_rate_14d` + self-improve Helena.
2. Twilio Lookup decisión (solo si piloto retorna a canal WA post-2026-05-01 con aprobación IR6).
3. Monthly rollup `autonomy_audits_monthly`.
4. Option C (durable-cron) si Brian aprueba 2026-05-08 y gate A7 permite.
5. Extender cobertura a SMS/Baileys si volumen justifica.
6. Re-evaluar `BUDGET_CAP_USD` → $25 tras ≥3 auto-dispatches exitosos en 7d (A8).
7. **Refactor a `channel_events` unificado** (A9): deuda explícita reconocida — WA stamps viven en JSONB (`lead_magnets_data`), email vive en enum (`outreach_status`). El auditor v3 parcha aditivamente (queries distintas por canal). Trigger de refactor: cuando volumen WA supere **500 sends/semana sostenidos** durante 2 semanas. Hasta entonces, patch aditivo es coste-apropiado (evitar over-engineering prematuro).

---

## Section C — Changelog vs v2

| Categoría | v2 | v3 | Acción |
|---|---|---|---|
| Schema `autonomy_audits` | tabla base | sin cambios | Sobrevive |
| Heartbeat (metric 0) | presente | sin cambios | Sobrevive |
| Métricas 1-10 (sent_rate, sent_to_failure, outreach_events, top_combos, agent_error, scrapling_p95, ghl_error, llm_429, spanish_violation) | activas | sin cambios en lógica | Sobrevive |
| Métrica `llm_429_rate_24h` | añadida post-v2 | sin cambios | Sobrevive (ya lives en worker) |
| Métrica 4 `franchise_block_rate_7d` + 5 `industry_other_rate_7d` | plan v2 | verificar si faltan implementar antes de v3 ship | ⚠ Auditar en D1 v3 |
| `wa_delivery_failure_rate_14d` | no existe | nueva métrica nightly (V1, con `in_flight_count` details A4) | Añadir |
| `outreach_channel_split_24h` | no existe | nueva métrica nightly (V4, thresholds endurecidos A3) | Añadir |
| `whatsapp_spanish_violation_count_24h` | no existe | nueva métrica nightly (10b, A5 iter-2) | Añadir |
| `wa_channel_health_derived` (iter-1 V2) | no existe | **NO es métrica del nightly** — lógica in-briefing (A1 iter-2) | Relocar |
| `whitelist_auto_dispatch_staleness_hours` (iter-1 V3) | no existe | **NO es métrica del nightly** — helper in-briefing on-boot (A2 iter-2) | Relocar |
| WHITELIST entries (16) | base v2 | +5 entries + migrada a `lib/autonomy_whitelist.js` (C2 iter-2) | Extender + canonicalizar |
| BUDGET_CAP_USD default | $25 | **$10** (A8 iter-2) | Reducir |
| `.omc/self-improve/config/sealed_files.txt` | no existe | **creado iter-2** (A6) | Crear AHORA |
| Gate empírico 2026-05-01 | no existe | BLOCKER: <5 replies → congelar self-improve + plan WA decision (A7 iter-2) | Añadir |
| Day-30 binary success criteria | no existe | §B.7.1 (C1 iter-2) 7 criterios ✅/❌ | Añadir |
| `lib/autonomy_whitelist.js` | no existe | fuente canónica (C2 iter-2) | Crear W2026-04-24 D1 |
| `tests/autonomy/whitelist_contract.spec.js` | no existe | contract test CI (C3 iter-2) | Crear W2026-04-24 D1 |
| Consolidación persistente briefing | no existe | nueva | Añadir |
| Error bucket banner escalación | no existe | nueva | Añadir |
| Sealed files: `tools/baileysWhatsApp.js`, scripts de sends | implícito | **explícito** | Añadir a `.omc/self-improve/config/sealed_files.txt` cuando se cree |
| Option C durable-cron | Week 5 | 2026-05-08 con data | Reprogramar |
| Rollout teórico 4 semanas | v2 | rollout concreto 2 semanas | Reemplazar |
| Self-improve Helena | Week 3-5 diferido | bloqueado + corpus debe estratificar canal | Reforzar bloqueo |
| Twilio Lookup | no contemplado | explícitamente requiere IR6 | Marcar |
| Budget $25/día cap | v2 | mantiene hasta evidencia contraria | Sobrevive |
| Render heartbeat cron | diff pendiente | sigue diff-for-approval | Sobrevive |

**Retirado explícitamente (iteración 1):** nada. v3 iter-1 fue aditivo puro.

**Prerequisitos cumplidos:** P1 (linter) y P2 (recursion guard) de v2 ya están en disco — no re-ejecutar.

---

### Iteration 2 changes (9 Architect + 4 Critic = 13)

Aplicados sobre draft iter-1 tras review. Lista consolidada de cambios al plan (no al código — esto es plan, no implementación):

**Architect (9):**
1. **A1** — Retirar métrica V2 `wa_channel_health_derived` del catálogo del nightly; relocar como escalada in-briefing dentro de `decisionFor()` (cuando V1 red AND `denom>=10` AND `failure_rate>60` → escalar a `DISABLE_WA_CHANNEL_TEMP`, REPORT_ONLY, banner rojo). §B.2, §B.4.
2. **A2** — Retirar métrica V3 `whitelist_auto_dispatch_staleness_hours` del nightly; relocar como query on-boot en `scripts/morning_briefing.js` con banner staleness para acciones AUTO >336h unacked. No escribe fila. §B.2, §B.4.
3. **A3** — Endurecer thresholds V4 `outreach_channel_split_24h`: `min_volume_for_green=10` + green requiere `email>=5 AND wa>=5 AND combined>=10`; yellow=combined 3-9 o XOR; red=combined<3. §B.2.
4. **A4** — V1 expone `in_flight_count` en details (rows con `wa_message_id` pero sin `wa_delivery_status`). SQL revisada en §B.3.
5. **A5** — Añadir métrica 10b `whatsapp_spanish_violation_count_24h` via `lintSpanishOnly` sobre `lead_magnets_data.wa_last_body`. Prereq: stamp de WA body en `scripts/send_whatsapp_outreach.js` (W2026-04-24 D1). Acción `WHATSAPP_SPANISH_VIOLATION`, REPORT_ONLY, nunca auto-fix. §B.2, §B.3.
6. **A6** — Crear `.omc/self-improve/config/sealed_files.txt` AHORA (creado en este ralplan) con 24 paths (22 literales + 2 glob patterns `migrations/**` y `supabase/**`) incluyendo `lib/autonomy_whitelist.js`. §B.5.
7. **A7** — Gate empírico 2026-05-01 BLOCKER: si <5 replies reales en piloto, congelar self-improve Helena indefinidamente + crear `.omc/plans/whatsapp-channel-decision-2026-05.md`. §B.7.
8. **A8** — Bajar `BUDGET_CAP_USD` default $25 → $10. Re-evaluar a $25 solo tras ≥3 auto-dispatches exitosos/7d. §B.4, follow-up #6.
9. **A9** — Deuda explícita: schema multi-canal no resuelto (WA JSONB vs email enum). Follow-up #7: refactor a `channel_events` unificado cuando WA >500 sends/semana sostenidos.

**Critic (4):**
10. **C1** — §B.7.1 Day-30 binary success criteria: 7 criterios ✅/❌ para V1, V4, 10b, escalada A1, staleness A2, contract test, 10b falsos positivos sobre `cold_leads_welcome`.
11. **C2** — Crear `lib/autonomy_whitelist.js` como fuente canónica (export `{ WHITELIST, decisionFor }`); `scripts/morning_briefing.js` lo importa. Sellado en sealed_files.txt. Implementación en W2026-04-24 D1. §B.4.
12. **C3** — Test `tests/autonomy/whitelist_contract.spec.js` asserta WHITELIST no vacío, cada `suggested_action` del worker tiene entry, cada entry AUTO tiene ralph template. CI falla en drift. Expanded Test Plan + §B.7 D1.
13. **C4** — Aclaración explícita: SOLO V1, V4, 10b escriben filas nuevas a `autonomy_audits`. V2/V3 de iter-1 retiradas; su lógica vive in-briefing. §B.3, §B.4.

**Impacto neto:** superficie del auditor se reduce (3 métricas nuevas vs 4 iter-1), whitelist queda single-source (evita drift), budget más estricto, gate empírico 2026-05-01 previene self-improve sobre canal muerto. Deuda schema reconocida con trigger objetivo (500 sends/semana).
