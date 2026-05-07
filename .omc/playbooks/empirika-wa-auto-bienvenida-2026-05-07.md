# Playbook — Workflow `05-AUTO BIENVENIDA WA INBOUND`

**Cliente:** Empírika · **Fecha:** 2026-05-07 · **Tiempo estimado:** 10 min

Este playbook te guía paso a paso, José, para crear el workflow que responde automáticamente cuando un lead te escribe por primera vez a WhatsApp `+56 9 2248 0500` (botón embebido en el correo enviado hoy a 32 leads HVAC FL).

---

## Parte 1 — Crear el workflow en GoHighLevel

En el menú izquierdo: **Automation → Workflows → + Create Workflow → Start from scratch**. Nombre exacto: `05-AUTO BIENVENIDA WA INBOUND`. Folder: `Empírika`. Click **Build**.

### Trigger

1. Click **+ Add New Trigger**.
2. Tipo: **Customer Replied** (también aparece como *Inbound Message*).
3. Filters → **Channel = WhatsApp** (ÚNICAMENTE WhatsApp; deja SMS/Email fuera).
4. Save.

### Filtro de idempotencia (CRÍTICO)

1. Arrastra un nodo **If/Else** justo después del trigger.
2. Condición: **Contact → Tags → does NOT contain → `wa-conversacion-iniciada`**.
3. Branch **YES** = continuar al Action 1. Branch **NO** = nodo **End workflow** (no respondas dos veces al mismo lead durante la misma conversación).

### Action 1 — Send WhatsApp (3 variantes para A/B test)

Nodo **Send Message → Channel: WhatsApp**. Body = una de estas tres (empieza con la **A**, mide reply rate 1 semana, rota):

**Variante A — cálida y casual**

> ¡Hola! Soy José de Empírika 👋 Gracias por escribirme. Vi que recibiste el correo y me alegra mucho que te interese conocer cómo ayudamos a negocios HVAC latinos en Florida a llenar su agenda. Te respondo personalmente en cuanto esté en horario (9–18 hrs ET). Si quieres, agenda 15 min directo en mi calendario: https://api.leadconnectorhq.com/widget/booking/calendario-empirika

**Variante B — concisa**

> Hola, José aquí. Me alegra mucho que te hayan llegado las ideas. Te leo en cuanto entre a horario y te respondo personalmente. Mientras, si prefieres, puedes agendar 15 min: https://api.leadconnectorhq.com/widget/booking/calendario-empirika

**Variante C — CTA fuerte de calendario**

> ¡Hola! Soy José, fundador de Empírika. Para no hacerte esperar, agendemos directo: https://api.leadconnectorhq.com/widget/booking/calendario-empirika — 15 min, sin compromiso, y ahí te muestro 2 ó 3 ideas concretas para tu negocio. Si prefieres seguir por aquí, dime y te respondo personalmente apenas entre a horario.

### Action 2 — Add Tag

Nodo **Add Contact Tag** → tag: `wa-conversacion-iniciada`.

### Action 3 — Mover oportunidad de NUEVO a INTERESADO

Nodo **Update Opportunity**:
- Pipeline: `COLD LEADS | GOOGLE MY BUSINESS` (id `PbSBohJh1m1L08INwMzv`)
- Stage: **INTERESADO** (id `458e660d-099c-445b-8a64-376e7e2df558`)
- Si el contacto NO tiene oportunidad en ese pipeline el nodo se salta solo (no falla).

### Action 4 — Add Internal Note

Nodo **Add Note to Contact**. Body exacto:

```
[empirika-wa-inbound:v1] Lead inició conversación por WhatsApp el {{trigger_event_timestamp}}. Auto-bienvenida enviada. Stage movido a INTERESADO.
```

### Action 5 — Notificarte a ti

Nodo **Internal Notification**:
- Recipients: `Jose Sanchez` (tu usuario)
- Channels: **In-App** + **Email**
- Subject: `WA inbound: {{contact.first_name}} {{contact.last_name}}`
- Body: `{{contact.first_name}} te escribió por WhatsApp. Mensaje: "{{message.body}}". Calendario ya enviado automáticamente.`

### Cierre

Después del Action 5, nodo **End Workflow**. **Save → Publish → toggle ON**.

---

## Parte 2 — Verificación (5 checks, 5 min)

1. Desde tu número personal, manda un WhatsApp de prueba a `+56 9 2248 0500` con texto cualquiera ("test").
2. Confirma que la respuesta automática (Variante A) llega en **menos de 1 minuto**.
3. Abre tu contacto de prueba en GHL → tab **Tags** → verifica que aparezca `wa-conversacion-iniciada`.
4. Para validar el cambio de stage, primero crea (o usa) un contacto de prueba con una oportunidad ya en NUEVO en el pipeline `COLD LEADS | GOOGLE MY BUSINESS`, mándale WhatsApp inbound, y confirma que la oportunidad queda en **INTERESADO**.
5. Revisa tu bandeja in-app y tu correo: debe haber llegado la notificación interna con el mensaje del lead.

Si alguno falla → desactiva el workflow, abre el log de ejecución (botón **Execution Logs** arriba a la derecha del workflow) y revisa qué nodo dio error antes de reactivar.

---

## Parte 3 — Caveats y reglas

Este workflow **solo dispara para mensajes WhatsApp INBOUND** — el lado outbound sigue bloqueado por la pausa de Marketing en US de Meta hasta que tu plantilla UTILITY esté aprobada o Meta levante la pausa; mientras tanto, el único camino para abrir conversación es que el lead te escriba primero (botón `wa.me` del correo). La ventana de servicio al cliente de 24 h arranca exactamente en el momento en que el lead manda su primer mensaje: dentro de esas 24 h puedes mandarle texto, links, imágenes, lo que sea, sin plantilla y sin restricción de categoría; pasadas 24 h de inactividad ya no puedes mandar free-form (solo plantilla utility si la tienes aprobada). El tag `wa-conversacion-iniciada` es el seguro de idempotencia: garantiza que el auto-reply solo se manda **una vez** por lead, así cuando él te conteste de vuelta dentro de la misma conversación tú respondes manualmente sin que el bot le siga mandando saludos. Si por alguna razón el workflow dispara sobre un contacto cuya oportunidad ya está en INTERESADO (o en cualquier stage posterior), el Action 3 simplemente reescribe el stage a INTERESADO — si ya estaba ahí es un no-op inofensivo; si estaba en CONTACTADO lo regresa a INTERESADO, lo cual está bien porque INTERESADO refleja correctamente que el lead respondió. Si está en stages posteriores al pipeline (ej. cerrada-ganada en otro pipeline), considera agregar más adelante un If/Else extra que solo mueva si la oportunidad está en NUEVO o CONTACTADO.
