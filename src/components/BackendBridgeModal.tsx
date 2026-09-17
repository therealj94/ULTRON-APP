import React, { useState } from 'react';
import { Radio, Check, X, RefreshCw, Send, Terminal, Play, ShieldCheck, Copy } from 'lucide-react';
import { FaceState, Mode } from '../types';

interface BackendBridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  wsUrl: string;
  onChangeWsUrl: (url: string) => void;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  onConnect: () => void;
  onDisconnect: () => void;
  onSimulateIncoming: (data: { face?: FaceState; mode?: Mode; speak?: string; gaze?: { x: number; y: number } }) => void;
  log: Array<{ timestamp: string; direction: 'in' | 'out'; payload: string }>;
}

export const BackendBridgeModal: React.FC<BackendBridgeModalProps> = ({
  isOpen,
  onClose,
  wsUrl,
  onChangeWsUrl,
  status,
  onConnect,
  onDisconnect,
  onSimulateIncoming,
  log,
}) => {
  const [copiedContract, setCopiedContract] = useState(false);
  const [customSpeak, setCustomSpeak] = useState('La junta directiva tiene quorum completo. Procedemos con la sesión.');

  if (!isOpen) return null;

  const jsonContractExample = `{
  "type": "ultron_event",
  "face": "THINKING",      // IDLE | LISTENING | THINKING | SPEAKING | HAPPY | CONCERNED | ANGRY | SLEEPING
  "mode": "STRATEGIC",     // GUARDIAN | MINING | GOLD | CREATIVE | ANALYTICAL | STRATEGIC | EXPLORER
  "speak": "Análisis completado.",
  "gaze": { "x": 0.25, "y": -0.1 },  // Normalized coordinates (-1.0 to 1.0)
  "metadata": {
    "session": "board_executive_01",
    "model": "Qwen / ULTRON Core"
  }
}`;

  const copyContract = () => {
    navigator.clipboard.writeText(jsonContractExample);
    setCopiedContract(true);
    setTimeout(() => setCopiedContract(false), 2000);
  };

  return (
    <div
      id="ultron-backend-bridge-modal"
      className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-3xl bg-[#05080c] border border-[#05E1FF]/40 rounded-xl p-6 shadow-[0_0_35px_rgba(5,225,255,0.25)] flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#05E1FF]/20 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#05E1FF]/10 border border-[#05E1FF]/30 flex items-center justify-center text-[#05E1FF]">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <span className="text-[10px] font-mono tracking-[0.2em] text-[#8FA3B0] block uppercase">
                INTEGRACIÓN DE CEREBRO / MOTOR EXTERNO
              </span>
              <h3 className="font-display font-bold text-lg text-[#05E1FF] tracking-wider">
                PUENTE BACKEND (QWEN / ULTRON CORE / WS)
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[#8FA3B0] hover:text-[#05E1FF] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Intro */}
        <p className="text-xs font-mono text-[#8FA3B0] leading-relaxed">
          Este visor opera en modo autónomo frontend y está preparado para conectarse a tu backend armado (Qwen, FastAPI, Node o DeskBot/RON) mediante WebSocket o REST. El visor consume estados de cara, modo, voz y mirada, y emite eventos de interacción táctil y voz.
        </p>

        {/* Connection Bar */}
        <div className="flex flex-col sm:flex-row items-center gap-2 bg-black/60 p-3 rounded-lg border border-[#05E1FF]/25">
          <div className="flex-1 w-full">
            <label className="text-[10px] font-mono text-[#8FA3B0] block mb-1 uppercase tracking-wider">
              Dirección WebSocket o Endpoint de Eventos:
            </label>
            <input
              type="text"
              value={wsUrl}
              onChange={(e) => onChangeWsUrl(e.target.value)}
              placeholder="ws://127.0.0.1:8000/api/v1/ws/events"
              className="w-full bg-[#05080c] border border-[#05E1FF]/30 text-[#05E1FF] font-mono text-xs px-3 py-2 rounded focus:outline-none focus:border-[#05E1FF]"
            />
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto pt-2 sm:pt-4">
            {status === 'connected' ? (
              <button
                type="button"
                onClick={onDisconnect}
                className="px-4 py-2 rounded border border-[#FF3B3B] bg-[#FF3B3B]/10 text-[#FF3B3B] font-display font-bold text-xs tracking-wider hover:bg-[#FF3B3B]/20 transition-all"
              >
                DESCONECTAR
              </button>
            ) : (
              <button
                type="button"
                onClick={onConnect}
                disabled={status === 'connecting'}
                className="px-4 py-2 rounded bg-[#05E1FF] text-[#001418] font-display font-bold text-xs tracking-wider hover:bg-[#05E1FF]/90 transition-all flex items-center gap-1.5"
              >
                {status === 'connecting' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                CONECTAR
              </button>
            )}
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-[#8FA3B0]">Estado del puente:</span>
          <span
            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
              status === 'connected'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : status === 'connecting'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'bg-black/60 text-[#8FA3B0] border border-[#8FA3B0]/30'
            }`}
          >
            {status === 'connected'
              ? 'EN LÍNEA (STREAMING ACTIVO)'
              : status === 'connecting'
              ? 'CONECTANDO...'
              : 'LISTO PARA RECEPTAR BACKEND'}
          </span>
        </div>

        {/* Simulation / Testing Panel */}
        <div className="flex flex-col gap-2 p-3 bg-black/50 border border-[#05E1FF]/20 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-display tracking-[0.2em] text-[#05E1FF] flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-[#05E1FF]" />
              SIMULADOR DE EVENTOS ENTRANTES DESDE QWEN
            </span>
            <span className="text-[10px] font-mono text-[#8FA3B0]">Inyecta estados directamente al visor</span>
          </div>

          <div className="flex gap-2 items-center flex-wrap pt-1">
            <button
              type="button"
              onClick={() => onSimulateIncoming({ face: 'LISTENING', mode: 'GUARDIAN', speak: 'Escuchando petición del presidente...' })}
              className="px-2.5 py-1.5 rounded border border-[#05E1FF]/30 text-[#05E1FF] bg-[#05E1FF]/10 text-xs font-mono hover:bg-[#05E1FF]/20"
            >
              Listening + Guardian
            </button>
            <button
              type="button"
              onClick={() => onSimulateIncoming({ face: 'THINKING', mode: 'ANALYTICAL' })}
              className="px-2.5 py-1.5 rounded border border-[#05E1FF]/30 text-[#05E1FF] bg-[#05E1FF]/10 text-xs font-mono hover:bg-[#05E1FF]/20"
            >
              Thinking + Analytical
            </button>
            <button
              type="button"
              onClick={() => onSimulateIncoming({ face: 'SPEAKING', mode: 'GOLD', speak: 'Balance financiero verificado en oro.' })}
              className="px-2.5 py-1.5 rounded border border-[#F5C542]/40 text-[#F5C542] bg-[#F5C542]/10 text-xs font-mono hover:bg-[#F5C542]/20"
            >
              Speaking + Gold
            </button>
            <button
              type="button"
              onClick={() => onSimulateIncoming({ face: 'HAPPY', mode: 'CREATIVE', speak: 'Propuesta de diseño aprobada unánimemente.' })}
              className="px-2.5 py-1.5 rounded border border-[#05E1FF]/30 text-[#05E1FF] bg-[#05E1FF]/10 text-xs font-mono hover:bg-[#05E1FF]/20"
            >
              Happy + Creative
            </button>
          </div>

          <div className="flex gap-2 pt-2">
            <input
              type="text"
              value={customSpeak}
              onChange={(e) => setCustomSpeak(e.target.value)}
              placeholder="Texto a vocalizar por ULTRON..."
              className="flex-1 bg-[#05080c] border border-[#05E1FF]/25 text-xs font-mono px-3 py-1.5 text-[#05E1FF] rounded focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onSimulateIncoming({ face: 'SPEAKING', speak: customSpeak })}
              className="px-3 py-1.5 rounded bg-[#05E1FF]/20 border border-[#05E1FF] text-[#05E1FF] font-display text-xs font-bold tracking-wider hover:bg-[#05E1FF]/30 flex items-center gap-1"
            >
              <Send className="w-3 h-3" />
              VOCALIZAR
            </button>
          </div>
        </div>

        {/* JSON Schema Contract */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-display tracking-[0.2em] text-[#8FA3B0] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#05E1FF]" />
              CONTRATO JSON PARA TU BACKEND
            </span>
            <button
              type="button"
              onClick={copyContract}
              className="text-[11px] font-mono text-[#05E1FF] hover:underline flex items-center gap-1"
            >
              {copiedContract ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedContract ? 'Copiado' : 'Copiar esquema'}
            </button>
          </div>
          <pre className="p-3 bg-black border border-[#05E1FF]/20 rounded text-[11px] font-mono text-[#05E1FF]/80 overflow-x-auto">
            {jsonContractExample}
          </pre>
        </div>

        {/* Telemetry Log */}
        {log.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-mono tracking-wider text-[#8FA3B0]">REGISTRO DE EVENTOS (TELEMETRÍA):</span>
            <div className="p-2.5 bg-black/90 border border-[#05E1FF]/15 rounded max-h-28 overflow-y-auto flex flex-col gap-1 text-[10px] font-mono">
              {log.map((item, idx) => (
                <div key={idx} className="flex gap-2">
                  <span className="text-[#8FA3B0]/60">{item.timestamp}</span>
                  <span className={item.direction === 'in' ? 'text-emerald-400' : 'text-[#05E1FF]'}>
                    [{item.direction.toUpperCase()}]
                  </span>
                  <span className="text-[#dff8ff] truncate">{item.payload}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
