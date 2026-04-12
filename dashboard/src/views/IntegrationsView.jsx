import React, { useState, useEffect } from 'react';
import { MessageCircle, CheckCircle, RefreshCw, XCircle, Loader2, Globe } from 'lucide-react';

const WA_GATEWAY_URL = 'http://127.0.0.1:3009';

export default function IntegrationsView() {
  const [waStatus, setWaStatus] = useState('idle'); // idle | loading | qr_ready | connected | error
  const [qrCodeData, setQrCodeData] = useState(null);
  const [waSessionId, setWaSessionId] = useState(null);
  const [waErrorMessage, setWaErrorMessage] = useState('');

  // Initial status check to see if it's already connected
  useEffect(() => {
    checkInitialStatus();
  }, []);

  const checkInitialStatus = async () => {
    try {
      const res = await fetch(`${WA_GATEWAY_URL}/login/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.connected) {
          setWaStatus('connected');
        }
      }
    } catch(e) {
      console.log('WA Gateway no disponible inicialmente', e);
    }
  }

  // Polling when waiting for QR scan
  useEffect(() => {
    let interval;
    if (waStatus === 'qr_ready') {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${WA_GATEWAY_URL}/login/status`);
          if (res.ok) {
            const data = await res.json();
            if (data.connected) {
              setWaStatus('connected');
              setQrCodeData(null);
            }
          }
        } catch (err) {
          console.error("Error polling WA status", err);
        }
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [waStatus]);

  const handleConnectWA = async () => {
    setWaStatus('loading');
    setWaErrorMessage('');
    
    try {
      const res = await fetch(`${WA_GATEWAY_URL}/login/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      const data = await res.json();
      
      if (data.connected) {
        setWaStatus('connected');
      } else if (data.qr_data_url) {
        setQrCodeData(data.qr_data_url);
        setWaSessionId(data.session_id);
        setWaStatus('qr_ready');
      } else {
        setWaStatus('error');
        setWaErrorMessage(data.error || data.message || 'Error desconocido.');
      }
    } catch (err) {
      setWaStatus('error');
      setWaErrorMessage('No se pudo contactar al WhatsApp Gateway. ¿Está en ejecución?');
    }
  };

  const IntegrationsCard = ({ title, icon: Icon, description, statusComponent, actionComponent, premium }) => (
    <div className={`p-6 bg-surface-900 border border-surface-800 rounded-2xl shadow-soft flex flex-col transition-colors ${premium ? 'ring-1 ring-primary-500/30 shadow-glow bg-surface-900/80' : 'hover:border-surface-700'}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-3 rounded-xl ${premium ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20' : 'bg-surface-800 border border-surface-700 text-surface-400'}`}>
           <Icon size={22} className={premium ? 'stroke-primary-400' : 'stroke-surface-400'} />
        </div>
        <div>
          <h4 className="font-semibold text-surface-50">{title}</h4>
          <span className="text-xs font-medium text-surface-400">{description}</span>
        </div>
      </div>
      
      <div className="flex-1"></div>
      
      <div className="mt-6 flex items-center justify-between pt-4 border-t border-surface-800">
        <div className="text-sm font-medium">
          {statusComponent}
        </div>
        <div>
          {actionComponent}
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-8 pb-32 h-full overflow-y-auto bg-transparent">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <h2 className="text-2xl font-bold text-surface-50 tracking-tight">Integraciones</h2>
          <p className="mt-2 text-surface-400 font-medium">
            Conecta canales de comunicación externos para habilitar la mensajería automatizada y captura de leads B2B.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* WhatsApp API Card */}
          <IntegrationsCard 
            title="WhatsApp API (Baileys)" 
            icon={MessageCircle}
            description="Motor B2B de mensajería asíncrona y envíos directos."
            premium={true}
            statusComponent={
              waStatus === 'connected' ? (
                <span className="flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full text-xs font-bold">
                  <CheckCircle size={14} /> Conectado
                </span>
              ) : waStatus === 'loading' ? (
                <span className="flex items-center gap-1.5 text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-full text-xs font-bold">
                  <Loader2 size={14} className="animate-spin" /> Conectando...
                </span>
              ) : waStatus === 'error' ? (
                <span className="flex items-center gap-1.5 text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded-full text-xs font-bold max-w-[120px] truncate" title={waErrorMessage}>
                  <XCircle size={14} /> {waErrorMessage}
                </span>
              ) : waStatus === 'qr_ready' ? (
                <span className="flex items-center gap-1.5 text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full text-xs font-bold">
                  <RefreshCw size={14} className="animate-spin" /> Esperando escaneo...
                </span>
              ) : (
                <span className="text-surface-400 text-xs font-bold bg-surface-800 border border-surface-700 px-2.5 py-1 rounded-full">Desconectado</span>
              )
            }
            actionComponent={
              waStatus === 'connected' ? (
                <button 
                  className="px-4 py-2 bg-surface-800 border border-surface-700 text-surface-400 cursor-not-allowed text-sm font-semibold rounded-lg"
                  disabled
                >
                  Activo
                </button>
              ) : (
                <button 
                  onClick={handleConnectWA}
                  disabled={waStatus === 'loading' || waStatus === 'qr_ready'}
                  className="px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-500 transition-colors disabled:bg-surface-700 disabled:text-surface-500 disabled:cursor-not-allowed shadow-soft"
                >
                  {waStatus === 'error' ? 'Reintentar' : 'Conectar'}
                </button>
              )
            }
          />

          <IntegrationsCard 
            title="Instagram Graph" 
            icon={Globe} 
            description="Mensajes directos, historias y respuestas automáticas." 
            statusComponent={<span className="text-surface-500 text-xs font-bold">Próximamente</span>} 
            actionComponent={<button className="px-4 py-2 bg-surface-800 border border-surface-700 text-surface-500 cursor-not-allowed text-sm font-semibold rounded-lg">Retenido</button>} 
          />
          <IntegrationsCard 
            title="LinkedIn Outreach" 
            icon={Globe} 
            description="Conexiones automatizadas en ventas B2B." 
            statusComponent={<span className="text-surface-500 text-xs font-bold">Próximamente</span>} 
            actionComponent={<button className="px-4 py-2 bg-surface-800 border border-surface-700 text-surface-500 cursor-not-allowed text-sm font-semibold rounded-lg">Retenido</button>} 
          />
          <IntegrationsCard 
            title="Envío Mautic API" 
            icon={MessageCircle} 
            description="Motor SMTP de seguimiento corporativo." 
            statusComponent={<span className="text-surface-500 text-xs font-bold">Próximamente</span>} 
            actionComponent={<button className="px-4 py-2 bg-surface-800 border border-surface-700 text-surface-500 cursor-not-allowed text-sm font-semibold rounded-lg">Retenido</button>} 
          />
          <IntegrationsCard 
            title="N8N Webhooks" 
            icon={Globe} 
            description="Automatizaciones extendidas externas." 
            statusComponent={<span className="text-surface-500 text-xs font-bold">Próximamente</span>} 
            actionComponent={<button className="px-4 py-2 bg-surface-800 border border-surface-700 text-surface-500 cursor-not-allowed text-sm font-semibold rounded-lg">Retenido</button>} 
          />

        </div>

        {/* Modal-like or expanded area for QR Display */}
        {waStatus === 'qr_ready' && qrCodeData && (
          <div className="mt-10 p-8 bg-surface-900 border border-primary-500/20 rounded-2xl shadow-glow ring-1 ring-primary-500/10 relative overflow-hidden flex flex-col md:flex-row items-center gap-8">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500 rounded-full blur-3xl opacity-10 -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
            
            <div className="bg-surface-800 p-4 rounded-xl border border-surface-700 shadow-soft shrink-0 relative z-10 flex items-center justify-center">
               <img src={qrCodeData} alt="WhatsApp QR Code" className="w-56 h-56 object-contain mix-blend-screen opacity-90" />
            </div>
            
            <div className="flex-1 relative z-10">
              <h3 className="text-xl font-bold text-surface-50 mb-2">Conecta tu WhatsApp B2B</h3>
              <p className="text-surface-400 font-medium text-sm leading-relaxed mb-6 max-w-lg">
                Utiliza tu dispositivo móvil para escanear este código QR y autorizar al agente para que envíe los mensajes de prospección.
              </p>
              
              <ol className="space-y-3 mb-6">
                <li className="flex items-start gap-3 text-sm text-surface-300 font-medium">
                  <span className="w-5 h-5 bg-primary-500/20 text-primary-400 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 border border-primary-500/30">1</span>
                  <span>Abre <strong className="text-surface-100">WhatsApp</strong> en tu teléfono principal.</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-surface-300 font-medium">
                  <span className="w-5 h-5 bg-primary-500/20 text-primary-400 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 border border-primary-500/30">2</span>
                  <span>Toca Menú o Configuración y selecciona <strong className="text-surface-100">Dispositivos vinculados</strong>.</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-surface-300 font-medium">
                  <span className="w-5 h-5 bg-primary-500/20 text-primary-400 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 border border-primary-500/30">3</span>
                  <span>Apunta tu teléfono a esta pantalla para capturar el código (válido unos segundos).</span>
                </li>
              </ol>

              <button 
                onClick={handleConnectWA} 
                className="text-sm font-semibold text-primary-400 hover:text-primary-300 flex items-center gap-1.5 transition-colors bg-primary-500/10 px-3 py-1.5 rounded-md hover:bg-primary-500/20 border border-primary-500/10"
              >
                <RefreshCw size={14} /> <span>Refrescar Código QR</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
