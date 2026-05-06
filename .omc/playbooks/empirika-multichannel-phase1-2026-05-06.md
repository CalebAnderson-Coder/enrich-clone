# Empírika · Playbook Multicanal Fase 1

**Fecha:** 2026-05-06 · **Tiempo estimado:** 20 minutos · **Audiencia:** José / Paola

Este playbook crea **dos workflows en GoHighLevel** que la API no nos deja crear de forma programática (la creación de workflows es solo desde la UI). Sigue los pasos en orden.

---

## Parte 1 — Workflow `03-FU IG MANUAL DAY 5`

**Objetivo:** Cuando un lead lleva más de 5 días en `NUEVO` sin respuesta, avisarle a una persona del equipo para que mande un DM manual desde `@empirikagroup`.

**Pasos en la UI de GHL:**

1. Ve a **Automation → Workflows → + Create Workflow → Start from scratch**.
2. Nombra el workflow exactamente: `03-FU IG MANUAL DAY 5`. Folder: `Empírika`.
3. **Trigger** (clic en `+ Add New Workflow Trigger`):
   - Tipo: **Pipeline Stage Changed**
   - Pipeline: `COLD LEADS | GOOGLE MY BUSINESS`
   - Stage: `NUEVO`
   - Filtros (botón `Add filters`):
     - `Tag` *does not contain* `replied-via-ig`
     - `Tag` *does not contain* `replied`
   - Guarda el trigger.
4. **Acción 1 — Wait:**
   - `+ Add Action → Wait`
   - Wait Type: **Time Delay**
   - Duration: `5 days`
   - "Wait until contact has condition met" → activa la opción y agrega:
     - `Custom Field: first_contact_date is more than 5 days ago`
5. **Acción 2 — If/Else (guard de salida):**
   - `+ Add Action → If/Else`
   - Branch A condition: `Tag contains replied-via-ig` → en esta rama agrega `End this workflow`.
   - Branch B (Else): continúa al paso 6.
6. **Acción 3 — Internal Notification:**
   - `+ Add Action → Internal Notification`
   - Notification Type: marca **In-App** y **Email**
   - Recipient: `Assigned User` (fallback: usuario `Jose Sanchez`)
   - Subject: `DM IG manual pendiente — {{contact.company_name}}`
   - Message:
     ```
     Hola {{user.first_name}},
     Mandar DM manual desde @empirikagroup a {{contact.company_name}}.
     IG del lead: {{contact.emprika__instagram_url}}
     Ciudad: {{contact.city}} | Industria: {{contact.industry}}
     Contexto: lleva 5 días en NUEVO sin responder al cold email.
     ```
7. **Acción 4 — Add Tag:**
   - `+ Add Action → Add Contact Tag`
   - Tag: `dm-ig-pendiente`
8. **Settings del workflow** (engranaje arriba a la derecha):
   - **Allow Re-Entry:** OFF
   - **Stop on response:** ON → marca *Email, SMS, FB, IG, WhatsApp*
   - **Execution window:** Lun-Vie 9:00-18:00 (zona horaria Miami)
9. Botón **Save** y luego **Publish** (el toggle arriba derecha pasa de Draft a Publish).

> **Nota sobre el stop:** además del stop nativo de GHL, configuramos en el If/Else un corte por tag `replied-via-ig`. Esa tag la agregamos manualmente cuando el lead contesta el DM, o automáticamente desde el workflow de la Parte 2.

---

## Parte 2 — Workflow `04-COMMENT-TO-DM ORGANICO`

**Objetivo:** Cuando alguien comenta `WEB` o `DEMO` en un post de `@empirikagroup`, mandarle un DM automático con link al calendario.

**Pasos:**

1. **Automation → Workflows → + Create Workflow → Start from scratch**.
2. Nombre: `04-COMMENT-TO-DM ORGANICO`. Folder: `Empírika`.
3. **Trigger:**
   - Tipo: **Instagram Comment**
   - Account: `@empirikagroup` (debe aparecer ya conectada; si no aparece, ve a `Settings → Integrations → Instagram` y reconecta).
   - Posts: `Any Post` (o selecciona los 3-5 reels donde quieras correrlo).
   - Comment contains keywords: `WEB, DEMO, web, demo` (separadas por coma).
4. **Acción 1 — Send Instagram DM:**
   - `+ Add Action → Send Instagram Message`
   - From: `@empirikagroup`
   - To: `{{trigger.commenter_username}}`
   - Message: usa una de las 3 variantes (rotar manualmente cada 2 semanas para A/B):

   **Variante A (cálida + curiosidad):**
   ```
   ¡Hola {{trigger.commenter_first_name}}! Gracias por comentar 🙌
   Te mando el link para que veas en 15 min cómo Empírika llena agendas
   de negocios latinos: https://api.leadconnectorhq.com/widget/booking/He3CU7GsD5gAvYQ21EcW
   ¿Cuál es tu negocio? Así te preparo el demo con tu industria.
   ```

   **Variante B (directa + prueba social):**
   ```
   ¡Qué bueno verte por acá! 🚀 Ya tenemos +30 negocios latinos
   creciendo con nosotros. Reserva 30 min sin costo y te muestro
   exactamente cómo: https://api.leadconnectorhq.com/widget/booking/He3CU7GsD5gAvYQ21EcW
   ```

   **Variante C (pregunta primero):**
   ```
   ¡Hola! Antes de mandarte el demo, cuéntame: ¿qué tipo de negocio
   manejas y dónde estás ubicado? Con eso te preparo algo específico
   y agendamos 30 min: https://api.leadconnectorhq.com/widget/booking/He3CU7GsD5gAvYQ21EcW
   ```
5. **Acción 2 — Create Contact** (si no existe ya):
   - `+ Add Action → Find/Create Contact`
   - Source: `Instagram Comment`
   - Tag: `ig-organic-inbound`
   - Pipeline: `COLD LEADS | GOOGLE MY BUSINESS` · Stage: `INTERESADO`
6. **Acción 3 — Internal Notification** al equipo (in-app):
   - Subject: `Nuevo inbound IG: @{{trigger.commenter_username}}`
7. **Settings:** Allow Re-Entry: OFF · Stop on response: ON.
8. **Save → Publish.**

---

## Parte 3 — Checklist de verificación (correr después de cada workflow)

- [ ] El workflow aparece en estado **Published** (no Draft) en la lista.
- [ ] Crea un contacto dummy (`test@empirika.com`) y dispara el trigger manualmente: para WF 03 mueve el contacto a stage `NUEVO` con `first_contact_date` de hace 6 días; para WF 04 comenta `DEMO` en un post desde una cuenta secundaria.
- [ ] Abre **Workflow → History** y confirma que la ejecución aparece con status `Completed` (verde) y sin errores rojos.
- [ ] Para WF 03: revisa que llegó la notificación in-app al usuario asignado y que el contacto tiene la tag `dm-ig-pendiente`.
- [ ] Para WF 04: confirma que el DM salió desde `@empirikagroup` (revisa en la app de Instagram, bandeja **Enviados**) y que el contacto se creó con tag `ig-organic-inbound`.

---

## Parte 4 — Qué automatizamos vs qué queda manual (honestidad brutal)

El DM frío en Instagram a desconocidos **no es automatizable**: Meta bloquea cualquier mensaje saliente a usuarios que no han iniciado conversación. La única forma compliant de hacer cold outreach por IG es que una persona abra la app y mande el DM a mano desde `@empirikagroup` — por eso el WF 03 dispara una notificación, no un mensaje. Los dos workflows solo se ejecutan cuando el lead **opta por entrar** (comenta un post o ya entró por cold email). El cold email sigue siendo el canal automatizado #1 y el cron de follow-up 48h en Render corre en paralelo. Si quieres más volumen orgánico, la palanca real es publicar más reels con CTA `comenta WEB`, no más automatización.
