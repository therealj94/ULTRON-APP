import React, { useState } from 'react';
import {
  HelpCircle,
  X,
  Eye,
  Camera,
  Mic,
  Volume2,
  Hand,
  Sparkles,
  Shield,
  Layers,
  RotateCcw,
  Sliders,
  Glasses,
  Play,
  FileText,
  Lock,
  Cpu,
  Compass,
} from 'lucide-react';
import { playSfx } from '../utils/audio';

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAction?: (action: string) => void;
  soundFxEnabled?: boolean;
}

export const TutorialModal: React.FC<TutorialModalProps> = ({
  isOpen,
  onClose,
  onSelectAction,
  soundFxEnabled = true,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'buttons' | 'touch' | 'camera' | 'voice'>('overview');

  if (!isOpen) return null;

  return (
    <div
      id="tutorial-guide-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-3xl bg-[#080d12] border border-[#05E1FF]/40 rounded-2xl p-6 shadow-[0_0_35px_rgba(5,225,255,0.2)] flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#05E1FF]/20 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#05E1FF]/15 border border-[#05E1FF]/40 flex items-center justify-center text-[#05E1FF]">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-mono tracking-[0.25em] text-[#8FA3B0] block uppercase">
                MANUAL OPERATIVO · ULTRON FP & LOOI
              </span>
              <h2 className="font-display font-bold text-base text-white tracking-wider">
                GUÍA DE FUNCIONAMIENTO & CONTROLES
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              playSfx('tap', soundFxEnabled);
              onClose();
            }}
            className="p-1.5 rounded text-[#8FA3B0] hover:text-[#05E1FF] transition-colors cursor-pointer"
            title="Cerrar Guía"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-white/10 pb-2 text-xs font-mono overflow-x-auto">
          <button
            onClick={() => {
              playSfx('tap', soundFxEnabled);
              setActiveTab('overview');
            }}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-[#05E1FF]/20 border-[#05E1FF] text-[#05E1FF] font-bold'
                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
            }`}
          >
            Visión General
          </button>
          <button
            onClick={() => {
              playSfx('tap', soundFxEnabled);
              setActiveTab('buttons');
            }}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'buttons'
                ? 'bg-[#00FFA3]/20 border-[#00FFA3] text-[#00FFA3] font-bold'
                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Guía de Botones
          </button>
          <button
            onClick={() => {
              playSfx('tap', soundFxEnabled);
              setActiveTab('camera');
            }}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'camera'
                ? 'bg-[#05E1FF]/20 border-[#05E1FF] text-[#05E1FF] font-bold'
                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            Cámara y Seguimiento
          </button>
          <button
            onClick={() => {
              playSfx('tap', soundFxEnabled);
              setActiveTab('touch');
            }}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'touch'
                ? 'bg-amber-400/20 border-amber-400 text-amber-300 font-bold'
                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
            }`}
          >
            <Hand className="w-3.5 h-3.5" />
            Interacción Táctil
          </button>
          <button
            onClick={() => {
              playSfx('tap', soundFxEnabled);
              setActiveTab('voice');
            }}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'voice'
                ? 'bg-purple-400/20 border-purple-400 text-purple-300 font-bold'
                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            Voz e IA Qwen
          </button>
        </div>

        {/* Tab 1: Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-3 font-mono text-xs text-white/80">
            <div className="p-3.5 rounded-xl bg-black/60 border border-[#05E1FF]/30 space-y-2">
              <h3 className="text-sm font-bold text-[#05E1FF] flex items-center gap-2">
                <Cpu className="w-4 h-4" />
                ¿Qué es ULTRON FP?
              </h3>
              <p className="leading-relaxed">
                ULTRON FP es un asistente robótico de escritorio y núcleo de inteligencia para la junta directiva, basado en la arquitectura de hardware interactiva de LOOI con pantalla OLED y física de mirada en tiempo real.
              </p>
              <p className="leading-relaxed text-white/70">
                Está diseñado para operar en horizontal (pantalla de escritorio tipo quiosco) o vertical (teléfono móvil), integrando seguimiento facial por cámara, reconocimiento de voz bidireccional y procesamiento en la nube con modelos de lenguaje.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-1">
                <span className="text-[#00FFA3] font-bold flex items-center gap-1.5">
                  <Camera className="w-4 h-4" />
                  Seguimiento con los Ojos
                </span>
                <p className="text-[11px] text-white/70">
                  Al encender la cámara, Ultron detecta tu rostro y sus ojos te siguen de forma suave y continua mientras te mueves frente a la pantalla.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-1">
                <span className="text-purple-300 font-bold flex items-center gap-1.5">
                  <Mic className="w-4 h-4" />
                  Voz Bidireccional
                </span>
                <p className="text-[11px] text-white/70">
                  Puedes hablarle activando el micrófono o con doble toque en la pantalla. Responde con voz neural en español y análisis ejecutivo.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Buttons Guide */}
        {activeTab === 'buttons' && (
          <div className="space-y-2.5 font-mono text-xs">
            <p className="text-white/60 text-[11px]">
              A continuación se detalla la función de cada botón de la interfaz:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[50vh] overflow-y-auto pr-1">
              {/* Reset / Normalizar */}
              <div className="p-3 rounded-lg bg-black/60 border border-emerald-400/30 space-y-1">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-[11px]">
                  <RotateCcw className="w-4 h-4" />
                  NORMALIZAR / RESET
                </div>
                <p className="text-[11px] text-white/70">
                  Restaura instantáneamente a Ultron a su estado normal (IDLE), repliega cualquier sistema temporal, detiene audios atascados y desactiva el modo de defensa.
                </p>
              </div>

              {/* Cámara */}
              <div className="p-3 rounded-lg bg-black/60 border border-[#05E1FF]/30 space-y-1">
                <div className="flex items-center gap-2 text-[#05E1FF] font-bold text-[11px]">
                  <Camera className="w-4 h-4" />
                  CÁMARA / SEGUIMIENTO
                </div>
                <p className="text-[11px] text-white/70">
                  Activa o desactiva la cámara web. Muestra tu video en vivo en una ventana espejo en la esquina y activa el seguimiento de mirada en tiempo real.
                </p>
              </div>

              {/* Micrófono */}
              <div className="p-3 rounded-lg bg-black/60 border border-purple-400/30 space-y-1">
                <div className="flex items-center gap-2 text-purple-300 font-bold text-[11px]">
                  <Mic className="w-4 h-4" />
                  MICRÓFONO
                </div>
                <p className="text-[11px] text-white/70">
                  Permite a Ultron escuchar tus órdenes por voz. Puedes pedirle informes, análisis de la junta directiva, tomar fotos o consultar temas.
                </p>
              </div>

              {/* Altavoz / Sonidos */}
              <div className="p-3 rounded-lg bg-black/60 border border-white/20 space-y-1">
                <div className="flex items-center gap-2 text-white font-bold text-[11px]">
                  <Volume2 className="w-4 h-4" />
                  ALTAVOZ / EFECTOS FX
                </div>
                <p className="text-[11px] text-white/70">
                  Habilita o silencia las respuestas habladas y los efectos de sonido robóticos futuristas.
                </p>
              </div>

              {/* Gafas de Sol */}
              <div className="p-3 rounded-lg bg-black/60 border border-cyan-400/30 space-y-1">
                <div className="flex items-center gap-2 text-cyan-300 font-bold text-[11px]">
                  <Glasses className="w-4 h-4" />
                  GAFAS CIBERNÉTICAS
                </div>
                <p className="text-[11px] text-white/70">
                  Coloca o retira las gafas oscuras de alta tecnología en los ojos de Ultron para una apariencia ejecutiva.
                </p>
              </div>

              {/* Modos */}
              <div className="p-3 rounded-lg bg-black/60 border border-amber-400/30 space-y-1">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-[11px]">
                  <Shield className="w-4 h-4" />
                  MODOS DE INTELIGENCIA
                </div>
                <p className="text-[11px] text-white/70">
                  Alterna la postura analítica de Ultron entre GUARDIAN (defensa corporativa), GOLD (tesorería), STRATEGIC, CREATIVE y EXPLORER.
                </p>
              </div>

              {/* Bóveda */}
              <div className="p-3 rounded-lg bg-black/60 border border-indigo-400/30 space-y-1">
                <div className="flex items-center gap-2 text-indigo-300 font-bold text-[11px]">
                  <Lock className="w-4 h-4" />
                  BÓVEDA CENTRAL
                </div>
                <p className="text-[11px] text-white/70">
                  Acceso institucional protegido a credenciales seguras, configuración de voces neurales de ElevenLabs y llaves de acceso.
                </p>
              </div>

              {/* Dock / Cajón de Comandos */}
              <div className="p-3 rounded-lg bg-black/60 border border-[#05E1FF]/30 space-y-1">
                <div className="flex items-center gap-2 text-[#05E1FF] font-bold text-[11px]">
                  <Layers className="w-4 h-4" />
                  CAJÓN DE COMANDOS (DOCK)
                </div>
                <p className="text-[11px] text-white/70">
                  Panel deslizable desde la parte inferior con acceso rápido a captura fotográfica, selector de expresiones faciales y herramientas adicionales.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Camera and Tracking */}
        {activeTab === 'camera' && (
          <div className="space-y-3 font-mono text-xs text-white/80">
            <div className="p-4 rounded-xl bg-black/60 border border-[#05E1FF]/30 space-y-2">
              <h3 className="text-sm font-bold text-[#05E1FF] flex items-center gap-2">
                <Camera className="w-4 h-4" />
                Cómo Funciona el Sensor Óptico
              </h3>
              <p className="leading-relaxed">
                Cuando enciendes el botón <span className="text-[#05E1FF] font-bold">CÁMARA</span> en la barra superior o en el dock:
              </p>
              <ul className="list-disc list-inside space-y-1.5 text-[11px] text-white/70 pl-1">
                <li>
                  <strong className="text-white">Ventana Espejo:</strong> En la esquina inferior derecha aparece una ventana con tu video en vivo para que puedas verte y comprobar el encuadre.
                </li>
                <li>
                  <strong className="text-white">Seguimiento de Cabeza y Mirada:</strong> El algoritmo de visión detecta tu posición en tiempo real. Si te mueves a la izquierda, a la derecha o hacia arriba, los ojos de Ultron te acompañan de manera natural.
                </li>
                <li>
                  <strong className="text-white">Detección de Gestos:</strong> Saludar con la mano activa un saludo de cortesía de Ultron.
                </li>
                <li>
                  <strong className="text-white">Privacidad Garantizada:</strong> El análisis óptico se realiza localmente en tu navegador sin almacenar video en servidores.
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Tab 4: Touch Interaction */}
        {activeTab === 'touch' && (
          <div className="space-y-3 font-mono text-xs text-white/80">
            <div className="p-4 rounded-xl bg-black/60 border border-amber-400/30 space-y-2">
              <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                <Hand className="w-4 h-4" />
                Interacciones Táctiles con la Pantalla
              </h3>
              <p className="leading-relaxed">
                Al tocar la pantalla OLED de Ultron se activan diferentes reacciones físicas:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2">
                <div className="p-2.5 rounded-lg bg-black/40 border border-white/10">
                  <span className="text-emerald-400 font-bold block text-[11px]">1 Toque (Toque Simple)</span>
                  <span className="text-white/70 text-[11px]">Parpadeo amigable y pulso de mirada.</span>
                </div>
                <div className="p-2.5 rounded-lg bg-black/40 border border-white/10">
                  <span className="text-[#05E1FF] font-bold block text-[11px]">2 Toques (Doble Toque)</span>
                  <span className="text-white/70 text-[11px]">Activa el micrófono para escuchar tu orden de inmediato.</span>
                </div>
                <div className="p-2.5 rounded-lg bg-black/40 border border-white/10">
                  <span className="text-pink-400 font-bold block text-[11px]">Deslizar / Acariciar</span>
                  <span className="text-white/70 text-[11px]">Modo ronroneo (PURR) con vibración suave de agrado.</span>
                </div>
                <div className="p-2.5 rounded-lg bg-black/40 border border-white/10">
                  <span className="text-cyan-400 font-bold block text-[11px]">Tocar un Ojo</span>
                  <span className="text-white/70 text-[11px]">Guiño interactivo en el ojo presionado.</span>
                </div>
              </div>
              <p className="text-[10px] text-white/50 pt-2 border-t border-white/10">
                Nota: Se ha desactivado cualquier reacción de furia o armas automáticas por toques repetidos. Si en algún momento deseas volver a la expresión normal, presiona el botón <strong className="text-emerald-400">Normalizar</strong>.
              </p>
            </div>
          </div>
        )}

        {/* Tab 5: Voice and AI */}
        {activeTab === 'voice' && (
          <div className="space-y-3 font-mono text-xs text-white/80">
            <div className="p-4 rounded-xl bg-black/60 border border-purple-400/30 space-y-2">
              <h3 className="text-sm font-bold text-purple-300 flex items-center gap-2">
                <Mic className="w-4 h-4" />
                Comandos de Voz e Inteligencia Qwen 27B
              </h3>
              <p className="leading-relaxed">
                Ultron procesa tus preguntas a través de su núcleo neuronal de lenguaje en el backend y te responde con voz sintetizada.
              </p>
              <div className="space-y-1.5 text-[11px] text-white/70">
                <p className="text-white font-bold">Ejemplos de frases que puedes decirle:</p>
                <div className="p-2 rounded bg-black/40 border border-white/10">
                  «Hola Ultron, dame un resumen de estado de la corporación.»
                </div>
                <div className="p-2 rounded bg-black/40 border border-white/10">
                  «Toma una foto con conteo regresivo.»
                </div>
                <div className="p-2 rounded bg-black/40 border border-white/10">
                  «Cambia a modo Gold / Guardián.»
                </div>
                <div className="p-2 rounded bg-black/40 border border-white/10">
                  «Ponte las gafas oscuras.»
                </div>
                <div className="p-2 rounded bg-black/40 border border-white/10">
                  «¿Cuál es la estrategia de tesorería del directorio?»
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-white/10 text-[11px] font-mono">
          <span className="text-[#8FA3B0]">
            LOOI Desktop Agent · Versión 3.8
          </span>
          <button
            type="button"
            onClick={() => {
              playSfx('tap', soundFxEnabled);
              onClose();
            }}
            className="px-4 py-1.5 rounded-lg bg-[#05E1FF]/20 border border-[#05E1FF]/40 text-[#05E1FF] font-bold hover:bg-[#05E1FF]/30 transition-colors cursor-pointer"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
