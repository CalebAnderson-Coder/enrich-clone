import React from 'react';

export default function IntegrationsView() {
  return (
    <div style={{ padding: '40px', color: 'var(--text-primary)' }}>
      <h2>Integraciones Activas</h2>
      <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
        Conecta las cuentas de tus clientes (Instagram, Mautic, N8N, OpenAI) para que los agentes puedan trabajar de verdad.
      </p>
      
      <div style={{ marginTop: '32px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        {['WhatsApp API', 'Instagram Graph', 'LinkedIn', 'N8N Webhooks', 'Google Analytics'].map(int => (
          <div key={int} style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '24px', textAlign: 'center' }}>
            <h4 style={{ marginBottom: '12px' }}>{int}</h4>
            <button style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: 'var(--primary)', color: 'white', cursor: 'pointer' }}>Conectar</button>
          </div>
        ))}
      </div>
    </div>
  );
}
