<#
.SYNOPSIS
Demonio de Background Híbrido para automatizar tareas usando Claw Code 24/7.
.DESCRIPTION
Lee iterativamente ROADMAP.md. Si detecta la etiqueta [LOCAL], ruta a Gemma en tu ordenador.
Si no, usa Claude 3.5 Sonnet en OpenRouter para tareas complejas.
#>

$roadmapPath = "ROADMAP.md"
$logsPath = "AGENT_LOGS.md"
$sleepSeconds = 300 # 5 min

function Log-Message {
    param([string]$message)
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logEntry = "[$timestamp] $message"
    Write-Host $logEntry -ForegroundColor Cyan
    Add-Content -Path $logsPath -Value $logEntry
}

Log-Message "Iniciando el Demonio Autónomo Híbrido (OpenRouter + Local)..."

while ($true) {
    if (Test-Path $roadmapPath) {
        $roadmapContent = Get-Content $roadmapPath
        $openTasks = $roadmapContent | Where-Object { $_ -match "^-\s?\[ \]" }

        if ($openTasks.Count -gt 0) {
            $taskLine = $openTasks[0]
            Log-Message "================================================="
            Log-Message "Tarea encontrada: $taskLine"
            
            # --- RUTEO DINÁMICO DE MODELOS ---
            if ($taskLine -match "\[LOCAL\]" -or $taskLine -match "\[SIMPLE\]") {
                Log-Message "🤖 TAG DETECTADO: Enrutando tarea sencilla a tu modelo LOCAL (Ollama/Gemma)..."
                $env:OPENAI_BASE_URL="http://127.0.0.1:11434/v1"
                $env:OPENAI_API_KEY="ollama"
                $env:MODEL="gemma"
            } else {
                Log-Message "🧠 TAREA PESADA: Enrutando al Arquitecto Claude 3.5 Sonnet (vía OpenRouter)..."
                $env:OPENAI_BASE_URL="https://openrouter.ai/api/v1"
                $env:OPENAI_API_KEY=$env:OPENROUTER_API_KEY
                $env:MODEL="anthropic/claude-3.5-sonnet"
            }

            $prompt = "Eres un desarrollador autónomo trabajando en nuestro SaaS. Meta: '$taskLine'. Revisa los archivos del repositorio, escribe el código necesario, márcala como hecha y escribe el reporte."
            
            try {
                Log-Message "Despertando a la CLI del Agente..."
                # Ejecutar CLI compilada desde el repo y pasarle las credenciales del entorno
                .\claw-code\rust\target\debug\claw.exe prompt $prompt
                Log-Message "Claw Code ha terminado su iteración."
            } catch {
                Log-Message "Error crítico invocando a Claw Code. Puede que la CLI haya fallado o cerrado bruscamente."
            }
            Log-Message "================================================="
        } else {
            Log-Message "ROADMAP vacío. Ninguna tarea pendiente."
        }
    }

    Log-Message "Demonio entrando en fase de sueño durante $sleepSeconds segundos..."
    Start-Sleep -Seconds $sleepSeconds
}
