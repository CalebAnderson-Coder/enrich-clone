import React from 'react';

export default function HistoryView() {
  return (
    <div style={{ padding: '40px', color: 'var(--text-primary)' }}>
      <h2>Historial de Chats Internos</h2>
      <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
        Revisa las antiguas instrucciones y sesiones de trabajo que has tenido con el equipo autónomo.
      </p>
      
      <div style={{ marginTop: '32px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {['Estrategia Q3 con Manager', 'Creación de emails con Helena', 'Revisión de Base de Datos'].map(chat => (
          <div key={chat} style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
            <span style={{ fontWeight: 600 }}>{chat}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Hace 2 días</span>
          </div>
        ))}
      </div>
    </div>
  );
}
