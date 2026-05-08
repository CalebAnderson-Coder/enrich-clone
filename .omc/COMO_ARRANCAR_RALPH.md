# Cómo arrancar Ralph (Nivel 1 — construir mientras trabajás)

Ralph es un agente que lee la lista de mejoras en `.omc/prd.json` y las va completando una por una sin parar hasta terminar. Si una falla, reintenta. Si todas pasan revisión, recién ahí termina.

## Para arrancar

1. Abrí Claude Code en la carpeta `enrich-clone` (NO en otra carpeta — Ralph trabaja sobre el código que ve).
2. Escribí en el chat:
   ```
   ralph
   ```
   Listo. Va a leer `.omc/prd.json` y empezar por la historia US-001.

## Qué va a pasar

Ralph va a:
- Leer la lista de 6 mejoras priorizadas.
- Trabajar la primera (US-001 · Reporte Diario en pantalla). Cuando termine, marca `passes: true` y pasa a la siguiente.
- Cuando termina las 6, llama a un revisor independiente que verifica TODO antes de aprobar.
- Si el revisor rechaza algo, Ralph lo corrige y vuelve a verificar.

## Si querés frenarlo

En el chat:
```
/oh-my-claudecode:cancel
```
Ralph guarda el estado y la próxima vez retoma donde quedó.

## El backlog actual (6 historias)

1. **Reporte Diario de Atlas en pantalla** — el párrafo en español que Atlas ya genera, mostrado prominente en `/atlas`.
2. **Bandeja de Replies** — pestaña nueva con los leads que respondieron en últimas 72h.
3. **Funnel de Conversión** — visual con drop-off rate por etapa.
4. **Predicción "A este ritmo"** — proyección 30 días basada en últimos 7.
5. **Alerta por email a vos** cuando Atlas detecta CRITICAL.
6. **Tests del outbound loop** para que no se rompa de nuevo.

## Cuando Ralph termine

Vas a tener 6 features nuevas commiteadas, build pasando, y un email demostrando que el sistema de alertas anda. Para arrancar el Nivel 2 (correr esto solo de noche en GitHub Actions), avisame.

## Si querés agregar más historias

Editá `.omc/prd.json` antes de arrancar Ralph (o entre runs). Cada historia necesita:
- `id`: único
- `title`: corto
- `description`: contexto
- `acceptanceCriteria`: lista de cosas verificables (no genéricas como "está bien hecho")
- `passes: false`
- `priority`: número (Ralph trabaja en orden de prioridad)
