import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import './CampaignView.css';

export default function CampaignView() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [prospectNiche, setProspectNiche] = useState('Roofing');
  const [prospectMetro, setProspectMetro] = useState('Miami, FL');
  const [prospectLimit, setProspectLimit] = useState(5);
  const [autoEnrich, setAutoEnrich] = useState(false);
  const [isProspecting, setIsProspecting] = useState(false);
  const [prospectError, setProspectError] = useState(null);
  const [prospectSuccess, setProspectSuccess] = useState(null);

  const handleProspect = async (e) => {
    e.preventDefault();
    setIsProspecting(true);
    setProspectError(null);
    setProspectSuccess(null);
    try {
      const apiUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
      const res = await fetch(`${apiUrl}/api/prospect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          niche: prospectNiche,
          metro: prospectMetro,
          limit: parseInt(prospectLimit),
          autoEnrich
        })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al lanzar prospección');
      }
      setProspectSuccess('🚀 Campaña de prospección lanzada con éxito.');
    } catch (err) {
      setProspectError(err.message);
    } finally {
      setIsProspecting(false);
    }
  };

  useEffect(() => {
    fetchJobs();

    // Real-time subscription
    const channel = supabase
      .channel('jobs-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        fetchJobs();
      })
      .subscribe();

    const interval = setInterval(fetchJobs, 15000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  const fetchJobs = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setJobs(data || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching jobs from Supabase:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch ((status || '').toLowerCase()) {
      case 'executed': return '#10b981';
      case 'pending': return '#f59e0b';
      case 'awaiting_approval': return '#3b82f6';
      default: return '#64748b';
    }
  };

  return (
    <div className="campaign-view-container">
      <div className="campaign-header">
        <div>
          <h2>Campaña & Flujos de Agentes</h2>
          <p>Supervisa todos los trabajos delegados, procesados y entregables de los agentes.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ background: 'rgba(16,185,129,0.15)', padding: '6px 14px', borderRadius: '20px', fontSize: '0.8rem', color: '#10b981', fontWeight: 600 }}>
            ● LIVE desde Supabase
          </div>
          <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: '20px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            <strong style={{ color: '#fff' }}>{jobs.length}</strong> Jobs Totales
          </div>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', padding: '12px 16px', borderRadius: '10px', marginBottom: '16px', color: '#f87171', fontSize: '0.9rem' }}>
          ⚠️ Error conectando a Supabase: {error}
        </div>
      )}

      <div className="pipeline-trigger" style={{ background: 'rgba(30,41,59,0.8)', padding: '20px', borderRadius: '12px', marginBottom: '24px', border: '1px solid rgba(148,163,184,0.1)' }}>
        <h3 style={{ marginBottom: '8px' }}>🚀 Pipeline de Prospección Profunda</h3>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '16px' }}>
          Configura y lanza una nueva campaña. Los agentes buscarán leads y los procesarán automáticamente.
        </p>

        <form onSubmit={handleProspect} style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(15,23,42,0.5)', padding: '16px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Industria / Nicho</label>
              <input 
                type="text" 
                value={prospectNiche} 
                onChange={e => setProspectNiche(e.target.value)} 
                placeholder="Ej. Roofing"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                required 
              />
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Ciudad / Metro Area</label>
              <input 
                type="text" 
                value={prospectMetro} 
                onChange={e => setProspectMetro(e.target.value)} 
                placeholder="Ej. Miami, FL"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                required 
              />
            </div>
            <div style={{ width: '100px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Límite</label>
              <input 
                type="number" 
                value={prospectLimit} 
                onChange={e => setProspectLimit(e.target.value)} 
                min="1" max="100"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                required 
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0' }}>
            <input 
              type="checkbox" 
              id="autoEnrich" 
              checked={autoEnrich} 
              onChange={e => setAutoEnrich(e.target.checked)} 
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            <label htmlFor="autoEnrich" style={{ fontSize: '0.9rem', cursor: 'pointer', color: 'var(--text-primary)' }}>
              Enable Auto-Enrichment (Lanzar Francotirador automáticamente al hallar lead)
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              type="submit" 
              disabled={isProspecting}
              style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '6px', fontWeight: 'bold', cursor: isProspecting ? 'not-allowed' : 'pointer', opacity: isProspecting ? 0.7 : 1 }}
            >
              {isProspecting ? 'Lanzando Campaña...' : 'Lanzar Campaña'}
            </button>
            
            {prospectSuccess && <span style={{ color: '#10b981', fontSize: '0.9rem' }}>{prospectSuccess}</span>}
            {prospectError && <span style={{ color: '#ef4444', fontSize: '0.9rem' }}>{prospectError}</span>}
          </div>
        </form>
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
                      <img src={`https://ui-avatars.com/api/?name=${job.agent_name || 'Agent'}&background=random&color=fff`} alt={job.agent_name} className="agent-avatar" />
                      <span className="agent-name">{job.agent_name || 'Sin Asignar'}</span>
                    </div>
                    <h3 className="task-type">{job.task_type}</h3>
                  </div>
                  <div className="job-status" style={{ backgroundColor: getStatusColor(job.status) + '20', color: getStatusColor(job.status) }}>
                    <span className="status-dot" style={{ backgroundColor: getStatusColor(job.status) }}></span>
                    {job.status}
                  </div>
                </div>

                {job.payload && (
                  <div className="job-payload">
                    <h4>Instrucciones / Payload:</h4>
                    <pre>{typeof job.payload === 'object' ? JSON.stringify(job.payload, null, 2) : job.payload}</pre>
                  </div>
                )}

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
                   <span>ID: {typeof job.id === 'string' ? job.id.substring(0, 12) : job.id}...</span>
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
