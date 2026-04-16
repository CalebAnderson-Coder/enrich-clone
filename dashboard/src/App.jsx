import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, User, Calendar, Megaphone, Activity, FileText,
  Settings, Search, PlusCircle, CheckCircle, XCircle, Loader2, Send, LogOut
} from 'lucide-react';
// import { motion, AnimatePresence } from 'framer-motion';

// Import Views
import PerformanceView from './views/PerformanceView';
import CalendarView from './views/CalendarView';
import IntegrationsView from './views/IntegrationsView';
import FilesView from './views/FilesView';
import ProfileView from './views/ProfileView';
import HistoryView from './views/HistoryView';
import LeadsView from './views/LeadsView';
import CampaignView from './views/CampaignView';
import LoginView from './views/LoginView';
import { useAuth } from './components/AuthProvider';
import { apiGet, apiPost } from './lib/apiClient';

function App() {
  const { session, loading: authLoading, signOut } = useAuth();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center text-surface-400 text-sm">
        Cargando sesión…
      </div>
    );
  }

  if (!session) {
    return <LoginView />;
  }

  return <AppAuthed signOut={signOut} />;
}

function AppAuthed({ signOut }) {
  const [currentView, setCurrentView] = useState('chat');
  const [activeChannel, setActiveChannel] = useState('general');
  const [agents, setAgents] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      author: 'Helena',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: 'Estoy en línea y lista para ayudarte. Escribe un mensaje abajo para empezar a organizar tareas y ejecutar campañas.',
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('Helena');

  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchAgents();
    fetchJobs();
    const interval = setInterval(fetchJobs, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (currentView === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, currentView]);

  const fetchAgents = async () => {
    try {
      const res = await apiGet('/agents');
      if(!res.ok) return;
      const data = await res.json();
      setAgents(data.agents || []);
      if (data.agents && data.agents.some(a => a.name === 'Helena')) {
        setSelectedAgent('Helena');
      } else if (data.agents && data.agents.length > 0) {
        setSelectedAgent(data.agents[0].name);
      }
    } catch (err) {
      console.error('Error fetching agents:', err);
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await apiGet('/jobs');
      if(!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs || []);
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

    try {
      const res = await apiPost('/chat', {
        message: userMessage.text,
        agent: selectedAgent,
      });
      const data = await res.json();
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        author: data.agent || selectedAgent,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: data.response || 'Sin respuesta',
        artifacts: data.artifacts || []
      }]);
      fetchJobs();
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        author: 'Sistema',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `Error conectando al backend: ${err.message}`
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleApprovalAction = async (jobId, action) => {
    try {
      const res = await apiGet(`/approve?jobId=${jobId}&action=${action}`);
      if (res.ok) setTimeout(() => fetchJobs(), 1000);
    } catch (err) {
      console.error('Action error:', err);
    }
  };

  // ----------------------------------------------------
  // Render Helpers
  // ----------------------------------------------------

  const NavItem = ({ icon: Icon, label, isActive, onClick, className = '' }) => (
    <div 
      onClick={onClick}
      className={`
        flex items-center gap-3 px-3 py-1.5 mx-2 rounded-md text-sm font-medium transition-all cursor-pointer select-none
        ${isActive 
          ? 'bg-surface-800 shadow-soft text-surface-50 border border-surface-700' 
          : 'text-surface-400 hover:bg-surface-800/50 hover:text-surface-100 border border-transparent'
        } ${className}
      `}
    >
      {Icon && <Icon size={16} className={isActive ? 'text-surface-50' : 'text-surface-500'} />}
      <span className="truncate">{label}</span>
    </div>
  );

  const renderMainContent = () => {
    switch (currentView) {
      case 'leads': return <div className="flex-1 overflow-y-auto h-full"><LeadsView /></div>;
      case 'performance': return <div className="flex-1 overflow-y-auto h-full"><PerformanceView /></div>;
      case 'campaign': return <div className="flex-1 overflow-y-auto h-full"><CampaignView /></div>;
      case 'calendar': return <div className="flex-1 overflow-y-auto h-full"><CalendarView /></div>;
      case 'files': return <div className="flex-1 overflow-y-auto h-full"><FilesView /></div>;
      case 'profile': return <div className="flex-1 overflow-y-auto h-full"><ProfileView /></div>;
      case 'integrations': return <div className="flex-1 overflow-y-auto h-full"><IntegrationsView /></div>;
      case 'history': return <div className="flex-1 overflow-y-auto h-full"><HistoryView /></div>;
      case 'chat':
      default:
        return (
          <div className="flex flex-col h-full relative">
            {/* Header */}
            <div className="h-14 border-b border-surface-800 flex items-center px-6 bg-surface-950/80 backdrop-blur-md z-10 shrink-0">
              <h2 className="text-md font-semibold text-surface-50 flex items-center gap-2">
                <span className="text-surface-500">#</span>
                {activeChannel}
              </h2>
              <span className="ml-4 text-xs font-medium text-surface-400 bg-surface-800 border border-surface-700 px-2 flex items-center py-0.5 rounded">
                Chateando con <span className="text-primary-400 font-semibold ml-1">{selectedAgent}</span>
              </span>
            </div>
            
            {/* Timeline */}
            <div className="flex-1 overflow-y-auto w-full p-6 space-y-8 bg-surface-950">
              {messages.map((m, i) => (
                <div key={i} className={`flex gap-4 max-w-4xl mx-auto align-top ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {/* Avatar */}
                  <div className="shrink-0 pt-1">
                    <img 
                      src={`https://ui-avatars.com/api/?name=${m.author}&background=${m.role === 'user' ? '262931' : '5E6AD2'}&color=fff&rounded=true&bold=true`} 
                      className={`w-8 h-8 shadow-sm rounded border ${m.role === 'user' ? 'border-surface-700' : 'border-primary-600'}`} 
                      alt={m.author} 
                    />
                  </div>
                  {/* Bubble */}
                  <div className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} max-w-[80%]`}>
                    <div className="flex items-center gap-2 mb-1.5 px-1">
                      <span className="text-sm font-semibold text-surface-50">{m.author}</span>
                      <span className="text-xs font-medium text-surface-500">{m.time}</span>
                    </div>
                    <div className={`
                      px-4 py-2.5 rounded-md text-sm leading-relaxed
                      ${m.role === 'user' 
                        ? 'bg-primary-500/10 text-surface-50 border border-primary-500/20' 
                        : 'bg-surface-800 text-surface-100 border border-surface-700'
                      }
                    `}>
                      {m.text}
                    </div>

                    {/* Artifacts inside message */}
                    {m.artifacts && Object.keys(m.artifacts).length > 0 && (
                       <div className="mt-3 flex flex-col gap-2 w-full">
                         {Object.entries(m.artifacts).map(([key, val]) => (
                            <div key={key} className="flex flex-col gap-2 text-xs bg-surface-900/50 text-surface-100 px-3 py-3 rounded-md border border-surface-800">
                              <div className="flex items-center gap-2 font-semibold text-surface-300">
                                <FileText size={14} className="text-primary-400" />
                                <span>Artifact: <span className="text-surface-50">{key}</span></span>
                              </div>
                              <pre className="p-2.5 bg-surface-950 rounded border border-surface-800 overflow-x-auto text-[11px] font-mono text-surface-300 whitespace-pre-wrap shadow-inner">
                                {typeof val === 'object' ? JSON.stringify(val, null, 2) : val}
                              </pre>
                            </div>
                         ))}
                       </div>
                    )}
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="flex gap-4 max-w-4xl mx-auto">
                  <div className="shrink-0 pt-1">
                    <img src={`https://ui-avatars.com/api/?name=${selectedAgent}&background=5E6AD2&color=fff&rounded=true`} className="w-8 h-8 rounded border border-primary-600 animate-pulse shadow-glow" alt="Agent" />
                  </div>
                  <div className="flex flex-col items-start max-w-[80%]">
                    <div className="flex items-center gap-2 mb-1 px-1">
                      <span className="text-sm font-semibold text-surface-50">{selectedAgent}</span>
                    </div>
                    <div className="px-4 py-2.5 rounded-md bg-surface-800 border border-surface-700 shadow-soft flex items-center gap-3">
                      <Loader2 size={14} className="animate-spin text-primary-400" />
                      <span className="text-sm font-medium text-surface-400">
                        Evaluando y trabajando...
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} className="pb-4" />
            </div>

            {/* Input box */}
            <div className="p-4 bg-surface-950 border-t border-surface-800 shrink-0">
              <form 
                onSubmit={handleSendMessage}
                className="max-w-2xl mx-auto relative flex items-center"
              >
                <input 
                  type="text" 
                  className="w-full bg-surface-900 text-surface-50 rounded-md pl-4 pr-12 py-3 text-sm font-medium border border-surface-700 focus:border-primary-500 focus:bg-surface-800 focus:shadow-glow transition-all outline-none"
                  placeholder={`Enviar mensaje a ${selectedAgent}...`} 
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  disabled={isTyping}
                  autoFocus
                />
                <button 
                  type="submit" 
                  disabled={!inputText.trim() || isTyping}
                  className="absolute right-2 p-1.5 bg-primary-500 hover:bg-primary-400 disabled:bg-surface-700 disabled:text-surface-500 disabled:cursor-not-allowed text-white rounded transition-colors shadow-soft"
                >
                  <Send size={16} className="" />
                </button>
              </form>
              <div className="max-w-2xl mx-auto mt-3 text-center">
                <span className="text-[10px] text-surface-600 font-semibold tracking-widest uppercase">
                  Linear AI Workspace
                </span>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen w-full bg-surface-950 overflow-hidden text-surface-50 font-sans">
      
      {/* 1. LEFT SIDEBAR */}
      <div className="w-60 bg-surface-900 border-r border-surface-800 flex flex-col shrink-0 relative z-20">
        <div className="h-14 flex items-center px-5 border-b border-surface-800 shrink-0">
          <div className="w-6 h-6 rounded bg-primary-500 shadow-glow flex items-center justify-center mr-3">
             <span className="text-white font-bold text-xs select-none">E</span>
          </div>
          <span className="font-semibold text-surface-50 tracking-tight text-sm">enrich.workspace</span>
        </div>

        <div className="flex-1 overflow-y-auto py-4 w-full">
          {/* Main Channels */}
          <div className="mb-6">
            <h3 className="sidebar-section-title">Canales</h3>
            <NavItem icon={MessageSquare} label="General" isActive={currentView==='chat' && activeChannel==='general'} onClick={()=>{setCurrentView('chat'); setActiveChannel('general');}} />
            <NavItem icon={Activity} label="Rendimiento" isActive={currentView==='performance'} onClick={()=>{setCurrentView('performance'); setActiveChannel('rendimiento');}} />
            <NavItem icon={User} label="Leads Precualificados" isActive={currentView==='leads'} onClick={()=>{setCurrentView('leads'); setActiveChannel('leads');}} />
            <NavItem icon={Calendar} label="Calendario" isActive={currentView==='calendar'} onClick={()=>{setCurrentView('calendar'); setActiveChannel('calendario');}} />
            <NavItem icon={Megaphone} label="Campañas" isActive={currentView==='campaign'} onClick={()=>{setCurrentView('campaign'); setActiveChannel('campañas');}} />
          </div>

          {/* Agents */}
          <div className="mb-6">
            <h3 className="sidebar-section-title flex justify-between items-center pr-4">
              <span>Agentes</span>
              <PlusCircle size={14} className="text-surface-400 hover:text-primary-500 cursor-pointer" />
            </h3>
            {agents.length === 0 ? (
              <div className="px-5 py-2 text-xs text-surface-400 font-medium">Cargando agentes...</div>
            ) : (
              agents.map(a => (
                <div 
                  key={a.name}
                  onClick={() => { setCurrentView('chat'); setSelectedAgent(a.name); }}
                  className={`
                    flex items-center gap-3 px-3 py-1.5 mx-2 rounded-md text-sm font-medium transition-all cursor-pointer select-none
                    ${currentView === 'chat' && selectedAgent === a.name 
                      ? 'bg-surface-800 text-surface-50 shadow-soft border border-surface-700' 
                      : 'text-surface-400 hover:bg-surface-800/50 hover:text-surface-100 border border-transparent'
                    }
                  `}
                >
                  <div className="relative">
                    <img src={`https://ui-avatars.com/api/?name=${a.name}&background=262931&color=fff&rounded=true`} alt={a.name} className="w-6 h-6 rounded border border-surface-600" />
                    <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-500 rounded-full border border-surface-900"></div>
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="truncate leading-tight text-sm text-surface-100">{a.name}</span>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="mb-2">
             <h3 className="sidebar-section-title">Historial</h3>
             <NavItem icon={Search} label="Buscar historial..." isActive={currentView==='history'} onClick={() => setCurrentView('history')} className="text-surface-500" />
          </div>
        </div>

        {/* Bottom actions */}
        <div className="p-4 border-t border-surface-800 bg-surface-900 shrink-0 space-y-1">
          <NavItem icon={FileText} label="Archivos" isActive={currentView==='files'} onClick={() => setCurrentView('files')} />
          <NavItem icon={Settings} label="Integraciones" isActive={currentView==='integrations'} onClick={() => setCurrentView('integrations')} />
          <NavItem icon={LogOut} label="Cerrar sesión" isActive={false} onClick={signOut} />
        </div>
      </div>


      {/* 2. MAIN CONTENT (Chat + timeline) */}
      <div className="flex-1 min-w-0 bg-surface-950 relative z-10 flex flex-col border-r border-surface-800">
        {renderMainContent()}
      </div>


      {/* 3. RIGHT SIDEBAR (Context & Tasks) */}
      <div className="w-80 bg-surface-900 shrink-0 flex flex-col relative z-20">
        <div className="h-14 flex items-center px-6 border-b border-surface-800 bg-surface-900/80 backdrop-blur-sm shrink-0">
          <h2 className="font-medium text-surface-300 text-sm tracking-wide">Contexto y Supervisión</h2>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5 pb-10 space-y-8">
            
          {/* Metrics section */}
          <section>
             <h3 className="sidebar-section-title">Métricas de la Agencia</h3>
             <div className="grid grid-cols-2 gap-3">
               <div className="metric-card flex flex-col justify-between">
                 <span className="text-xs font-medium text-surface-400 mb-1">Usuarios Activos</span>
                 <span className="text-2xl font-semibold text-surface-50 tracking-tight">12</span>
                 <button 
                   onClick={() => setCurrentView('performance')}
                   className="mt-2 text-[10px] text-primary-400 font-semibold hover:text-primary-300 transition-colors self-start underline-offset-2 hover:underline focus:outline-none bg-transparent border-none p-0 cursor-pointer"
                 >
                   Ver detalles
                 </button>
               </div>
               <div className="metric-card flex flex-col justify-between">
                 <span className="text-xs font-medium text-surface-400 mb-1">Sesiones</span>
                 <span className="text-2xl font-semibold text-surface-50 tracking-tight">142</span>
                 <button 
                   onClick={() => setCurrentView('integrations')}
                   className="mt-2 text-[10px] text-primary-400 font-semibold hover:text-primary-300 transition-colors self-start underline-offset-2 hover:underline focus:outline-none bg-transparent border-none p-0 cursor-pointer"
                 >
                   Conectar GA
                 </button>
               </div>
             </div>
          </section>

          {/* Autopilot section */}
          <section>
            <div className="flex items-center justify-between mb-3 px-1 mt-6">
              <span className="text-sm font-semibold text-surface-100">Canales</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-surface-400">Piloto Automático</span>
                <div className="w-6 h-3 bg-surface-700 rounded-full relative cursor-pointer">
                  <div className="w-3 h-3 bg-surface-400 rounded-full absolute left-0 top-0"></div>
                </div>
              </div>
            </div>
          </section>

          {/* Pending Jobs section */}
          <section>
             <div className="flex items-center justify-between mb-3 px-1">
               <h3 className="sidebar-section-title !mb-0">Cola de Trabajo</h3>
               <span className="text-[10px] uppercase tracking-widest font-bold text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded border border-primary-500/20">
                 {jobs.length} activos
               </span>
             </div>
             
             <div className="space-y-3">
               {jobs.length === 0 ? (
                 <div className="p-4 rounded-md border border-dashed border-surface-700 flex flex-col items-center justify-center text-center bg-transparent">
                   <CheckCircle className="text-surface-500 mb-2" size={20} />
                   <span className="text-xs font-medium text-surface-400 block">No hay tareas pendientes</span>
                 </div>
               ) : (
                 jobs.map((job) => (
                   <div key={job.id} className="metric-card">
                     <div className="flex justify-between items-start mb-2">
                       <span className="text-[10px] font-mono text-surface-500">#{job.id.substring(0,8)}</span>
                       <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded flex items-center justify-center ${
                          job.status === 'PENDING' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 
                          job.status === 'AWAITING_APPROVAL' ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20' :
                          job.status === 'IN_PROGRESS' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                          job.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          'bg-surface-800 text-surface-400 border border-surface-700'
                       }`}>
                         {job.status.replace('_', ' ')}
                       </span>
                     </div>
                     <h4 className="text-sm font-medium text-surface-100 mb-1 leading-tight">{job.task_type}</h4>
                     <p className="text-xs font-medium text-surface-500 mb-4 flex items-center gap-1.5">
                       <User size={12} />
                       {job.agent_name || 'Sin Asignar'}
                     </p>

                     {/* Action buttons based on status */}
                     {job.status === 'PENDING' && (
                         <div className="flex gap-2">
                           <button 
                             onClick={(e) => { e.preventDefault(); handleApprovalAction(job.id, 'approve'); }}
                             className="flex-1 bg-primary-500/20 text-primary-400 border border-primary-500/30 hover:bg-primary-500 hover:text-white hover:shadow-glow text-xs font-medium py-1.5 px-3 rounded transition-all flex items-center justify-center gap-1.5"
                           >
                             <CheckCircle size={14} /> Aprobar
                           </button>
                           <button 
                             onClick={(e) => { e.preventDefault(); handleApprovalAction(job.id, 'reject'); }}
                             className="bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white border border-red-500/20 hover:border-red-500 text-xs font-medium py-1.5 px-3 rounded transition-all shadow-none"
                             title="Rechazar"
                           >
                             <XCircle size={14} />
                           </button>
                         </div>
                     )}
                     {job.status === 'AWAITING_APPROVAL' && (
                         <div className="flex gap-2">
                           <button 
                             onClick={(e) => { e.preventDefault(); handleApprovalAction(job.id, 'approve'); }}
                             className="flex-1 bg-primary-500 hover:bg-primary-400 shadow-glow text-white text-xs font-medium py-1.5 px-3 rounded transition-all flex items-center justify-center gap-1.5"
                           >
                             <CheckCircle size={14} /> Aprobar y Ejecutar
                           </button>
                           <button 
                             onClick={(e) => { e.preventDefault(); handleApprovalAction(job.id, 'reject'); }}
                             className="bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white border border-red-500/20 hover:border-red-500 text-xs font-medium py-1.5 px-3 rounded transition-all shadow-none"
                             title="Rechazar"
                           >
                             <XCircle size={14} />
                           </button>
                         </div>
                     )}
                   </div>
                 ))
               )}
             </div>

          </section>

        </div>
      </div>

    </div>
  );
}

export default App;
