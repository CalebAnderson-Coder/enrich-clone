import React, { useState, useEffect } from 'react';
import './CampaignView.css';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:4000/api');

export default function CampaignView() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const [industry, setIndustry] = useState('landscaping');
  const [city, setCity] = useState('Miami, FL');
  const [pipelineStatus, setPipelineStatus] = useState('');

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        headers: { 'Authorization': `Bearer ${import.meta.env.VITE_API_SECRET_KEY}` }
      });
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    } finally {
      if (loading) setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch ((status || '').toLowerCase()) {
      case 'executed': return '#10b981'; // Emerald
      case 'pending': return '#f59e0b'; // Amber
      case 'awaiting_approval': return '#3b82f6'; // Blue
      default: return '#64748b'; // Slate
    }
  };

  const handleStartPipeline = async (e) => {
    e.preventDefault();
    setPipelineStatus('Lanzando pipeline... revisa la consola del servidor de Node.js para logs en vivo.');
    try {
      const res = await fetch(`${API_BASE}/campaign/pipeline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_API_SECRET_KEY}`
        },
        body: JSON.stringify({ industry, city })
      });
      const data = await res.json();
      setPipelineStatus(data.message || 'Pipeline finalizado.');
    } catch(e) {
      setPipelineStatus(`Error: ${e.message}`);
    }
  };

  return (
    <div className="campaign-view-container">
      <div className="campaign-header">
        <div>
          <h2>Campaña & Flujos de Agentes</h2>
          <p>Supervisa todos los trabajos delegados, procesados y entregables de los agentes.</p>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: '20px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <strong style={{ color: '#fff' }}>{jobs.length}</strong> Jobs Totales
        </div>
      </div>

      <div className="pipeline-trigger" style={{ background: 'rgba(30,41,59,0.8)', padding: '20px', borderRadius: '12px', marginBottom: '24px', border: '1px solid rgba(148,163,184,0.1)' }}>
        <h3 style={{ marginBottom: '8px' }}>🚀 Lanzar Pipeline de Prospección Profunda (Macro-Flujo)</h3>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '16px' }}>Busca en Maps -&gt; Califica -&gt; Enriquecimiento Web -&gt; Análisis Estratégico (Carlos) -&gt; Copy Redactado (Angela).</p>
        
        <form onSubmit={handleStartPipeline} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <input 
            type="text" 
            value={industry} 
            onChange={(e) => setIndustry(e.target.value)} 
            placeholder="Nicho (ej. roofing)" 
            style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white', outline: 'none', minWidth: '200px' }} 
            required
          />
          <input 
            type="text" 
            value={city} 
            onChange={(e) => setCity(e.target.value)} 
            placeholder="Ciudad (ej. Houston, TX)" 
            style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white', outline: 'none', minWidth: '200px' }} 
            required
          />
          <button type="submit" style={{ padding: '10px 24px', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
            Lanzar Pipeline
          </button>
        </form>
        {pipelineStatus && <div style={{ marginTop: '12px', color: '#10b981', fontSize: '0.9rem', fontWeight: 'bold' }}>{pipelineStatus}</div>}
      </div>

      {loading ? (
        <div className="campaign-grid">
          {[1, 2, 3].map(i => <div key={i} className="skeleton-card" style={{ height: '200px' }} />)}
        </div>
      ) : (
        <div className="campaign-grid">
          {jobs.length === 0 ? (
            <div className="empty-state">No hay jobs activos en la campaña en este momento.</div>
          ) : (
            jobs.map(job => (
              <div key={job.id} className="job-card">
                <div className="job-header">
                  <div>
                    <div className="agent-badge">
                      <img src={`https://ui-avatars.com/api/?name=${job.agent_name}&background=random&color=fff`} alt={job.agent_name} className="agent-avatar" />
                      <span className="agent-name">{job.agent_name}</span>
                    </div>
                    <h3 className="task-type">{job.task_type}</h3>
                  </div>
                  <div className="job-status" style={{ backgroundColor: getStatusColor(job.status) + '20', color: getStatusColor(job.status) }}>
                    <span className="status-dot" style={{ backgroundColor: getStatusColor(job.status) }}></span>
                    {job.status}
                  </div>
                </div>

                <div className="job-payload">
                  <h4>Instrucciones / Payload:</h4>
                  <pre>{JSON.stringify(job.payload, null, 2)}</pre>
                </div>

                {job.result && (
                  <div className="job-result">
                    <h4>Resultado Final:</h4>
                    {typeof job.result === 'object' ? (
                       <pre>{JSON.stringify(job.result, null, 2)}</pre>
                    ) : (
                       <div className="result-text">{job.result}</div>
                    )}
                  </div>
                )}
                
                <div className="job-footer">
                   <span>ID: {job.id}</span>
                   <span>Creado: {new Date(job.created_at).toLocaleString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
