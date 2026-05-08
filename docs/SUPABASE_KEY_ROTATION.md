# Supabase Key Rotation — Legacy → New API Keys

**Contexto:** Supabase deshabilitó las "legacy API keys" (el par `anon` + `service_role` en formato JWT largo). Ahora ofrece dos keys nuevas:

- **Publishable key** (`sb_publishable_...`) — reemplaza al legacy `anon key`. Segura para el browser / builds Vite.
- **Secret key** (`sb_secret_...`) — reemplaza al legacy `service_role`. Solo server-side, nunca al cliente.

Este doc asume que ya tenés sesión en el dashboard de Supabase del proyecto `wzdhxnnpupbybxzbdrna`. **No ejecutes nada** hasta haber generado las nuevas keys.

---

## 1. Env vars exactas que usa el código

Verificadas con grep contra el repo (no son adivinanza).

### Backend / Node (leen `process.env.*`)

| Env var | Tipo de key | Archivos clave |
|---|---|---|
| `SUPABASE_URL` | URL (no rota) | `lib/supabase.js:9`, `index.js:1008,1421`, `lyra-engine/lib/logger.js:13`, `scripts/*` |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | `lib/supabase.js:10` (primary), `index.js:1008,1421`, `outreach_dispatcher.js:37`, `lead_magnet_worker.js:23`, `scripts/validate_lead_domains.js` (via `lib/supabase.js`), `audit2.mjs`, `insert_test_lead.js`, `regenerate_*_drafts.js`, `scrape_emails.cjs`, `scripts/*`, `lyra-engine/lib/logger.js:14` (fallback) |
| `SUPABASE_SERVICE_KEY` | **secret** (alias) | `lib/supabase.js:10` (fallback), `outreach_dispatcher.js:37`, `lead_magnet_worker.js:23`, `lyra-engine/lib/logger.js:14` (primary en Lyra), `scripts/ghl_backfill_draft_phone.js:25` |
| `SUPABASE_ANON_KEY` | **publishable** | `lib/supabase.js:10` (last-resort fallback), `supabaseUtils.js:6`, `campaign_rag.js:8` (fallback), múltiples `scripts/*` como fallback |

> **Nota crítica:** El backend trata `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_SERVICE_KEY` como sinónimos — ambos deben recibir la **misma** nueva `sb_secret_...`. En `.env` actualmente tienen el mismo valor; mantené esa invariante.

### Frontend / Vite build (leen `import.meta.env.VITE_*`)

| Env var | Tipo de key | Archivo |
|---|---|---|
| `VITE_SUPABASE_URL` | URL (no rota) | `dashboard/src/lib/supabaseAuthClient.js:4` |
| `VITE_SUPABASE_ANON_KEY` | **publishable** | `dashboard/src/lib/supabaseAuthClient.js:5` |
| `VITE_SUPABASE_SERVICE_KEY` | **(obsoleta)** | Declarada en `render.yaml:64` pero **nunca leída** en `dashboard/src/**`. Candidata a borrar. No le pongas la secret key. Si querés ser conservador, dejala vacía. |

### Cron Jobs (Render)

| Cron | Env vars Supabase | Fuente |
|---|---|---|
| `validate-lead-domains-nightly` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `render.yaml:141-144` → `scripts/validate_lead_domains.js` usa `lib/supabase.js` |
| `lyra-daily-engine` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | `render.yaml:165-168` → `lyra-engine/lib/logger.js:14` prioriza `SUPABASE_SERVICE_KEY` |

---

## 2. Mapping: nueva key → env vars que reciben su valor

Confirmado contra código real.

```
sb_publishable_...  →  SUPABASE_ANON_KEY
                       VITE_SUPABASE_ANON_KEY

sb_secret_...       →  SUPABASE_SERVICE_ROLE_KEY
                       SUPABASE_SERVICE_KEY
                       (NO al frontend, NO a VITE_*)
```

`SUPABASE_URL` y `VITE_SUPABASE_URL` **no cambian** — la project URL sigue siendo `https://wzdhxnnpupbybxzbdrna.supabase.co`.

---

## 3. Pasos en Supabase Dashboard

1. Login → proyecto `wzdhxnnpupbybxzbdrna` (Empírika).
2. **Settings → API Keys** (sidebar izquierdo).
3. En la sección **"New API keys"**:
   - Click **"Create publishable key"** → copiá el string `sb_publishable_...`. Guardalo en un password manager.
   - Click **"Create secret key"** → nombralo `empirika-backend-2026-04`. Copiá el string `sb_secret_...`. **Solo se muestra una vez.** Guardalo.
4. **No revoques legacy keys todavía.** Primero despliega las nuevas keys en Render y validá smoke test. Revocás al final (paso 7).

---

## 4. Reemplazo local en `.env`

Asumiendo los placeholders:

- `<NEW_PUBLISHABLE>` = el `sb_publishable_...`
- `<NEW_SECRET>` = el `sb_secret_...`

### Opción A — Bash / Git Bash / WSL

```bash
cd "/c/Users/Agencia IA/Claude Code/enrich-clone"
cp .env .env.backup-$(date +%Y%m%d)

# Reemplazo in-place con sed (GNU sed; en macOS usar: sed -i '')
sed -i "s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=<NEW_SECRET>|" .env
sed -i "s|^SUPABASE_SERVICE_KEY=.*|SUPABASE_SERVICE_KEY=<NEW_SECRET>|" .env
sed -i "s|^SUPABASE_ANON_KEY=.*|SUPABASE_ANON_KEY=<NEW_PUBLISHABLE>|" .env
sed -i "s|^VITE_SUPABASE_ANON_KEY=.*|VITE_SUPABASE_ANON_KEY=<NEW_PUBLISHABLE>|" .env

grep "^SUPABASE\|^VITE_SUPABASE" .env
```

### Opción B — PowerShell

```powershell
cd "C:\Users\Agencia IA\Claude Code\enrich-clone"
Copy-Item .env ".env.backup-$(Get-Date -Format yyyyMMdd)"

$NEW_PUBLISHABLE = "sb_publishable_REEMPLAZAR"
$NEW_SECRET      = "sb_secret_REEMPLAZAR"

(Get-Content .env) `
  -replace '^SUPABASE_SERVICE_ROLE_KEY=.*', "SUPABASE_SERVICE_ROLE_KEY=$NEW_SECRET" `
  -replace '^SUPABASE_SERVICE_KEY=.*',      "SUPABASE_SERVICE_KEY=$NEW_SECRET" `
  -replace '^SUPABASE_ANON_KEY=.*',         "SUPABASE_ANON_KEY=$NEW_PUBLISHABLE" `
  -replace '^VITE_SUPABASE_ANON_KEY=.*',    "VITE_SUPABASE_ANON_KEY=$NEW_PUBLISHABLE" |
  Set-Content .env

Select-String -Path .env -Pattern '^SUPABASE|^VITE_SUPABASE'
```

---

## 5. Checklist Render Dashboard

Para cada servicio, **Environment** tab → pegar el nuevo valor → **Save Changes** (dispara redeploy automático).

### Servicio web: `agency-fleet-runtime`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` → `sb_secret_...`
- [ ] `SUPABASE_SERVICE_KEY` → `sb_secret_...` (mismo valor)
- [ ] `SUPABASE_ANON_KEY` → `sb_publishable_...`
- [ ] `VITE_SUPABASE_ANON_KEY` → `sb_publishable_...`
- [ ] `VITE_SUPABASE_SERVICE_KEY` → dejar vacío o borrar (no se usa; ver sección 1)
- [ ] `SUPABASE_URL` y `VITE_SUPABASE_URL` — **no tocar**

### Cron: `validate-lead-domains-nightly`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` → `sb_secret_...`

### Cron: `lyra-daily-engine`
- [ ] `SUPABASE_SERVICE_KEY` → `sb_secret_...`

**Tip:** Render redeploya automáticamente en cambios de env. Esperá que el web service termine deploy antes de smoke-testear (`Events` tab → "Deploy live").

---

## 6. Smoke test post-rotación

### 6a. Publishable key (REST con header `apikey`)

```bash
curl -s -H "apikey: <NEW_PUBLISHABLE>" \
     "https://wzdhxnnpupbybxzbdrna.supabase.co/rest/v1/brands?select=id&limit=1"
```

**Esperado:** JSON con 1 row, algo como `[{"id":"eca1d833-77e3-4690-8cf1-2a44db20dcf8"}]`.
**Rojo:** `{"message":"Invalid API key"}` o `401`.

### 6b. Secret key (escritura server-side)

```bash
curl -s -H "apikey: <NEW_SECRET>" \
     -H "Authorization: Bearer <NEW_SECRET>" \
     "https://wzdhxnnpupbybxzbdrna.supabase.co/rest/v1/brands?select=id,name&limit=5"
```

**Esperado:** JSON con rows incluso si RLS las oculta al anon (la secret key bypasea RLS).

### 6c. Frontend

1. Abrir Render URL del `agency-fleet-runtime` (prod).
2. Login dashboard → verificar que carga leads sin error `Invalid API key` en consola.
3. Network tab → request a `*.supabase.co/auth/v1/*` debe devolver `200`, no `401`.

### 6d. Backend local

```bash
cd "C:\Users\Agencia IA\Claude Code\enrich-clone"
node -e "import('./lib/supabase.js').then(async ({ supabase }) => { const { data, error } = await supabase.from('brands').select('id').limit(1); console.log({ data, error }); })"
```

**Esperado:** `{ data: [{id: '...'}], error: null }`.

### 6e. Crons (opcional, dry-run local)

```bash
SUPABASE_SERVICE_ROLE_KEY=<NEW_SECRET> node scripts/validate_lead_domains.js --dry-run
```

---

## 7. Revocar legacy keys (solo después de que 6a–6d pasen)

Dashboard Supabase → **Settings → API Keys → Legacy API Keys** → **Disable** (o "Revoke") en el anon y service_role viejos.

**Importante:** Una vez revocadas, cualquier deploy con env vars viejas rompe inmediatamente. Por eso se revoca al final.

---

## 8. Rollback plan

Si el smoke test falla después de flipear Render:

1. **No revoques las legacy keys todavía** (por eso el paso 7 es al final).
2. En Render, para cada servicio afectado, volvé a pegar los valores viejos:
   - `SUPABASE_ANON_KEY` = JWT largo original (el que empieza con `eyJhbGciOi...` y tiene `role:anon`).
   - `SUPABASE_SERVICE_ROLE_KEY` = valor `sb_secret_mwO3_...` actual (ya es secret format, pero la legacy equivalente si la tenés en el backup).
   - `VITE_SUPABASE_ANON_KEY` = mismo JWT anon legacy.
3. El backup local está en `.env.backup-YYYYMMDD` (del paso 4).
4. Save Changes en Render → esperar redeploy → confirmar con smoke test 6a contra legacy key.
5. Debuggear por qué las nuevas keys fallan (lo más común: faltó rebuild del frontend porque Vite inlinea las `VITE_*` en build time; forzar "Clear build cache & deploy").

### Gotcha principal: Vite build cache

`VITE_SUPABASE_ANON_KEY` se **inlinea al bundle** en build time. Cambiarla en Render env no se propaga al frontend hasta un **redeploy con rebuild completo**. Si el dashboard sigue tirando "Invalid API key" después de actualizar env y ver "Deploy live", andá a Render → servicio → **Manual Deploy → Clear build cache & deploy**.

---

## 9. Archivos que NO tocar en esta rotación

- `.env.example` — no contiene secretos reales.
- `scripts/fix_outreach_batch.mjs:12` — tiene el legacy anon hardcoded como fallback. Opcional: borrar ese fallback en un commit separado (cleanup), no bloquea la rotación.
- Cualquier archivo en `_archive/`, `tmp/`, `output/`.
