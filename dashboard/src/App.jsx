import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, User, Megaphone, FileText,
  Search, PlusCircle, CheckCircle, XCircle, Loader2, Send, LogOut, Settings
} from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';

// Import Views — active demo surface
import LeadsView from './views/LeadsView';
import CampaignView from './views/CampaignView';
import LoginView from './views/LoginView';

// --- Views parked for post-demo (keep files, hide from sidebar) ---
// import PerformanceView from './views/PerformanceView';
// import CalendarView from './views/CalendarView';
// import IntegrationsView from './views/IntegrationsView';
// import FilesView from './views/FilesView';
// import ProfileView from './views/ProfileView';
// import HistoryView from './views/HistoryView';

import { useAuth } from './components/AuthProvider';
import { apiGet, apiPost } from './lib/apiClient';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import AnimatedCard from '@/components/shared/AnimatedCard';
import FadePresence, { fadeVariants } from '@/components/shared/FadePresence';
import StaggerChildren, { staggerItem } from '@/components/shared/StaggerChildren';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initialsOf(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Derive a presence dot state from whatever shape the agents endpoint returns.
// Falls back to 'online' so the UI is never empty during demo.
function presenceOf(agent) {
  const raw = (agent?.status || agent?.state || agent?.presence || '')
    .toString()
    .toLowerCase();
  if (raw.includes('think') || raw.includes('busy') || raw.includes('working'))
    return 'thinking';
  if (raw.includes('idle') || raw.includes('away') || raw.includes('off'))
    return 'idle';
  return 'online';
}

function StatusDot({ state }) {
  if (state === 'thinking') {
    return (
      <motion.span
        aria-hidden="true"
        className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-semantic-warning border border-surface-900 motion-reduce:!animate-none"
        animate={{ scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      />
    );
  }
  if (state === 'idle') {
    return (
      <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-surface-600 border border-surface-900" />
    );
  }
  return (
    <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-semantic-success border border-surface-900" />
  );
}

// Typing indicator — three staggered dots + "Manager is thinking…" copy.
function TypingIndicator({ agentName }) {
  return (
    <motion.div
      key="typing"
      className="flex gap-4 max-w-4xl mx-auto"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.2 }}
    >
      <div className="shrink-0 pt-1">
        <div className="relative">
          <Avatar className="h-8 w-8 border border-primary-500/40">
            <AvatarFallback className="bg-primary-500/20 text-primary-400 text-[10px] font-semibold">
              {initialsOf(agentName)}
            </AvatarFallback>
          </Avatar>
          <StatusDot state="thinking" />
        </div>
      </div>
      <div className="flex flex-col items-start max-w-[80%]">
        <div className="flex items-center gap-2 mb-1 px-1">
          <span className="text-sm font-semibold text-surface-50">
            {agentName}
          </span>
        </div>
        <div className="px-4 py-3 rounded-md bg-card border border-border shadow-elevation-1 flex items-center gap-2">
          {[0, 0.15, 0.3].map((delay, i) => (
            <motion.span
              key={i}
              className="block w-1.5 h-1.5 rounded-full bg-primary-400"
              animate={{ scale: [0.8, 1.3, 0.8], opacity: [0.5, 1, 0.5] }}
              transition={{
                duration: 1,
                repeat: Infinity,
                ease: 'easeInOut',
                delay,
              }}
            />
          ))}
        </div>
        <span className="mt-1.5 px-1 text-[11px] font-medium text-surface-400">
          {agentName} is thinking…
        </span>
      </div>
    </motion.div>
  );
}

// Semantic badge per job.status. Colour tokens come from tailwind.config semantic.*.
function JobStatusBadge({ status }) {
  const label = (status || '').replace(/_/g, ' ');
  const common =
    'text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5';

  if (status === 'PENDING') {
    return (
      <Badge
        variant="outline"
        className={cn(
          common,
          'bg-semantic-warning/20 text-semantic-warning border-semantic-warning/40'
        )}
      >
        {label}
      </Badge>
    );
  }
  if (status === 'AWAITING_APPROVAL') {
    return (
      <Badge
        variant="outline"
        className={cn(
          common,
          'bg-semantic-info/20 text-semantic-info border-semantic-info/40'
        )}
      >
        {label}
      </Badge>
    );
  }
  if (status === 'IN_PROGRESS') {
    return (
      <motion.div
        animate={{ opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Badge
          variant="outline"
          className={cn(
            common,
            'bg-primary-500/20 text-primary-500 border-primary-500/40'
          )}
        >
          {label}
        </Badge>
      </motion.div>
    );
  }
  if (status === 'COMPLETED') {
    return (
      <Badge
        variant="outline"
        className={cn(
          common,
          'bg-semantic-success/20 text-semantic-success border-semantic-success/40'
        )}
      >
        {label}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        common,
        'bg-surface-800 text-surface-400 border-surface-700'
      )}
    >
      {label}
    </Badge>
  );
}

// Navigation item — sidebar button. Hoisted to module scope so it's stable
// across re-renders of AppAuthed (prevents remount of descendant state).
function NavItem({ icon: Icon, label, isActive, onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'w-[calc(100%-1rem)] flex items-center gap-3 px-3 py-1.5 mx-2 rounded-md text-sm font-medium transition-all cursor-pointer select-none text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        isActive
          ? 'bg-surface-800 shadow-soft text-surface-50 border border-surface-700'
          : 'text-surface-400 hover:bg-surface-800/50 hover:text-surface-100 border border-transparent',
        className
      )}
    >
      {Icon && (
        <Icon
          size={16}
          aria-hidden="true"
          className={isActive ? 'text-surface-50' : 'text-surface-500'}
        />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

function App() {
  const { session, loading: authLoading, signOut } = useAuth();

  return (
    <MotionConfig reducedMotion="user">
    <FadePresence>
      {authLoading ? (
        <motion.div
          key="session-loader"
          variants={fadeVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="min-h-screen bg-surface-950 flex items-center justify-center"
        >
          <div className="flex flex-col items-center gap-4">
            <motion.span
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="text-3xl font-semibold tracking-tight text-primary-500"
            >
              Empírika
            </motion.span>
            <Loader2 className="h-5 w-5 text-primary-400 animate-spin" />
            <span className="text-xs font-medium text-surface-400 tracking-wide">
              Preparando tu workspace…
            </span>
          </div>
        </motion.div>
      ) : !session ? (
        <motion.div
          key="login"
          variants={fadeVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <LoginView />
        </motion.div>
      ) : (
        <motion.div
          key="app"
          variants={fadeVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <AppAuthed signOut={signOut} />
        </motion.div>
      )}
    </FadePresence>
    </MotionConfig>
  );
}

// ---------------------------------------------------------------------------
// Authed shell
// ---------------------------------------------------------------------------

function AppAuthed({ signOut }) {
  const [currentView, setCurrentView] = useState('chat');
  const [activeChannel, setActiveChannel] = useState('general');
  const [agents, setAgents] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      author: 'Helena',
      time: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      text: 'Estoy en línea y lista para ayudarte. Escribe un mensaje abajo para empezar a organizar tareas y ejecutar campañas.',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('Helena');
  const [jobActionLoading, setJobActionLoading] = useState(null); // `${jobId}:${action}`

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
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data.agents || []);
      if (data.agents && data.agents.some((a) => a.name === 'Helena')) {
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
      if (!res.ok) return;
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
      time: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      text: inputText.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsTyping(true);

    try {
      const res = await apiPost('/chat', {
        message: userMessage.text,
        agent: selectedAgent,
      });
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          author: data.agent || selectedAgent,
          time: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
          text: data.response || 'Sin respuesta',
          artifacts: data.artifacts || [],
        },
      ]);
      fetchJobs();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          author: 'Sistema',
          time: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
          text: `Error conectando al backend: ${err.message}`,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleApprovalAction = async (jobId, action) => {
    const key = `${jobId}:${action}`;
    setJobActionLoading(key);
    try {
      const res = await apiGet(`/approve?jobId=${jobId}&action=${action}`);
      if (res.ok) setTimeout(() => fetchJobs(), 800);
    } catch (err) {
      console.error('Action error:', err);
    } finally {
      setJobActionLoading(null);
    }
  };

  // ----------------------------------------------------
  // Render Helpers
  // ----------------------------------------------------

  const renderMainContent = () => {
    switch (currentView) {
      case 'leads':
        return (
          <div className="flex-1 overflow-y-auto h-full">
            <LeadsView />
          </div>
        );
      case 'campaign':
        return (
          <div className="flex-1 overflow-y-auto h-full">
            <CampaignView />
          </div>
        );
      case 'chat':
      default:
        return (
          <div className="flex flex-col h-full relative">
            {/* Header — glass */}
            <header className="h-14 border-b border-border flex items-center px-6 bg-surface-950/80 backdrop-blur-md z-10 shrink-0">
              <h2 className="text-md font-semibold text-surface-50 flex items-center gap-2">
                <span className="text-surface-500" aria-hidden="true">#</span>
                {activeChannel}
              </h2>
              <span className="ml-4 text-xs font-medium text-surface-400 bg-surface-800 border border-surface-700 px-2 flex items-center py-0.5 rounded">
                Chateando con{' '}
                <span className="text-primary-400 font-semibold ml-1">
                  {selectedAgent}
                </span>
              </span>

              <div className="ml-auto flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Buscar"
                      className="p-2 rounded-md text-surface-400 hover:text-surface-100 hover:bg-surface-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      <Search size={16} aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Buscar</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Ajustes"
                      className="p-2 rounded-md text-surface-400 hover:text-surface-100 hover:bg-surface-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      <Settings size={16} aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Ajustes</TooltipContent>
                </Tooltip>
              </div>
            </header>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto w-full p-6 bg-surface-950">
              <StaggerChildren
                className="space-y-8 max-w-4xl mx-auto"
                staggerDelay={0.04}
              >
                {messages.map((m, i) => {
                  const isUser = m.role === 'user';
                  return (
                    <motion.div
                      key={i}
                      variants={staggerItem}
                      className={cn(
                        'flex gap-4 align-top',
                        isUser && 'flex-row-reverse'
                      )}
                    >
                      {/* Avatar */}
                      <div className="shrink-0 pt-1">
                        <Avatar
                          className={cn(
                            'h-8 w-8 border',
                            isUser
                              ? 'border-surface-700'
                              : 'border-primary-500/40'
                          )}
                        >
                          <AvatarFallback
                            className={cn(
                              'text-[10px] font-semibold',
                              isUser
                                ? 'bg-surface-800 text-surface-200'
                                : 'bg-primary-500/20 text-primary-400'
                            )}
                          >
                            {initialsOf(m.author)}
                          </AvatarFallback>
                        </Avatar>
                      </div>

                      {/* Bubble */}
                      <div
                        className={cn(
                          'flex flex-col max-w-[80%]',
                          isUser ? 'items-end' : 'items-start'
                        )}
                      >
                        <div className="flex items-center gap-2 mb-1.5 px-1">
                          <span className="text-sm font-semibold text-surface-50">
                            {m.author}
                          </span>
                          <span className="text-xs font-medium text-surface-500">
                            {m.time}
                          </span>
                        </div>
                        <div
                          className={cn(
                            'px-4 py-2.5 rounded-md text-sm leading-relaxed',
                            isUser
                              ? 'bg-primary-500/15 border border-primary-500/30 text-foreground'
                              : 'bg-card border border-border text-foreground'
                          )}
                        >
                          {m.text}
                        </div>

                        {/* Artifacts */}
                        {m.artifacts &&
                          Object.keys(m.artifacts).length > 0 && (
                            <div className="mt-3 flex flex-col gap-2 w-full">
                              {Object.entries(m.artifacts).map(
                                ([key, val]) => (
                                  <div
                                    key={key}
                                    className="flex flex-col gap-2 text-xs bg-surface-900/50 text-surface-100 px-3 py-3 rounded-md border border-surface-800"
                                  >
                                    <div className="flex items-center gap-2 font-semibold text-surface-300">
                                      <FileText
                                        size={14}
                                        className="text-primary-400"
                                      />
                                      <span>
                                        Artifact:{' '}
                                        <span className="text-surface-50">
                                          {key}
                                        </span>
                                      </span>
                                    </div>
                                    <pre className="p-2.5 bg-surface-950 rounded border border-surface-800 overflow-x-auto text-[11px] font-mono text-surface-300 whitespace-pre-wrap shadow-inner">
                                      {typeof val === 'object'
                                        ? JSON.stringify(val, null, 2)
                                        : val}
                                    </pre>
                                  </div>
                                )
                              )}
                            </div>
                          )}
                      </div>
                    </motion.div>
                  );
                })}
              </StaggerChildren>

              <AnimatePresence>
                {isTyping && <TypingIndicator agentName={selectedAgent} />}
              </AnimatePresence>

              <div ref={messagesEndRef} className="pb-4" />
            </div>

            {/* Input box */}
            <div className="p-4 bg-surface-950 border-t border-border shrink-0">
              <form
                onSubmit={handleSendMessage}
                className="max-w-2xl mx-auto relative flex items-center"
                aria-label={`Enviar mensaje a ${selectedAgent}`}
              >
                <label htmlFor="chat-message-input" className="sr-only">
                  Enviar mensaje a {selectedAgent}
                </label>
                <input
                  id="chat-message-input"
                  type="text"
                  className="w-full bg-surface-900 text-surface-50 rounded-md pl-4 pr-12 py-3 text-sm font-medium border border-surface-700 focus:border-primary-500 focus:bg-surface-800 focus:shadow-glow transition-all outline-none"
                  placeholder={`Enviar mensaje a ${selectedAgent}...`}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={isTyping}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() || isTyping}
                  aria-label="Enviar mensaje"
                  className="absolute right-2 p-1.5 bg-primary-500 hover:bg-primary-400 disabled:bg-surface-700 disabled:text-surface-500 disabled:cursor-not-allowed text-white rounded transition-colors shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950"
                >
                  <Send size={16} aria-hidden="true" />
                </button>
              </form>
              <div className="max-w-2xl mx-auto mt-3 text-center">
                <span className="text-[10px] text-surface-600 font-semibold tracking-widest uppercase">
                  Empírika AI Workspace
                </span>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen w-full bg-surface-950 overflow-hidden text-surface-50 font-sans">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-primary-500 focus:text-white focus:shadow-elevation-3"
        >
          Saltar al contenido principal
        </a>
        {/* 1. LEFT SIDEBAR */}
        <nav aria-label="Navegación principal" className="w-60 bg-surface-900 border-r border-border flex flex-col shrink-0 relative z-20">
          <div className="h-14 flex items-center px-5 border-b border-border shrink-0">
            <div className="w-6 h-6 rounded bg-primary-500 shadow-glow flex items-center justify-center mr-3">
              <span className="text-white font-bold text-xs select-none">
                E
              </span>
            </div>
            <span className="font-semibold text-surface-50 tracking-tight text-sm">
              empirika.workspace
            </span>
          </div>

          <div className="flex-1 overflow-y-auto py-4 w-full">
            {/* Main Channels — demo surface only */}
            <div className="mb-6">
              <h3 className="sidebar-section-title">Canales</h3>
              <NavItem
                icon={MessageSquare}
                label="General"
                isActive={
                  currentView === 'chat' && activeChannel === 'general'
                }
                onClick={() => {
                  setCurrentView('chat');
                  setActiveChannel('general');
                }}
              />
              <NavItem
                icon={User}
                label="Leads Precualificados"
                isActive={currentView === 'leads'}
                onClick={() => {
                  setCurrentView('leads');
                  setActiveChannel('leads');
                }}
              />
              <NavItem
                icon={Megaphone}
                label="Campañas"
                isActive={currentView === 'campaign'}
                onClick={() => {
                  setCurrentView('campaign');
                  setActiveChannel('campañas');
                }}
              />
            </div>

            {/* Agents */}
            <div className="mb-6">
              <h3 className="sidebar-section-title flex justify-between items-center pr-4">
                <span>Agentes</span>
                <PlusCircle
                  size={14}
                  aria-hidden="true"
                  className="text-surface-400 hover:text-primary-500 cursor-pointer"
                />
              </h3>
              {agents.length === 0 ? (
                <div className="px-5 py-2 text-xs text-surface-400 font-medium">
                  Cargando agentes...
                </div>
              ) : (
                agents.map((a) => {
                  const presence = presenceOf(a);
                  const isSelected =
                    currentView === 'chat' && selectedAgent === a.name;
                  const presenceLabel =
                    presence === 'thinking' ? 'pensando' :
                    presence === 'idle' ? 'inactivo' : 'en línea';
                  return (
                    <Tooltip key={a.name}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => {
                            setCurrentView('chat');
                            setSelectedAgent(a.name);
                          }}
                          aria-label={`Chatear con ${a.name}${a.role ? `, ${a.role}` : ''}, ${presenceLabel}`}
                          aria-current={isSelected ? 'true' : undefined}
                          className={cn(
                            'w-[calc(100%-1rem)] flex items-center gap-3 px-3 py-1.5 mx-2 rounded-md text-sm font-medium transition-all cursor-pointer select-none text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                            isSelected
                              ? 'bg-surface-800 text-surface-50 shadow-soft border border-surface-700'
                              : 'text-surface-400 hover:bg-surface-800/50 hover:text-surface-100 border border-transparent'
                          )}
                        >
                          <div className="relative shrink-0">
                            <Avatar className="h-6 w-6 border border-surface-600">
                              <AvatarFallback className="bg-primary-500/20 text-primary-400 text-[9px] font-semibold">
                                {initialsOf(a.name)}
                              </AvatarFallback>
                            </Avatar>
                            <StatusDot state={presence} />
                          </div>
                          <div className="flex flex-col overflow-hidden min-w-0">
                            <span className="truncate leading-tight text-sm text-surface-100">
                              {a.name}
                            </span>
                          </div>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {a.name}
                        {a.role ? ` — ${a.role}` : ''}
                      </TooltipContent>
                    </Tooltip>
                  );
                })
              )}
            </div>
          </div>

          {/* Bottom actions */}
          <div className="p-4 border-t border-border bg-surface-900 shrink-0 space-y-1">
            <NavItem
              icon={LogOut}
              label="Cerrar sesión"
              isActive={false}
              onClick={signOut}
            />
          </div>
        </nav>

        {/* 2. MAIN CONTENT */}
        <main id="main-content" className="flex-1 min-w-0 bg-surface-950 relative z-10 flex flex-col border-r border-border">
          {renderMainContent()}
        </main>

        {/* 3. RIGHT SIDEBAR (Context & Tasks) */}
        <aside aria-label="Contexto y supervisión" className="w-80 bg-surface-900 shrink-0 flex flex-col relative z-20">
          <header className="h-14 flex items-center px-6 border-b border-border bg-surface-900/80 backdrop-blur-sm shrink-0">
            <h2 className="font-medium text-surface-300 text-sm tracking-wide">
              Contexto y Supervisión
            </h2>
            <Badge
              variant="outline"
              className="ml-auto text-[10px] uppercase tracking-widest font-bold text-primary-400 bg-primary-500/10 border-primary-500/30"
            >
              {jobs.length} activos
            </Badge>
          </header>

          <ScrollArea className="flex-1">
            <div className="p-5 pb-10 space-y-6">
              {/* Pending Jobs section */}
              <section>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h3 className="sidebar-section-title !mb-0">
                    Cola de Trabajo
                  </h3>
                </div>

                <div className="space-y-3">
                  {jobs.length === 0 ? (
                    <div className="p-6 rounded-md border border-dashed border-surface-700 flex flex-col items-center justify-center text-center bg-transparent">
                      <CheckCircle
                        className="text-surface-500 mb-2"
                        size={20}
                      />
                      <span className="text-xs font-medium text-surface-400 block">
                        No hay tareas pendientes
                      </span>
                    </div>
                  ) : (
                    <AnimatePresence initial={false}>
                      {jobs.map((job, idx) => {
                        const approveKey = `${job.id}:approve`;
                        const rejectKey = `${job.id}:reject`;
                        const isApproving =
                          jobActionLoading === approveKey;
                        const isRejecting = jobActionLoading === rejectKey;
                        const showApprove =
                          job.status === 'PENDING' ||
                          job.status === 'AWAITING_APPROVAL';

                        return (
                          <motion.div
                            key={job.id}
                            layout
                            initial={{ opacity: 0, y: 8, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 16, scale: 0.96 }}
                            transition={{
                              type: 'spring',
                              stiffness: 320,
                              damping: 28,
                              delay: idx * 0.02,
                            }}
                          >
                            <AnimatedCard delay={0}>
                              <Card className="bg-surface-800/80 border-surface-700 p-4 shadow-elevation-1 hover:shadow-elevation-2 transition-shadow">
                                <div className="flex justify-between items-start mb-2 gap-2">
                                  <span className="text-[10px] font-mono text-surface-500 truncate">
                                    #{String(job.id).substring(0, 8)}
                                  </span>
                                  <JobStatusBadge status={job.status} />
                                </div>
                                <h4 className="text-sm font-medium text-surface-100 mb-1 leading-tight">
                                  {job.task_type}
                                </h4>
                                <p className="text-xs font-medium text-surface-500 mb-4 flex items-center gap-1.5">
                                  <User size={12} />
                                  {job.agent_name || 'Sin Asignar'}
                                </p>

                                {showApprove && (
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      variant="default"
                                      disabled={isApproving || isRejecting}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        handleApprovalAction(
                                          job.id,
                                          'approve'
                                        );
                                      }}
                                      className="flex-1 h-8 text-xs gap-1.5"
                                    >
                                      {isApproving ? (
                                        <Loader2
                                          size={14}
                                          className="animate-spin"
                                        />
                                      ) : (
                                        <CheckCircle size={14} />
                                      )}
                                      {job.status === 'AWAITING_APPROVAL'
                                        ? 'Aprobar y Ejecutar'
                                        : 'Aprobar'}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={isApproving || isRejecting}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        handleApprovalAction(
                                          job.id,
                                          'reject'
                                        );
                                      }}
                                      className="h-8 px-3 border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                      title="Rechazar"
                                      aria-label="Rechazar tarea"
                                    >
                                      {isRejecting ? (
                                        <Loader2
                                          size={14}
                                          className="animate-spin"
                                          aria-hidden="true"
                                        />
                                      ) : (
                                        <XCircle size={14} aria-hidden="true" />
                                      )}
                                    </Button>
                                  </div>
                                )}
                              </Card>
                            </AnimatedCard>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  )}
                </div>
              </section>
            </div>
          </ScrollArea>
        </aside>
      </div>
    </TooltipProvider>
  );
}

export default App;
