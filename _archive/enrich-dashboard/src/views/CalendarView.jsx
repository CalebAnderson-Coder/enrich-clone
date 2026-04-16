import React from 'react';

export default function CalendarView() {
  return (
    <div style={{ padding: '40px', color: 'var(--text-primary)' }}>
      <h2>Calendario Editorial & de Tareas</h2>
      <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
        Aquí organizaremos los posteos automáticos y correos que los agentes tienen planificado enviar durante la semana.
      </p>
      
      <div style={{ marginTop: '32px', height: '400px', backgroundColor: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--text-muted)' }}>[Interfaz visual de Calendario Kanban]</span>
      </div>
    </div>
  );
}
