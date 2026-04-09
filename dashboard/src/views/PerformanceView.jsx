import React from 'react';

export default function PerformanceView() {
  return (
    <div style={{ padding: '40px', color: 'var(--text-primary)' }}>
      <h2>Rendimiento de las Campañas</h2>
      <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
        Aquí visualizaremos el impacto (ROAS, conversiones, aperturas) de las tareas ejecutadas por los Agentes.
      </p>
      
      <div style={{ marginTop: '32px', display: 'flex', gap: '16px' }}>
        <div style={{ flex: 1, height: '200px', backgroundColor: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>[Gráfico de Leads Semanales]</span>
        </div>
        <div style={{ flex: 1, height: '200px', backgroundColor: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>[Gráfico de Conversión por Agente]</span>
        </div>
      </div>
    </div>
  );
}
