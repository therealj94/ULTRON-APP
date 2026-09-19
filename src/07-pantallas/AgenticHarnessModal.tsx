import React, { useState } from 'react';
import { Mode } from '../types';
import { X, Cpu, Sparkles, Activity, Sliders, Glasses, Terminal, Send } from 'lucide-react';
import { analyzeConversationTopic, SemanticClassification } from '../04-cerebro/qwenHarness';
import { pedirTurno } from '../04-cerebro/turno';
import { enrutar } from '../04-cerebro/skills';

interface AgenticHarnessModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMode: Mode;
  autoModeSwitch: boolean;
  onToggleAutoModeSwitch: () => void;
  hasVisor: boolean;
  onToggleVisor: () => void;
  onApplyClassification: (classification: SemanticClassification) => void;
  onSpeak: (text: string) => void;
  usuario?: string;
}

export const AgenticHarnessModal: React.FC<AgenticHarnessModalProps> = ({
  isOpen,
  onClose,
  currentMode,
  autoModeSwitch,
  onToggleAutoModeSwitch,
  hasVisor,
  onToggleVisor,
  onApplyClassification,
  onSpeak,
  usuario,
}) => {
  const [testPrompt, setTestPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeLog, setActiveLog] = useState<Array<{
    timestamp: string;
    text: string;
    mode: Mode;
    intent: string;
    tool?: string;
  }>>([
    {
      timestamp: '—',
      text: 'Harness real: POST /api/turno. Sin teatro.',
      mode: 'GUARDIAN',
      intent: 'HARNESS',
      tool: '/api/turno',
    },
  ]);

  if (!isOpen) return null;

  const correr = async (prompt: string) => {
    const q = prompt.trim();
    if (!q || busy) return;
    setBusy(true);
    const time = new Date().toLocaleTimeString();
    const local = analyzeConversationTopic(q);
    if (local) onApplyClassification(local);
    const ruta = enrutar(q);
    try {
      const data = await pedirTurno({ message: q, mode: local?.mode || currentMode, usuario });
      const reply = String(data.reply || data.error || 'Sin respuesta').slice(0, 400);
      const tools = (data.herramientas || []).join(',') || ruta.skill;
      setActiveLog((prev) => [
        {
          timestamp: time,
          text: `${q} → ${reply}`,
          mode: (local?.mode || currentMode) as Mode,
          intent: ruta.skill,
          tool: tools,
        },
        ...prev.slice(0, 15),
      ]);
      onSpeak(reply);
    } catch (e: any) {
      const err = String(e?.message || e).slice(0, 160);
      setActiveLog((prev) => [
        {
          timestamp: time,
          text: `${q} → ${err}`,
          mode: currentMode,
          intent: 'ERROR',
        },
        ...prev.slice(0, 15),
      ]);
      onSpeak(err);
    } finally {
      setBusy(false);
      setTestPrompt('');
    }
  };

  const handleTestEvaluation = (e: React.FormEvent) => {
    e.preventDefault();
    void correr(testPrompt);
  };

  const PRESET_TOPICS = [
    {
      label: 'Hora Honduras',
      mode: 'GUARDIAN',
      prompt: 'qué hora es',
    },
    {
      label: 'Spot oro',
      mode: 'GOLD',
      prompt: 'precio del oro',
    },
    {
      label: 'Web BCH',
      mode: 'ANALYTICAL',
      prompt: 'busca tipo de cambio BCH',
    },
    {
      label: 'Clima',
      mode: 'EXPLORER',
      prompt: 'clima en Tegucigalpa',
    },
    {
      label: 'Genesis',
      mode: 'STRATEGIC',
      prompt: 'actualiza el cerebro',
    },
    {
      label: 'Canto 1',
      mode: 'CREATIVE',
      prompt: 'canta 1',
    },
  ];

  return (
    <div
      id="agentic-harness-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn font-mono"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl bg-[#060B10] border border-[#05E1FF]/40 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.9),0_0_35px_rgba(5,225,255,0.2)] flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#05E1FF]/20 bg-[#03070B]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg border border-[#05E1FF]/40 bg-[#05E1FF]/10 flex items-center justify-center text-[#05E1FF]">
              <Cpu className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="font-display font-bold tracking-widest text-lg text-[#05E1FF] uppercase">
                HARNESS /api/turno · ULTRON FP
              </h2>
              <p className="text-xs text-[#8FA3B0]">
                ROUTER DE SKILLS + QWEN. MÁXIMO 2 HOPS JSON.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#8FA3B0] hover:text-[#05E1FF] hover:bg-[#05E1FF]/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-black/60 border border-[#05E1FF]/20 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Sparkles className="w-4 h-4 text-[#05E1FF]" />
                  <span>Transición Semántica Automática</span>
                </div>
                <p className="text-xs text-[#8FA3B0] mt-0.5">
                  Adapta la expresión y personalidad según el tema de la reunión.
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleAutoModeSwitch}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                  autoModeSwitch
                    ? 'bg-[#05E1FF] text-black shadow-[0_0_12px_rgba(5,225,255,0.4)]'
                    : 'bg-white/10 text-[#8FA3B0]'
                }`}
              >
                {autoModeSwitch ? 'ACTIVO' : 'MANUAL'}
              </button>
            </div>

            <div className="p-4 rounded-xl bg-black/60 border border-[#05E1FF]/20 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Glasses className="w-4 h-4 text-[#FF3B5C]" />
                  <span>Visor Óptico Avanzado</span>
                </div>
                <p className="text-xs text-[#8FA3B0] mt-0.5">
                  Superpone el visor cibernético con telemetría de objetivos.
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleVisor}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                  hasVisor
                    ? 'bg-[#FF3B5C] text-white shadow-[0_0_15px_rgba(255,59,92,0.5)]'
                    : 'bg-white/10 text-[#8FA3B0]'
                }`}
              >
                {hasVisor ? 'EQUIPADO' : 'RETIRADO'}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-bold text-[#05E1FF] uppercase tracking-wider flex items-center gap-2">
              <Sliders className="w-4 h-4" />
              <span>Pruebas reales contra el harness</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PRESET_TOPICS.map((topic, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setTestPrompt(topic.prompt);
                    void correr(topic.prompt);
                  }}
                  className="p-3 rounded-lg border border-[#05E1FF]/20 bg-[#04080D] hover:border-[#05E1FF] hover:bg-[#05E1FF]/10 text-left transition-all cursor-pointer flex flex-col justify-between gap-1 disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-display font-bold text-white tracking-wide">
                      {topic.label}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#05E1FF]/15 text-[#05E1FF] font-mono">
                      {topic.mode}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#8FA3B0] line-clamp-1">
                    "{topic.prompt}"
                  </p>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleTestEvaluation} className="flex gap-2">
            <input
              type="text"
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              placeholder="Orden para /api/turno…"
              className="flex-1 bg-[#020508] border border-[#05E1FF]/30 text-[#05E1FF] placeholder-[#8FA3B0]/50 text-xs px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#05E1FF] focus:shadow-[0_0_12px_rgba(5,225,255,0.25)] transition-all font-mono"
            />
            <button
              type="submit"
              disabled={busy}
              className="bg-[#05E1FF] text-[#001418] font-display font-bold text-xs tracking-wider px-5 py-2.5 rounded-lg hover:bg-[#05E1FF]/90 transition-all flex items-center gap-1.5 cursor-pointer uppercase disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{busy ? 'TURNO…' : 'TURNO'}</span>
            </button>
          </form>

          <div className="space-y-2">
            <h3 className="text-xs font-bold text-[#05E1FF] uppercase tracking-wider flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              <span>Registro del harness</span>
              {busy && <Activity className="w-3 h-3 text-[#05E1FF] animate-pulse" />}
            </h3>

            <div className="p-3 rounded-xl bg-[#020508] border border-[#05E1FF]/20 max-h-40 overflow-y-auto space-y-2">
              {activeLog.map((log, idx) => (
                <div key={idx} className="text-[11px] flex items-start gap-2 border-b border-white/5 pb-1.5">
                  <span className="text-[#8FA3B0] font-mono">{log.timestamp}</span>
                  <span className="text-[#05E1FF] font-bold">[{log.mode}]</span>
                  <span className="text-white flex-1 truncate">{log.text}</span>
                  {log.tool && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00FFA3]/15 text-[#00FFA3] font-mono">
                      {log.tool}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
