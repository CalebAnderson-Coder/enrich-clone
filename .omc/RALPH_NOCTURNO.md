# Ralph Nocturno — cómo se activa

El sistema construye solo de noche. Falta un solo paso para que arranque.

## Lo que falta

Tenés que pegar tu API key de Anthropic en GitHub. Una sola vez. Después se olvida.

### Paso 1 — conseguir la API key (2 minutos)

1. Andá a https://console.anthropic.com/settings/keys
2. Login con la misma cuenta que usás para Claude Pro/Max.
3. Apretá **Create Key**.
4. Nombre sugerido: `ralph-night-empirika`.
5. Copialo (empieza con `sk-ant-...`).

### Paso 2 — pegarla en GitHub (1 minuto)

1. Andá a https://github.com/CalebAnderson-Coder/enrich-clone/settings/secrets/actions
2. Apretá **New repository secret**.
3. Name: `ANTHROPIC_API_KEY`
4. Value: pegá la key que copiaste.
5. **Add secret**.

Listo. A partir de la próxima medianoche (UTC), Ralph trabaja solo.

## Cómo funciona la madrugada

A las **04:00 UTC** (1 AM Argentina, 12 AM Miami):

1. GitHub levanta una máquina nueva.
2. Bajá el repo, instala las dependencias.
3. Crea una rama: `ralph-night/2026-05-09-0400`.
4. Lanza Claude Code con la consigna "leé `.omc/prd.json` y trabajá las pendientes".
5. Ralph elige la historia con prioridad más alta sin terminar (hoy: US-007 lazy-load del bundle).
6. Cuando termina la historia: build pasa, test pasa, commit con mensaje claro.
7. Pasa a la siguiente.
8. Hasta 4 horas máximo (límite duro del runner).
9. Cuando para — sea porque terminó todo o porque llegó al tope — abre un **Pull Request** contra `master`.

A la mañana entrás a tu mail o a GitHub y vas a tener un PR esperando con todo lo que trabajó. Si te gusta: **Merge**. Si no: cerrás el PR y nada cambió en producción.

## Costo estimado

Cada noche cuesta entre **$5 y $15 USD** dependiendo de cuántas historias avanza. Sale de tu cuenta de Anthropic (no de la suscripción Pro/Max que usás vos). Si querés bajarlo, hay alternativas (Claude Max Proxy que descubrimos antes) — avisame y te lo configuro.

## Para arrancarlo manualmente sin esperar la noche

1. Andá a https://github.com/CalebAnderson-Coder/enrich-clone/actions
2. Click en **"Ralph nocturno · construir SaaS"** en la lista de la izquierda.
3. Botón **Run workflow** (arriba a la derecha).
4. Si querés, escribí en `story_filter` algo como `US-007` para que solo trabaje esa.
5. **Run workflow**.

Empieza al toque, ves el progreso en vivo.

## Para frenar todo

Si querés pausar el sistema (vacaciones, ajustes, lo que sea):

1. https://github.com/CalebAnderson-Coder/enrich-clone/settings/actions
2. **Disable Actions for this repository**.

Cuando lo querés volver a prender, mismo lugar, **Enable**.

## Backlog actual (lo que tiene para hacer)

```
US-007  Bundle del dashboard más liviano (carga más rápido)
US-008  Cuando un lead responde, sincroniza la nota en GHL automáticamente
US-009  Tracker de costo por lead — saber cuánto cuesta cada uno
US-010  Métricas de cuántos mensajes Atlas rescató (visible en /atlas)
US-011  Preparar el sistema para cliente #2 sin romper Empírika
US-012  Pasarela de aprobación manual para industrias específicas (José pidió esto)
```

Cuando Ralph las termine, se queda esperando hasta que vos (o yo) le agreguemos más historias al `prd.json`. No hace nada por su cuenta sin instrucciones.
