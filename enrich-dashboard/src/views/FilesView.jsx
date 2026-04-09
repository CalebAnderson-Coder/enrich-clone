import React from 'react';

export default function FilesView() {
  return (
    <div style={{ padding: '40px', color: 'var(--text-primary)' }}>
      <h2>Archivos y Repositorio de Marca</h2>
      <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
        Sube PDFs, directrices de marca y documentos para que agentes como Helena o Sam tengan contexto completo.
      </p>
      
      <div style={{ marginTop: '32px', height: '200px', backgroundColor: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>+ Subir Documento</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '8px' }}>Arrastra tus archivos aquí</span>
      </div>
    </div>
  );
}
