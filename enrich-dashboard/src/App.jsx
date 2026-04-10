import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { supabase } from './lib/supabase';

// Import Views
import PerformanceView from './views/PerformanceView';
import CalendarView from './views/CalendarView';
import IntegrationsView from './views/IntegrationsView';
import FilesView from './views/FilesView';
import ProfileView from './views/ProfileView';
import HistoryView from './views/HistoryView';
import LeadsView from './views/LeadsView';
import CampaignView from './views/CampaignView';

function App() {
  // Navigation State
  const [currentView, setCurrentView] = useState('leads'); // Default to leads view (main client view)
  const [activeChannel, setActiveChannel] = useState('leads_precualificados');

  // Chat/Backend State
  const [agents, setAgents] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      author: 'Helena',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: 'Estoy en línea y lista para ayudarte. Los datos se cargan en tiempo real desde Supabase. Navega a "Leads Precualificados" para ver los prospectos encontrados.',
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('Helena');

  const messagesEndRef = useRef(null);

  // Fetch initial data
  useEffect(() => {
    fetchAgents();
    fetchJobs();

    const interval = setInterval(fetchJobs, 15000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (currentView === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, currentView]);

  const fetchAgents = async () => {
    try {
      // Connect to the real local Node.js API
      const res = await fetch(`http://localhost:3001/api/agents`, {
        headers: {
          'Authorization': 'Bearer sk_live_51MxxXYZ123SecureEnrichToken2026'
        }
      });
      const data = await res.json();
      const realAgents = data.agents || [];
      setAgents(realAgents);

      // Auto-select Helena if she exists, else the first one
      if (realAgents.length > 0) {
        if (realAgents.some(a => a.name === 'Helena')) {
          setSelectedAgent('Helena');
        } else {
          setSelectedAgent(realAgents[0].name);
        }
      }
    } catch (err) {
      console.error('Error fetching agents:', err);
    }
  };

  const fetchJobs = async () => {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .in('status', ['PENDING', 'AWAITING_APPROVAL'])
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (!error && data) {
        setJobs(data);
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const userMessage = {
      role: 'user',
      author: 'Tú',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: inputText.trim()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsTyping(true);

    // Chat is currently mocked (Coming soon)
    setTimeout(() => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        author: 'Sistema',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: 'Próximamente... (Conexión de chat en progreso)'
      }]);
      setIsTyping(false);
    }, 1000);
  };

  const handleApprovalAction = async (e, jobId, action) => {
    e.preventDefault();
    try {
      // Update job status directly in Supabase
      const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
      await supabase.from('jobs').update({ status: newStatus }).eq('id', jobId);
      setTimeout(() => fetchJobs(), 500); 
    } catch (err) {
      console.error('Action error:', err);
    }
  };


  // Main UI Renderer
  const renderMainContent = () => {
    switch (currentView) {
      case 'leads':
        return <LeadsView />;
      case 'performance':
        return <PerformanceView />;
      case 'campaign':
        return <CampaignView />;
      case 'calendar':
        return <CalendarView />;
      case 'files':
        return <FilesView />;
      case 'profile':
        return <ProfileView />;
      case 'integrations':
        return <IntegrationsView />;
      case 'history':
        return <HistoryView />;
      case 'chat':
      default:
        return (
          <>
            <div className="main-header">
              #{activeChannel} <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: '0.9rem', marginLeft: '8px' }}>Chateando con {selectedAgent}</span>
            </div>
            
            <div className="timeline">
              {messages.map((m, i) => (
                <div className="message" key={i}>
                  <div className="avatar">
                    <img src={`https://ui-avatars.com/api/?name=${m.author}&background=${m.role === 'user' ? '475569' : 'ef4444'}&color=fff`} alt={m.author} />
                  </div>
                  <div className="msg-content">
                    <div className="msg-header">
                      <span className="msg-author">{m.author}</span>
                      <span className="msg-time">{m.time}</span>
                    </div>
                    <div className="msg-text">
                      {m.text}
                    </div>

                    {m.artifacts && Object.keys(m.artifacts).length > 0 && (
                      <div className="task-steps">
                          {Object.entries(m.artifacts).map(([key, val]) => (
                              <div className="task-step done" key={key}>
                                <div className="status-dot"></div> Artefacto: {key} guardado.
                              </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="message">
                  <div className="avatar pulse-anim">
                    <img src={`https://ui-avatars.com/api/?name=${selectedAgent}&background=ef4444&color=fff`} alt="Agent" />
                  </div>
                  <div className="msg-content" style={{ display: 'flex', alignItems: 'center' }}>
                      <span className="pulse-anim" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        {selectedAgent} está pensando y trabajando...
                      </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input box */}
            <form className="chat-input-container" onSubmit={handleSendMessage}>
              <input 
                type="text" 
                placeholder={`Enviar mensaje a ${selectedAgent}...`} 
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                disabled={isTyping}
                autoFocus
              />
              <button type="submit" className="send-btn" disabled={!inputText.trim() || isTyping}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              </button>
            </form>
          </>
        );
    }
  };

  return (
    <div className="app-container">
      {/* LEFT SIDEBAR */}
      <div className="layout-sidebar">
        <div className="brand">
          <div className="brand-icon"></div>
          <span>empirika.agency</span>
        </div>

        <div className="nav-section">
          <div className="nav-title">Canales</div>
          <div className={`nav-item ${currentView === 'chat' && activeChannel === 'general' ? 'active' : ''}`}
               onClick={() => { setCurrentView('chat'); setActiveChannel('general'); }}>
            # general
          </div>
          <div className={`nav-item ${currentView === 'performance' ? 'active' : ''}`}
               onClick={() => { setCurrentView('performance'); setActiveChannel('rendimiento'); }}>
            # rendimiento
          </div>
          <div className={`nav-item ${currentView === 'leads' ? 'active' : ''}`}
               onClick={() => { setCurrentView('leads'); setActiveChannel('leads_precualificados'); }}>
            👥 leads precualificados
          </div>
          <div className={`nav-item ${currentView === 'calendar' ? 'active' : ''}`}
               onClick={() => { setCurrentView('calendar'); setActiveChannel('calendario'); }}>
            # calendario
          </div>
          <div className={`nav-item ${currentView === 'campaign' ? 'active' : ''}`}
               onClick={() => { setCurrentView('campaign'); setActiveChannel('campañas'); }}>
            🚀 campañas en vivo
          </div>
        </div>

        <div className="nav-section">
          <div className="nav-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Agentes Disponibles</span>
          </div>
          {agents.length === 0 ? (
            <div className="nav-item" style={{ color: 'var(--text-muted)' }}>Cargando...</div>
          ) : (
            agents.map(a => (
              <div 
                key={a.name}
                className={`nav-item ${currentView === 'chat' && selectedAgent === a.name ? 'active' : ''}`}
                onClick={() => { setCurrentView('chat'); setSelectedAgent(a.name); }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="avatar" style={{ width: 24, height: 24 }}>
                    <img src={`https://ui-avatars.com/api/?name=${a.name}&background=random&color=fff`} alt={a.name} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ lineHeight: 1 }}>{a.name}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {a.name === 'Manager' ? 'Gerente General' : a.toolCount + ' Herramientas'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="nav-section">
          <div className="nav-title">Historial de Chat</div>
          <div className={`nav-item ${currentView === 'history' ? 'active' : ''}`} onClick={() => setCurrentView('history')} style={{ color: currentView === 'history' ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            <span style={{ marginRight: 8 }}>🔍</span> Buscar conversaciones...
          </div>
          <div className="nav-item" onClick={() => { setCurrentView('chat'); setMessages([]); }}>📝 Nuevo Chat</div>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <div className={`nav-item ${currentView === 'files' ? 'active' : ''}`} onClick={() => setCurrentView('files')}>
            📁 Archivos
          </div>
          <div className={`nav-item ${currentView === 'profile' ? 'active' : ''}`} onClick={() => setCurrentView('profile')}>
            👤 Tu Perfil
          </div>
          <div className={`nav-item ${currentView === 'integrations' ? 'active' : ''}`} onClick={() => setCurrentView('integrations')}>
            🔌 Integraciones
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="layout-main">
        {renderMainContent()}
      </div>

      {/* RIGHT SIDEBAR */}
      <div className="layout-right">
        <div className="panel-section">
          <div className="panel-title">Métricas de la Agencia</div>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label">Usuarios Activos</div>
              <div className="metric-val">12</div>
              <span className="metric-link" style={{ cursor: 'pointer' }} onClick={() => setCurrentView('performance')}>Ver detalles</span>
            </div>
            <div className="metric-card">
              <div className="metric-label">Sesiones</div>
              <div className="metric-val">142</div>
              <span className="metric-link" style={{ cursor: 'pointer' }} onClick={() => setCurrentView('integrations')}>Conectar GA</span>
            </div>
          </div>
        </div>

        <div className="panel-section">
          <div className="panel-title">
            <span>Canales</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>Piloto Automático <label className="switch" style={{display: 'inline-block', width: 24, height: 12, background: '#E2E8F0', borderRadius: 12, verticalAlign: 'middle', marginLeft: 4}}></label></span>
          </div>
        </div>

        <div className="panel-section">
          <div className="panel-title">Próximas Tareas (Jobs)</div>
          
          {jobs.length === 0 ? (
            <div className="task-card" style={{opacity: 0.7, minHeight: 'auto'}}>
              <span className="task-type" style={{color: 'var(--text-muted)'}}>No hay tareas pendientes</span>
            </div>
          ) : (
            jobs.map(job => (
              <div key={job.id} className="task-card">
                <span className="task-id">#{job.id.substring(0,8)}</span>
                <span className="task-type">Tarea: {job.task_type}</span>
                <span className={`task-status ${(job.status || '').toLowerCase()}`}>
                  Estado: {job.status} (Agente: {job.agent_name || 'Sin Asignar'})
                </span>
                {job.status === 'PENDING' && (
                  <div style={{marginTop: '8px', display: 'flex', gap: '8px'}}>
                    <button onClick={(e) => handleApprovalAction(e, job.id, 'approve')} className="action-btn approve-btn">Aprobar</button>
                    <button onClick={(e) => handleApprovalAction(e, job.id, 'reject')} className="action-btn reject-btn">Rechazar</button>
                  </div>
                )}
                {job.status === 'AWAITING_APPROVAL' && (
                  <div style={{marginTop: '8px', display: 'flex', gap: '8px'}}>
                    <button onClick={(e) => handleApprovalAction(e, job.id, 'approve')} className="action-btn approve-btn">Aprobar y Ejecutar</button>
                    <button onClick={(e) => handleApprovalAction(e, job.id, 'reject')} className="action-btn reject-btn">Rechazar</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}

export default App;
