import React, { useState, useEffect } from 'react';
import {
  Globe2,
  Search,
  Shield,
  BookOpen,
  Volume2,
  Lock,
  Copy,
  Check,
  X,
  Compass,
  FileCheck,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { playSfx } from '../03-voz/audio';

interface GlobalOrderBrainModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSpeakDoctrine?: (text: string) => void;
  soundFxEnabled?: boolean;
}

interface Doctrine {
  id: string;
  category: string;
  title: string;
  code: string;
  summary: string;
  principles: string[];
  classificationLevel: string;
}

export const GlobalOrderBrainModal: React.FC<GlobalOrderBrainModalProps> = ({
  isOpen,
  onClose,
  onSpeakDoctrine,
  soundFxEnabled = true,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [doctrines, setDoctrines] = useState<Doctrine[]>([]);
  const [selectedDoctrine, setSelectedDoctrine] = useState<Doctrine | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('ALL');

  useEffect(() => {
    // Fetch doctrines from API or fallback to baseline
    fetch('/api/orden-global')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.doctrines) {
          setDoctrines(data.doctrines);
          setSelectedDoctrine(data.doctrines[0]);
        }
      })
      .catch(() => {
        // Fallback default set
        const defaultList: Doctrine[] = [
          {
            id: 'og_01',
            category: 'Geopolítica',
            title: 'Doctrina de Soberanía Tecnológica e Infraestructura Crítica',
            code: 'ALFA-770-GEO',
            summary:
              'Garantiza la autonomía de cómputo neural, nodos de inteligencia distribuida y redundancia transfronteriza sin subordinación a monopolios.',
            principles: [
              'Despliegue multi-región con failover autónomo en AWS, bare-metal y nodos locales.',
              'Cifrado post-cuántico en los canales de audio y telemetría de la mesa directiva.',
              'Preservación de la soberanía de datos y eliminación instantánea de telemetría biométrica tras su análisis.',
            ],
            classificationLevel: 'DIRECTORIO EJECUTIVO',
          },
          {
            id: 'og_02',
            category: 'Tesorería',
            title: 'Protocolo de Reserva Líquida y Arbitraje Multidivisa',
            code: 'BETA-912-FIN',
            summary:
              'Estrategia de cobertura patrimonial basada en activos tangibles (oro, tierras raras) y reservas sintéticas con calificación AAA.',
            principles: [
              'Diversificación continua de tesorería institucional ante fluctuaciones cambiarias.',
              'Modelos predictivos de alta precisión para anticipar shocks de liquidez en mercados emergentes.',
              'Auditoría criptográfica de estados financieros con doble firma de los directores.',
            ],
            classificationLevel: 'RESTRINGIDO - ALTA DIRECCIÓN',
          },
          {
            id: 'og_03',
            category: 'Gobernanza',
            title: 'Estatuto de Voto Blindado y Minutas Inmutables',
            code: 'GAMMA-404-GOB',
            summary:
              'Mecanismo de consenso para decisiones críticas de la junta directiva con sellado de tiempo y distribución autorizada.',
            principles: [
              'Requerimiento de autorización biométrica explícita para despacho de memorandos.',
              'Firma criptográfica en minutas ejecutivas previo a transmisión.',
              'Registro inmutable de cada orden verbal procesada por ULTRON.',
            ],
            classificationLevel: 'JUNTA DIRECTIVA PLENA',
          },
          {
            id: 'og_04',
            category: 'Defensa',
            title: 'Directriz de Contención Perimetral y Respuesta Activa',
            code: 'DELTA-108-DEF',
            summary:
              'Procedimientos de respuesta ante intrusiones, acoso físico o ciberamenazas contra la sede ejecutiva o terminales de mando.',
            principles: [
              'Despliegue de sistemas de disuasión y modo combate blaster en terminales tácticos.',
              'Aislamiento de sockets de red ante detección de anomalías.',
              'Revocación automática de tokens temporales de nube.',
            ],
            classificationLevel: 'SEGURIDAD CORPORATIVA',
          },
        ];
        setDoctrines(defaultList);
        setSelectedDoctrine(defaultList[0]);
      });
  }, []);

  if (!isOpen) return null;

  const categories = ['ALL', 'Geopolítica', 'Tesorería', 'Gobernanza', 'Defensa'];

  const filteredDoctrines = doctrines.filter((doc) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.summary.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCat = activeCategory === 'ALL' || doc.category.includes(activeCategory);
    return matchesSearch && matchesCat;
  });

  const handleCopy = (doc: Doctrine) => {
    const text = `[${doc.code}] ${doc.title}\nNivel: ${doc.classificationLevel}\nResumen: ${doc.summary}\nPrincipios:\n${doc.principles.map((p) => `- ${p}`).join('\n')}`;
    navigator.clipboard.writeText(text);
    setCopiedId(doc.id);
    playSfx('blip', soundFxEnabled);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSpeak = (doc: Doctrine) => {
    if (!onSpeakDoctrine) return;
    const utterance = `Doctrina de Orden Global, código ${doc.code}. ${doc.title}. ${doc.summary}`;
    onSpeakDoctrine(utterance);
    playSfx('grant', soundFxEnabled);
  };

  return (
    <div
      id="global-order-brain-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-4xl bg-[#0b1017] border border-[#F5C542]/40 rounded-2xl overflow-hidden shadow-2xl shadow-[#F5C542]/20 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#060a0f]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#F5C542]/15 border border-[#F5C542]/40 flex items-center justify-center text-[#F5C542]">
              <Globe2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-white font-mono font-bold text-base tracking-wide flex items-center gap-2">
                CEREBRO DE ORDEN GLOBAL · INTELIGENCIA ESTRATÉGICA
                <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-[#F5C542]/20 text-[#F5C542] border border-[#F5C542]/40 font-bold">
                  ALFA-1 ACCESO DIRECTO
                </span>
              </h3>
              <p className="text-xs text-white/50 font-mono">
                Doctrinas geopolíticas, directrices de tesorería y acuerdos corporativos soberanos
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Category Filter Bar */}
        <div className="p-4 bg-[#090d14] border-b border-white/10 space-y-3">
          <div className="relative flex items-center">
            <Search className="absolute left-3.5 text-white/40 w-4 h-4" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar directriz, código o palabra clave (ej: soberanía, tesorería, alianzas)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/50 border border-white/15 text-white font-mono text-xs focus:outline-none focus:border-[#F5C542] transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-mono">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1 rounded-lg border transition-all ${
                  activeCategory === cat
                    ? 'bg-[#F5C542]/20 border-[#F5C542] text-[#F5C542] font-bold'
                    : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
                }`}
              >
                {cat === 'ALL' ? 'Todas las Doctrinas' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Content Columns: List + Detail */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[380px]">
          {/* Left List */}
          <div className="md:col-span-5 border-r border-white/10 overflow-y-auto p-4 space-y-2.5 max-h-[480px]">
            {filteredDoctrines.map((doc) => {
              const isSelected = selectedDoctrine?.id === doc.id;
              return (
                <div
                  key={doc.id}
                  onClick={() => {
                    setSelectedDoctrine(doc);
                    playSfx('blip', soundFxEnabled);
                  }}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all font-mono ${
                    isSelected
                      ? 'bg-[#F5C542]/15 border-[#F5C542] text-white shadow-md shadow-[#F5C542]/10'
                      : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] text-[#F5C542] mb-1 font-bold">
                    <span>{doc.code}</span>
                    <span className="text-white/40">{doc.category}</span>
                  </div>
                  <h4 className="text-xs font-bold leading-snug text-white mb-1.5 line-clamp-2">
                    {doc.title}
                  </h4>
                  <p className="text-[11px] text-white/60 line-clamp-2 leading-relaxed">
                    {doc.summary}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Right Detail Pane */}
          <div className="md:col-span-7 p-6 overflow-y-auto max-h-[480px] space-y-4 font-mono">
            {selectedDoctrine ? (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-md bg-[#F5C542]/20 border border-[#F5C542]/40 text-[#F5C542] text-xs font-bold">
                      {selectedDoctrine.code}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-white/10 text-white/70 text-[11px]">
                      {selectedDoctrine.classificationLevel}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(selectedDoctrine)}
                      className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white text-xs flex items-center gap-1.5 transition-colors"
                    >
                      {copiedId === selectedDoctrine.id ? (
                        <Check className="w-3.5 h-3.5 text-[#00FFA3]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedId === selectedDoctrine.id ? 'Copiado' : 'Copiar'}</span>
                    </button>

                    {onSpeakDoctrine && (
                      <button
                        onClick={() => handleSpeak(selectedDoctrine)}
                        className="px-3 py-1.5 rounded-lg bg-[#F5C542]/20 hover:bg-[#F5C542]/30 border border-[#F5C542]/40 text-[#F5C542] text-xs font-bold flex items-center gap-1.5 transition-colors"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>Recitar con Ultron</span>
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-base font-bold text-white mb-2 leading-snug">
                    {selectedDoctrine.title}
                  </h3>
                  <p className="text-xs text-white/80 leading-relaxed bg-white/5 p-3.5 rounded-xl border border-white/10">
                    {selectedDoctrine.summary}
                  </p>
                </div>

                <div className="space-y-2 pt-1">
                  <span className="text-xs text-[#F5C542] font-bold flex items-center gap-1.5">
                    <FileCheck className="w-4 h-4" />
                    PRINCIPIOS Y MANDATOS OPERATIVOS:
                  </span>
                  <div className="space-y-2">
                    {selectedDoctrine.principles.map((principle, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2.5 p-3 rounded-xl bg-black/40 border border-white/5 text-xs text-white/85 leading-relaxed"
                      >
                        <span className="w-5 h-5 rounded-full bg-[#F5C542]/20 text-[#F5C542] flex items-center justify-center shrink-0 text-[10px] font-bold">
                          {idx + 1}
                        </span>
                        <span>{principle}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-white/40 text-xs">
                Selecciona una doctrina para inspeccionar su marco normativo.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#060a0f] border-t border-white/10 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-white/50">
            <Shield className="w-4 h-4 text-[#F5C542]" />
            <span>Cifrado y Certificado por el Consejo de Administración Alfa-1</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-colors"
          >
            Cerrar Portal
          </button>
        </div>
      </div>
    </div>
  );
};
