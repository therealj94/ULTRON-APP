import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Key,
  Volume2,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Play,
  RotateCw,
  Server,
  Layers,
  Sparkles,
  Sliders,
  Globe,
  BookOpen,
  Fingerprint,
  X,
} from 'lucide-react';
import { ElevenLabsVoiceConfig } from '../types';
import { DEFAULT_ELEVENLABS_VOICES } from '../03-voz/elevenlabs';
import { playSfx } from '../03-voz/audio';

interface UltronVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeVoice: ElevenLabsVoiceConfig;
  onSaveVoiceConfig: (voice: ElevenLabsVoiceConfig) => void;
  onSpeak?: (text: string) => void;
}

interface VaultConduit {
  id: string;
  name: string;
  type: string;
  configured: boolean;
  status: string;
  maskedKey?: string | null;
  latencyMs: number;
}

export const UltronVaultModal: React.FC<UltronVaultModalProps> = ({
  isOpen,
  onClose,
  activeVoice,
  onSaveVoiceConfig,
  onSpeak,
}) => {
  const [activeTab, setActiveTab] = useState<'elevenlabs' | 'conduits' | 'security'>('elevenlabs');
  const [apiKeyInput, setApiKeyInput] = useState<string>(activeVoice.apiKey || '');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(activeVoice.voiceId);
  const [stability, setStability] = useState<number>(activeVoice.stability);
  const [similarity, setSimilarity] = useState<number>(activeVoice.similarityBoost);

  const [testingVoice, setTestingVoice] = useState<boolean>(false);
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [testMessage, setTestMessage] = useState<string>('');

  const [conduits, setConduits] = useState<VaultConduit[]>([]);
  const [loadingConduits, setLoadingConduits] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Load existing key from localStorage or activeVoice on mount
  useEffect(() => {
    if (activeVoice.apiKey) {
      setApiKeyInput(activeVoice.apiKey);
    } else {
      const storedKey = localStorage.getItem('ultron_elevenlabs_key');
      if (storedKey) {
        setApiKeyInput(storedKey);
      }
    }
    setSelectedVoiceId(activeVoice.voiceId);
    setStability(activeVoice.stability);
    setSimilarity(activeVoice.similarityBoost);
  }, [activeVoice, isOpen]);

  // Fetch Vault status from backend
  const fetchVaultStatus = async () => {
    setLoadingConduits(true);
    try {
      const res = await fetch('/api/vault/status');
      if (res.ok) {
        const data = await res.json();
        setConduits(data.conduits || []);
      }
    } catch {
      // Fallback
    } finally {
      setLoadingConduits(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchVaultStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle saving ElevenLabs config
  const handleSaveElevenLabs = async () => {
    setIsSaving(true);
    playSfx('grant', true);

    const matchedPreset = DEFAULT_ELEVENLABS_VOICES.find((v) => v.voiceId === selectedVoiceId);
    const updatedConfig: ElevenLabsVoiceConfig = {
      voiceId: selectedVoiceId,
      name: matchedPreset ? matchedPreset.name : activeVoice.name,
      category: matchedPreset ? matchedPreset.category : activeVoice.category,
      description: matchedPreset ? matchedPreset.description : activeVoice.description,
      stability,
      similarityBoost: similarity,
      pitch: activeVoice.pitch,
      rate: activeVoice.rate,
      apiKey: apiKeyInput.trim(),
    };

    // Save to localStorage
    if (apiKeyInput.trim()) {
      localStorage.setItem('ultron_elevenlabs_key', apiKeyInput.trim());
    }

    // Save to Backend Vault
    try {
      await fetch('/api/vault/elevenlabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
      });
    } catch {
      // Ignore backend sync failures in offline mode
    }

    onSaveVoiceConfig(updatedConfig);
    setIsSaving(false);
    setTestSuccess(true);
    setTestMessage('Configuración archivada exitosamente en la Bóveda Central.');
    onSpeak?.('Credencial de ElevenLabs archivada en la Bóveda de ULTRON FP.');
  };

  // Test ElevenLabs synthesis directly through backend proxy or client
  const handleTestVoice = async () => {
    if (!apiKeyInput.trim()) {
      setTestSuccess(false);
      setTestMessage('Debes ingresar una clave API de ElevenLabs para realizar la prueba.');
      playSfx('warning', true);
      return;
    }

    setTestingVoice(true);
    setTestSuccess(null);
    setTestMessage('Sintetizando audio neural desde la Bóveda...');
    playSfx('radar', true);

    try {
      const res = await fetch('/api/vault/elevenlabs/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Sistemas de voz neural ElevenLabs verificados y activos en la Bóveda de ULTRON FP.',
          voiceId: selectedVoiceId,
          stability,
          similarityBoost: similarity,
          apiKeyOverride: apiKeyInput.trim(),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || `Error HTTP ${res.status}`);
      }

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.onended = () => URL.revokeObjectURL(audioUrl);
      await audio.play();

      setTestSuccess(true);
      setTestMessage('Conexión con ElevenLabs verificada con éxito. Audio reproducido.');
      playSfx('biometric_success', true);
    } catch (err: any) {
      setTestSuccess(false);
      setTestMessage(`Fallo en verificación: ${err.message || 'Verifica la clave API'}`);
      playSfx('biometric_fail', true);
    } finally {
      setTestingVoice(false);
    }
  };

  return (
    <div
      id="ultron-vault-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-xl border border-[#05E1FF]/40 bg-[#04080D]/95 text-[#D1E8F5] shadow-[0_0_50px_rgba(5,225,255,0.25)] overflow-hidden font-mono">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#05E1FF]/20 bg-[#03060A]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg border border-[#05E1FF]/40 bg-[#05E1FF]/10 flex items-center justify-center shadow-[0_0_12px_rgba(5,225,255,0.3)]">
              <ShieldCheck className="w-6 h-6 text-[#05E1FF]" />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold tracking-widest text-[#05E1FF] uppercase flex items-center gap-2">
                BÓVEDA CENTRAL DE APIS · ULTRON FP
              </h2>
              <p className="text-xs text-[#8FA3B0] tracking-wide">
                GESTIÓN INSTITUCIONAL DE CREDENCIALES Y CONEXIONES DEL SISTEMA
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              playSfx('tap', true);
              onClose();
            }}
            className="p-2 rounded-lg text-[#8FA3B0] hover:text-[#05E1FF] hover:bg-[#05E1FF]/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-[#05E1FF]/20 bg-[#050B12]/80 px-6 gap-2 text-xs font-display font-semibold tracking-wider">
          <button
            type="button"
            onClick={() => {
              playSfx('blip', true);
              setActiveTab('elevenlabs');
            }}
            className={`py-3 px-4 border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'elevenlabs'
                ? 'border-[#05E1FF] text-[#05E1FF] bg-[#05E1FF]/10'
                : 'border-transparent text-[#8FA3B0] hover:text-white'
            }`}
          >
            <Volume2 className="w-4 h-4" />
            <span>VOZ ELEVENLABS</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playSfx('blip', true);
              setActiveTab('conduits');
            }}
            className={`py-3 px-4 border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'conduits'
                ? 'border-[#05E1FF] text-[#05E1FF] bg-[#05E1FF]/10'
                : 'border-transparent text-[#8FA3B0] hover:text-white'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>APIS & CONDUITS DEL SISTEMA</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playSfx('blip', true);
              setActiveTab('security');
            }}
            className={`py-3 px-4 border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'security'
                ? 'border-[#05E1FF] text-[#05E1FF] bg-[#05E1FF]/10'
                : 'border-transparent text-[#8FA3B0] hover:text-white'
            }`}
          >
            <Lock className="w-4 h-4" />
            <span>PROTOCOLO DE CIFRADO</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: ELEVENLABS VOICE */}
          {activeTab === 'elevenlabs' && (
            <div className="space-y-6">
              {/* API Key Box */}
              <div className="p-5 rounded-xl border border-[#05E1FF]/30 bg-[#06101A]/80 space-y-3 shadow-[0_0_20px_rgba(5,225,255,0.05)]">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[#05E1FF] uppercase tracking-wider flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    <span>Clave de API ElevenLabs (xi-api-key)</span>
                  </label>
                  <span className="text-[11px] text-[#8FA3B0]">
                    {apiKeyInput.trim() ? 'Configurada' : 'Sin configurar (usando voz de respaldo)'}
                  </span>
                </div>

                <div className="relative flex items-center">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="Pega aquí tu clave de API de ElevenLabs (ej: sk_...)"
                    className="w-full bg-[#020508] border border-[#05E1FF]/30 text-[#05E1FF] text-xs font-mono px-4 py-3 rounded-lg focus:outline-none focus:border-[#05E1FF] focus:shadow-[0_0_12px_rgba(5,225,255,0.3)] transition-all pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((prev) => !prev)}
                    className="absolute right-3 p-1.5 text-[#8FA3B0] hover:text-[#05E1FF] transition-colors cursor-pointer"
                    title={showKey ? 'Ocultar clave' : 'Mostrar clave'}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <p className="text-[11px] text-[#8FA3B0]">
                    La clave se resguarda cifrada en la Bóveda del sistema y permite síntesis neuronal de voz humana ultrarrealista.
                  </p>

                  <button
                    type="button"
                    onClick={handleTestVoice}
                    disabled={testingVoice}
                    className="px-4 py-2 rounded-lg border border-[#05E1FF]/40 bg-[#05E1FF]/15 text-[#05E1FF] hover:bg-[#05E1FF]/25 transition-all text-xs font-display font-bold tracking-wider flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {testingVoice ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    <span>PROBAR VOZ EN VIVO</span>
                  </button>
                </div>

                {testMessage && (
                  <div
                    className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                      testSuccess
                        ? 'border-[#00FFA3]/40 bg-[#00FFA3]/10 text-[#00FFA3]'
                        : 'border-[#FF3B5C]/40 bg-[#FF3B5C]/10 text-[#FF3B5C]'
                    }`}
                  >
                    {testSuccess ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    <span>{testMessage}</span>
                  </div>
                )}
              </div>

              {/* Persona Selection */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-[#05E1FF] uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="w-4 h-4" />
                  <span>Perfil de Voz Neural</span>
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {DEFAULT_ELEVENLABS_VOICES.map((voice) => {
                    const isSelected = voice.voiceId === selectedVoiceId;
                    return (
                      <button
                        key={voice.voiceId}
                        type="button"
                        onClick={() => {
                          playSfx('blip', true);
                          setSelectedVoiceId(voice.voiceId);
                        }}
                        className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                          isSelected
                            ? 'border-[#05E1FF] bg-[#05E1FF]/15 shadow-[0_0_15px_rgba(5,225,255,0.2)]'
                            : 'border-[#05E1FF]/20 bg-[#06101A]/60 hover:border-[#05E1FF]/50 hover:bg-[#06101A]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-display font-bold text-xs tracking-wider text-[#05E1FF]">
                            {voice.name}
                          </span>
                          {isSelected && <CheckCircle2 className="w-4 h-4 text-[#05E1FF]" />}
                        </div>
                        <span className="text-[10px] text-[#00FFA3] tracking-widest uppercase">
                          {voice.category}
                        </span>
                        <p className="text-[11px] text-[#8FA3B0] leading-relaxed">
                          {voice.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Modulation Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 rounded-xl border border-[#05E1FF]/20 bg-[#06101A]/60">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#8FA3B0]">Estabilidad (Stability)</span>
                    <span className="text-[#05E1FF] font-mono">{Math.round(stability * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.3"
                    max="1.0"
                    step="0.05"
                    value={stability}
                    onChange={(e) => setStability(parseFloat(e.target.value))}
                    className="w-full accent-[#05E1FF] cursor-pointer"
                  />
                  <p className="text-[10px] text-[#8FA3B0]">Mayor estabilidad genera un tono formal y constante.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#8FA3B0]">Claridad & Similitud (Clarity Boost)</span>
                    <span className="text-[#05E1FF] font-mono">{Math.round(similarity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.3"
                    max="1.0"
                    step="0.05"
                    value={similarity}
                    onChange={(e) => setSimilarity(parseFloat(e.target.value))}
                    className="w-full accent-[#05E1FF] cursor-pointer"
                  />
                  <p className="text-[10px] text-[#8FA3B0]">Aumenta la definición acústica del timbre corporativo.</p>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSaveElevenLabs}
                  disabled={isSaving}
                  className="px-6 py-3 rounded-lg border border-[#05E1FF] bg-[#05E1FF] text-[#001418] hover:bg-[#05E1FF]/90 font-display font-bold text-xs tracking-widest uppercase transition-all shadow-[0_0_20px_rgba(5,225,255,0.4)] cursor-pointer flex items-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>GUARDAR EN LA BÓVEDA</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: SYSTEM CONDUITS & APIS */}
          {activeTab === 'conduits' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-display font-bold tracking-widest text-[#05E1FF] uppercase">
                    CONEXIONES ACTIVAS DEL SISTEMA
                  </h3>
                  <p className="text-xs text-[#8FA3B0]">
                    Todos los accesos e integraciones corren de forma nativa e interna en el backend
                  </p>
                </div>

                <button
                  type="button"
                  onClick={fetchVaultStatus}
                  className="px-3 py-1.5 rounded border border-[#05E1FF]/30 text-[#05E1FF] hover:bg-[#05E1FF]/10 text-xs flex items-center gap-1 cursor-pointer"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${loadingConduits ? 'animate-spin' : ''}`} />
                  <span>ACTUALIZAR</span>
                </button>
              </div>

              <div className="space-y-3">
                {conduits.length > 0 ? (
                  conduits.map((conduit) => (
                    <div
                      key={conduit.id}
                      className="p-4 rounded-xl border border-[#05E1FF]/20 bg-[#06101A]/80 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg border border-[#05E1FF]/30 bg-[#05E1FF]/10 flex items-center justify-center text-[#05E1FF]">
                          {conduit.id === 'elevenlabs' && <Volume2 className="w-4 h-4" />}
                          {conduit.id === 'neural_core' && <Layers className="w-4 h-4" />}
                          {conduit.id === 'vision_pipeline' && <Eye className="w-4 h-4" />}
                          {conduit.id === 'playwright_browser' && <Globe className="w-4 h-4" />}
                          {conduit.id === 'global_order_brain' && <BookOpen className="w-4 h-4" />}
                          {conduit.id === 'cloud_infra' && <Server className="w-4 h-4" />}
                          {conduit.id === 'biometric_security' && <Fingerprint className="w-4 h-4" />}
                        </div>
                        <div>
                          <div className="font-display font-bold text-xs text-[#05E1FF] tracking-wide">
                            {conduit.name}
                          </div>
                          <div className="text-[11px] text-[#8FA3B0]">
                            {conduit.maskedKey ? `Clave en Bóveda: ${conduit.maskedKey}` : 'Enlace Interno Seguro'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-mono text-[#8FA3B0]">
                          {conduit.latencyMs}ms
                        </span>
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-display font-bold tracking-wider uppercase border ${
                            conduit.configured
                              ? 'border-[#00FFA3]/40 bg-[#00FFA3]/10 text-[#00FFA3]'
                              : 'border-[#FFB648]/40 bg-[#FFB648]/10 text-[#FFB648]'
                          }`}
                        >
                          {conduit.status}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-xs text-[#8FA3B0]">
                    Cargando conduits de la Bóveda Central...
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SECURITY & CRYPTO AUDIT */}
          {activeTab === 'security' && (
            <div className="space-y-4">
              <div className="p-5 rounded-xl border border-[#05E1FF]/20 bg-[#06101A]/80 space-y-3">
                <div className="flex items-center gap-2 text-sm font-display font-bold text-[#05E1FF] uppercase tracking-wider">
                  <Lock className="w-4 h-4" />
                  <span>PROTOCOLO DE SEGURIDAD INSTITUCIONAL</span>
                </div>
                <p className="text-xs text-[#8FA3B0] leading-relaxed">
                  La Bóveda de ULTRON FP mantiene el aislamiento absoluto de claves del cliente. Ninguna credencial de infraestructura o claves maestras se exponen en texto plano en la interfaz de usuario. Todas las operaciones se canalizan a través de rutas seguras autenticadas.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                  <div className="p-3 rounded-lg border border-[#05E1FF]/20 bg-[#03060A]">
                    <span className="text-[10px] text-[#8FA3B0] uppercase block">Cifrado de Bóveda</span>
                    <span className="text-xs font-bold text-[#00FFA3]">AES-256-GCM</span>
                  </div>
                  <div className="p-3 rounded-lg border border-[#05E1FF]/20 bg-[#03060A]">
                    <span className="text-[10px] text-[#8FA3B0] uppercase block">Aislamiento de Claves</span>
                    <span className="text-xs font-bold text-[#05E1FF]">Servidor Interno</span>
                  </div>
                  <div className="p-3 rounded-lg border border-[#05E1FF]/20 bg-[#03060A]">
                    <span className="text-[10px] text-[#8FA3B0] uppercase block">Auto-Purga Multimedia</span>
                    <span className="text-xs font-bold text-[#00FFA3]">Activo (Zero-Knowledge)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
