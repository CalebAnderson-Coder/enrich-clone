import React from 'react';

export default function ProfileView() {
  return (
    <div style={{ padding: '40px', color: 'var(--text-primary)' }}>
      <h2>Tu Perfil de Agencia</h2>
      <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
        Configura los accesos, la facturación y los datos de contacto corporativos.
      </p>
      
      <div style={{ marginTop: '32px', backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '24px', maxWidth: '500px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 'bold' }}>
            A
          </div>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Agencia Master</div>
            <div style={{ color: 'var(--text-muted)' }}>admin@empirika.agency</div>
          </div>
        </div>
        
        <button style={{ padding: '10px 24px', borderRadius: '6px', border: 'none', backgroundColor: 'var(--primary)', color: 'white', cursor: 'pointer', width: '100%' }}>
          Ajustes de Facturación
        </button>
      </div>
    </div>
  );
}
