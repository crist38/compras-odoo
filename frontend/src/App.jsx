import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Check,
  ChevronRight,
  Database,
  ExternalLink,
  Loader2,
  Moon,
  RefreshCw,
  Search,
  Sun
} from 'lucide-react';

// In Vite dev mode the backend runs separately; in production it serves the frontend itself
const API_BASE_URL = import.meta.env.DEV
  ? 'http://localhost:5000/api'
  : '/api';

// Color of each tracking row (Técnico, Financiero, Producción, Despacho, Instalación)
const TRACK_COLORS = {
  tecnico: '#E8892B',
  financiero: '#2E8B57',
  produccion: '#0E8A93',
  despacho: '#2D6BB0',
  instalacion: '#C24E4E'
};

const ORDER_STATES = { draft: 'Borrador', sent: 'Enviada', sale: 'Confirmada', done: 'Bloqueada' };

// Parse an API response; non-JSON bodies (e.g. Vercel timeout/error pages) become a readable error
async function readJson(response, step) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const reason = response.status === 504 || /timeout/i.test(text)
      ? 'el servidor tardó demasiado en responder'
      : 'el servidor devolvió una respuesta inválida';
    return { success: false, message: `${step}: ${reason} (HTTP ${response.status}).` };
  }
}

// One row of the board: label + chevron-separated steps, the current one filled with the track color
function TrackRow({ track, state }) {
  const color = TRACK_COLORS[track.key];
  return (
    <div className="py-3">
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
        <h4 className="md:w-32 flex-shrink-0 text-sm font-extrabold uppercase tracking-wide" style={{ color }}>
          {track.label}
        </h4>
        {/* Steps stack vertically on phones and form a chevron row from md up */}
        <div className="flex-1 flex flex-col md:flex-row md:items-stretch gap-1">
          {track.steps.map((step, idx) => {
            const isCurrent = idx === state.step;
            const isPast = idx < state.step;
            return (
              <React.Fragment key={step}>
                {idx > 0 && (
                  <ChevronRight className="hidden md:block h-3.5 w-3.5 self-center flex-shrink-0" style={{ color }} />
                )}
                <div
                  className={`flex-1 min-w-0 flex items-center md:justify-center gap-1 rounded-xl border px-3 md:px-1.5 py-1.5 md:py-3 md:text-center text-xs leading-tight transition-colors ${
                    isCurrent ? 'font-bold shadow-md' : isPast ? 'font-medium' : 'text-slate-400'
                  }`}
                  style={{
                    borderColor: color,
                    backgroundColor: isCurrent ? color : isPast ? `${color}1F` : 'transparent',
                    color: isCurrent ? '#ffffff' : undefined,
                    opacity: !isCurrent && !isPast ? 0.65 : 1
                  }}
                  title={isCurrent ? state.detail : step}
                >
                  {isPast && <Check className="h-3 w-3 flex-shrink-0" style={{ color }} />}
                  <span className="break-words">{step}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
      <p className="md:ml-36 mt-1.5 text-xs text-slate-400 flex items-start gap-1.5">
        {state.fromStage && (
          <span className="flex-shrink-0 bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 rounded-full text-[10px] font-semibold">
            según CRM
          </span>
        )}
        <span>{state.detail}</span>
      </p>
    </div>
  );
}

export default function App() {
  // Theme State (Default to dark)
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'dark';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Login / Auth State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Odoo credentials (only email + password, URL/DB are in server .env.local)
  const [odooEmail, setOdooEmail] = useState('');
  const [odooPass, setOdooPass] = useState('');
  const [odooDb, setOdooDb] = useState('');
  const [odooUrl, setOdooUrl] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  // Tracking board (won CRM opportunities and their 5 tracks)
  const [tracks, setTracks] = useState([]);
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [boardError, setBoardError] = useState('');
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState(null);

  const getOdooCredentialsObj = () => ({
    email: odooEmail,
    password: odooPass
  });

  const odooLink = (model, id) => `${odooUrl.replace(/\/$/, '')}/web#id=${id}&model=${model}&view_type=form`;

  const testOdooConnection = async (e) => {
    if (e) e.preventDefault();
    setConnectionStatus('connecting');
    setLoginError('');

    try {
      const response = await fetch(`${API_BASE_URL}/odoo/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odooCredentials: getOdooCredentialsObj()
        })
      });

      let data;
      try {
        data = await response.json();
      } catch {
        // If response is not JSON (e.g. HTML error page), show HTTP status
        setConnectionStatus('error');
        setLoginError(`Error del servidor (HTTP ${response.status}). Verifica las variables de entorno en Vercel.`);
        return;
      }

      if (data.success) {
        setOdooDb(data.db || '');
        setOdooUrl(data.url || '');
        setConnectionStatus('connected');
        setIsLoggedIn(true);
      } else {
        setConnectionStatus('error');
        setLoginError(data.message || 'Correo o contraseña incorrectos.');
      }
    } catch (error) {
      setConnectionStatus('error');
      setLoginError(`Error de red: ${error.message}. Verifica que el backend esté activo.`);
    }
  };

  const fetchBoard = async () => {
    setIsLoading(true);
    setBoardError('');
    try {
      const response = await fetch(`${API_BASE_URL}/odoo/tracking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odooCredentials: getOdooCredentialsObj(),
          search,
          stageId: stageFilter || null
        })
      });
      const data = await readJson(response, 'Cargar seguimiento');
      if (data.success) {
        setTracks(data.tracks);
        setStages(data.stages);
        setLeads(data.leads);
        setWarnings(data.warnings || []);
        setSelectedLeadId(prev => (data.leads.some(l => l.id === prev) ? prev : data.leads[0]?.id ?? null));
      } else {
        setBoardError(data.message);
      }
    } catch (error) {
      setBoardError(`Error de red: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Reload the board when the search or stage filter changes
  useEffect(() => {
    if (connectionStatus === 'connected') {
      const delayDebounce = setTimeout(() => {
        fetchBoard();
      }, 500);
      return () => clearTimeout(delayDebounce);
    }
  }, [search, stageFilter, connectionStatus]);

  const handleLogout = () => {
    setIsLoggedIn(false);
    setConnectionStatus('disconnected');
    setLeads([]);
    setStages([]);
    setWarnings([]);
    setSelectedLeadId(null);
  };

  const selectedLead = leads.find(l => l.id === selectedLeadId) || null;

  // ─── LOGIN SCREEN ─────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        {/* Theme Toggle Button */}
        <div className="absolute top-6 right-6 z-20">
          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:text-purple-600 dark:hover:text-purple-400 hover:border-purple-500/40 transition-all duration-200 shadow-md backdrop-blur-md"
            title={theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>

        {/* Background decoration */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-purple-900/20 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-indigo-900/20 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center bg-gradient-to-br from-purple-600 to-indigo-700 text-white w-16 h-16 rounded-2xl text-2xl font-black shadow-2xl shadow-purple-900/40 mb-4">
              Od
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Seguimiento de Proyectos
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Estado técnico, financiero, producción, despacho e instalación desde el CRM
            </p>
          </div>

          {/* Login Form */}
          <div className="glass-panel rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center space-x-2 mb-6 border-b border-slate-800 pb-4">
              <Database className="h-5 w-5 text-purple-400" />
              <h2 className="text-lg font-bold text-white">Iniciar Sesión en Odoo</h2>
            </div>

            {loginError && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-start space-x-2">
                <AlertCircle className="h-4 w-4 text-rose-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-rose-300">{loginError}</p>
              </div>
            )}

            <form onSubmit={testOdooConnection} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Email / Usuario</label>
                <input
                  type="text"
                  value={odooEmail}
                  onChange={(e) => setOdooEmail(e.target.value)}
                  placeholder="cristian3877@gmail.com"
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Contraseña</label>
                <input
                  type="password"
                  value={odooPass}
                  onChange={(e) => setOdooPass(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={connectionStatus === 'connecting'}
                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold py-3 px-4 rounded-xl text-sm transition-all transform active:scale-95 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:pointer-events-none shadow-lg shadow-purple-900/30 mt-2"
              >
                {connectionStatus === 'connecting' ? (
                  <>
                    <Loader2 className="animate-spin h-4 w-4" />
                    <span>Conectando...</span>
                  </>
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4" />
                    <span>Iniciar Sesión</span>
                  </>
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-[10px] text-slate-600 mt-6">
            Las credenciales se almacenan localmente en el servidor (.env.local)
          </p>
        </div>
      </div>
    );
  }

  // ─── MAIN APP (after login) ───────────────────────────────────────────
  return (
    <div className="min-h-screen pb-12">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 sticky top-0 z-10 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-odoo text-white p-2 rounded-lg font-bold shadow-lg shadow-purple-900/30">
              Od
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                Seguimiento de Proyectos <span className="text-xs bg-slate-800 text-slate-400 py-0.5 px-2 rounded-full font-normal">v2.0</span>
              </h1>
              <p className="text-xs text-slate-400">Conectado como <span className="text-purple-400 font-semibold">{odooEmail}</span> en <span className="text-purple-400 font-semibold">{odooDb}</span></p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {/* Connection Status Badge */}
            <div className="hidden sm:flex items-center space-x-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-medium text-slate-300">Odoo Conectado</span>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-purple-450 transition-colors"
              title={theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* Logout button */}
            <button
              onClick={handleLogout}
              className="text-xs text-slate-500 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 px-3 py-1.5 rounded-lg transition-colors font-semibold"
            >
              Cerrar Sesión
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* Left Column: CRM opportunities */}
        <div className="lg:col-span-4 space-y-6">
          <section className="glass-panel rounded-2xl p-6 shadow-xl">
            <div className="flex items-center space-x-2 mb-4 border-b border-slate-800 pb-3">
              <Briefcase className="h-5 w-5 text-indigo-400" />
              <h2 className="text-lg font-bold text-white">Oportunidades</h2>
              <span className="text-xs bg-slate-900 text-slate-400 px-2 py-0.5 rounded-full">{leads.length}</span>
            </div>

            <div className="flex items-center space-x-2">
              <div className="relative flex-1">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar oportunidad o cliente..."
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <button
                onClick={fetchBoard}
                disabled={isLoading}
                title="Recargar desde Odoo"
                className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="mt-2 w-full bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
            >
              <option value="">Todas las etapas ganadas</option>
              {stages.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <div className="mt-3 max-h-[560px] overflow-y-auto space-y-1.5 pr-1">
              {isLoading && leads.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-slate-500 text-xs space-x-2">
                  <Loader2 className="animate-spin h-4 w-4" />
                  <span>Cargando CRM...</span>
                </div>
              ) : leads.length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-8">No se encontraron oportunidades ganadas.</p>
              ) : (
                leads.map(lead => (
                  <button
                    key={lead.id}
                    onClick={() => setSelectedLeadId(lead.id)}
                    className={`w-full text-left border rounded-xl bg-slate-950/40 p-2.5 transition-colors ${
                      selectedLeadId === lead.id ? 'border-purple-500/60' : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <p className="text-xs font-semibold text-slate-200 truncate" title={lead.name}>{lead.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">
                      {lead.partner || 'Sin cliente'}{lead.stage ? ` · ${lead.stage}` : ''}
                    </p>
                    {/* Mini progress of the 5 tracks */}
                    <div className="mt-2 grid grid-cols-5 gap-1">
                      {tracks.map(track => {
                        const state = lead.tracks.find(t => t.key === track.key);
                        const progress = (state.step + 1) / track.steps.length;
                        return (
                          <div
                            key={track.key}
                            className="h-1.5 rounded-full bg-slate-900 overflow-hidden"
                            title={`${track.label}: ${track.steps[state.step]}`}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${progress * 100}%`, backgroundColor: TRACK_COLORS[track.key] }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Right Column: tracking board of the selected opportunity */}
        <div className="lg:col-span-8 space-y-6">
          {boardError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-start space-x-2">
              <AlertCircle className="h-4 w-4 text-rose-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-rose-300">{boardError}</p>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-400 space-y-1">
              {warnings.map(w => (
                <p key={w} className="flex items-start space-x-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>{w}</span>
                </p>
              ))}
            </div>
          )}

          {selectedLead ? (
            <section className="glass-panel rounded-2xl p-6 shadow-xl">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4 mb-2">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-white truncate" title={selectedLead.name}>{selectedLead.name}</h3>
                  <p className="text-xs text-slate-400">
                    {selectedLead.partner || 'Sin cliente'} · Etapa CRM: <span className="text-purple-400 font-semibold">{selectedLead.stage}</span>
                    {selectedLead.salesperson ? ` · ${selectedLead.salesperson}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {selectedLead.orders.length === 0 ? (
                      <span className="text-[11px] text-amber-400">Sin cotización vinculada a esta oportunidad.</span>
                    ) : selectedLead.orders.map(o => (
                      <a
                        key={o.id}
                        href={odooUrl ? odooLink('sale.order', o.id) : undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center space-x-1 bg-slate-900 border border-slate-800 hover:border-slate-700 px-2 py-0.5 rounded-full text-[11px] text-slate-300"
                      >
                        <span className="font-mono font-semibold">{o.name}</span>
                        <span className="text-slate-500">· {ORDER_STATES[o.state] || o.state}</span>
                      </a>
                    ))}
                  </div>
                </div>
                {odooUrl && (
                  <a
                    href={odooLink('crm.lead', selectedLead.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-shrink-0 inline-flex items-center space-x-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 font-semibold py-1.5 px-3 rounded-lg text-xs transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Abrir en Odoo</span>
                  </a>
                )}
              </div>

              <div className="divide-y divide-slate-800/40">
                {tracks.map(track => (
                  <TrackRow
                    key={track.key}
                    track={track}
                    state={selectedLead.tracks.find(t => t.key === track.key)}
                  />
                ))}
              </div>
            </section>
          ) : (
            /* Empty State */
            <div className="glass-panel rounded-2xl p-12 flex flex-col items-center justify-center text-center h-[400px]">
              <Briefcase className="h-16 w-16 text-slate-700 mb-4 animate-float" />
              <h3 className="text-lg font-bold text-white">Ninguna oportunidad seleccionada</h3>
              <p className="text-sm text-slate-400 max-w-sm mt-2">
                Seleccione una oportunidad ganada del CRM para ver su estado técnico, financiero, de producción, despacho e instalación.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
