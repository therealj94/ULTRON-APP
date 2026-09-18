import React, { useState } from 'react';
import { Mode } from '../types';
import { X, Cpu, Sparkles, Activity, CheckCircle2, Sliders, Glasses, MessageSquare, Terminal, Send } from 'lucide-react';
import { analyzeConversationTopic, SemanticClassification } from '../04-cerebro/qwenHarness';

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
}) => {
  const [testPrompt, setTestPrompt] = useState('');
  const [activeLog, setActiveLog] = useState<Array<{
    timestamp: string;
    text: string;
    mode: Mode;
    intent: string;
    tool?: string;
  }>>([
    {
      timestamp: '19:04:12',
      text: 'Iniciando núcleo de inteligencia semántica de ULTRON FP...',
      mode: 'GUARDIAN',
      intent: 'SYSTEM_BOOT',
      tool: 'initialize_boardroom_kernel',
    },
  ]);

  if (!isOpen) return null;

  const handleTestEvaluation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPrompt.trim()) return;

    const res = analyzeConversationTopic(testPrompt);
    const time = new Date().toLocaleTimeString();

    if (res) {
      onApplyClassification(res);
      setActiveLog((prev) => [
        {
          timestamp: time,
          text: testPrompt,
          mode: res.mode,
          intent: res.intent,
          tool: res.toolCall?.name,
        },
        ...prev.slice(0, 15),
      ]);
      onSpeak(res.thought);
    } else {
      setActiveLog((prev) => [
        {
          timestamp: time,
          text: testPrompt,
          mode: currentMode,
          intent: 'GENERAL_CONVERSATION',
        },
        ...prev.slice(0, 15),
      ]);
      onSpeak(`Procesando consulta general: "${testPrompt}".`);
    }

    setTestPrompt('');
  };

  const PRESET_TOPICS = [
    {
      label: 'Finanzas & Tesorería',
      mode: 'GOLD',
      prompt: 'Revisemos el balance de tesorería, reservas en metales y utilidades del trimestre.',
    },
    {
      label: 'Seguridad & Protección',
      mode: 'GUARDIAN',
      prompt: 'Alerta de seguridad: blindar acceso del directorio y activar firewall corporativo.',
    },
    {
      label: 'Métricas & Telemetría',
      mode: 'ANALYTICAL',
      prompt: 'Analizar gráficos de conversión, métricas y telemetría de rendimiento.',
    },
    {
      label: 'Estrategia Táctica',
      mode: 'STRATEGIC',
      prompt: 'Simular jugada táctica y posicionamiento competitivo para ganar cuota de mercado.',
    },
    {
      label: 'Innovación & Diseño',
      mode: 'CREATIVE',
      prompt: 'Generar ideas innovadoras y diseño de concepto disruptivo para la junta directiva.',
    },
    {
      label: 'Exploración Global',
      mode: 'EXPLORER',
      prompt: 'Explorar tendencias geopolíticas y buscar oportunidades en nuevos mercados.',
    },
    {
      label: 'Minería & Datos Masivos',
      mode: 'MINING',
      prompt: 'Ejecutar análisis de datos masivos y optimizar los conductos de información.',
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
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#05E1FF]/20 bg-[#03070B]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg border border-[#05E1FF]/40 bg-[#05E1FF]/10 flex items-center justify-center text-[#05E1FF]">
              <Cpu className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="font-display font-bold tracking-widest text-lg text-[#05E1FF] uppercase">
                NÚCLEO DE INTELIGENCIA SEMÁNTICA · ULTRON FP
              </h2>
              <p className="text-xs text-[#8FA3B0]">
                ORQUESTADOR AUTÓNOMO PARA TRANSICIÓN DE MODOS Y DESPACHO DE HERRAMIENTAS
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

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Auto-Mode Switch */}
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

            {/* Visor Toggle */}
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

          {/* Presets */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-[#05E1FF] uppercase tracking-wider flex items-center gap-2">
              <Sliders className="w-4 h-4" />
              <span>Directrices Temáticas de Prueba</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PRESET_TOPICS.map((topic, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setTestPrompt(topic.prompt);
                    const res = analyzeConversationTopic(topic.prompt);
                    if (res) {
                      onApplyClassification(res);
                      onSpeak(res.thought);
                    }
                  }}
                  className="p-3 rounded-lg border border-[#05E1FF]/20 bg-[#04080D] hover:border-[#05E1FF] hover:bg-[#05E1FF]/10 text-left transition-all cursor-pointer flex flex-col justify-between gap-1"
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

          {/* Test Input */}
          <form onSubmit={handleTestEvaluation} className="flex gap-2">
            <input
              type="text"
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              placeholder="Escribe una instrucción de junta para analizar su clasificación..."
              className="flex-1 bg-[#020508] border border-[#05E1FF]/30 text-[#05E1FF] placeholder-[#8FA3B0]/50 text-xs px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#05E1FF] focus:shadow-[0_0_12px_rgba(5,225,255,0.25)] transition-all font-mono"
            />
            <button
              type="submit"
              className="bg-[#05E1FF] text-[#001418] font-display font-bold text-xs tracking-wider px-5 py-2.5 rounded-lg hover:bg-[#05E1FF]/90 transition-all flex items-center gap-1.5 cursor-pointer uppercase"
            >
              <Send className="w-3.5 h-3.5" />
              <span>ANALIZAR</span>
            </button>
          </form>

          {/* Activity Log */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-[#05E1FF] uppercase tracking-wider flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              <span>Registro de Inferencia Semántica</span>
            </h3>

            <div className="p-3 rounded-xl bg-[#020508] border border-[#05E1FF]/20 max-h-40 overflow-y-auto space-y-2">
              {activeLog.map((log, idx) => (
                <div key={idx} className="text-[11px] flex items-start gap-2 border-b border-white/5 pb-1.5">
                  <span className="text-[#8FA3B0] font-mono">{log.timestamp}</span>
                  <span className="text-[#05E1FF] font-bold">[{log.mode}]</span>
                  <span className="text-white flex-1 truncate">{log.text}</span>
                  {log.tool && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00FFA3]/15 text-[#00FFA3] font-mono">
                      {log.tool}()
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
