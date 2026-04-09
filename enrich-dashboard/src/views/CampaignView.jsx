import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import './CampaignView.css';

export default function CampaignView() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0' }}>
          Los agentes ejecutan el pipeline automáticamente desde el backend. Los jobs aparecerán aquí en tiempo real conforme se creen.
        </p>
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
