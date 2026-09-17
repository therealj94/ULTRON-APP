import React, { useState } from 'react';
import {
  Globe,
  Search,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  X,
  Volume2,
  FileText,
  Terminal,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react';
import { playSfx } from '../utils/audio';

interface PlaywrightBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialUrl?: string;
  onSpeakSummary?: (text: string) => void;
  soundFxEnabled?: boolean;
}

export const PlaywrightBrowserModal: React.FC<PlaywrightBrowserModalProps> = ({
  isOpen,
  onClose,
  initialUrl = 'https://news.ycombinator.com',
  onSpeakSummary,
  soundFxEnabled = true,
}) => {
  const [urlInput, setUrlInput] = useState<string>(initialUrl);
  const [activeUrl, setActiveUrl] = useState<string>(initialUrl);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [pageData, setPageData] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Suggested executive bookmarks
  const QUICK_LINKS = [
    { name: 'GitHub Enterprise', url: 'https://github.com' },
    { name: 'AWS Cloud Console', url: 'https://aws.amazon.com' },
    { name: 'Hacker News Tech', url: 'https://news.ycombinator.com' },
    { name: 'SEC EDGAR Filings', url: 'https://www.sec.gov' },
    { name: 'Reuters Global Markets', url: 'https://www.reuters.com' },
  ];

  if (!isOpen) return null;

  // Execute Playwright page inspection via AWS node
  const handleInspect = async (targetUrl: string = urlInput) => {
    let cleanUrl = targetUrl.trim();
    if (!cleanUrl) return;
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = `https://${cleanUrl}`;
    }

    setUrlInput(cleanUrl);
    setActiveUrl(cleanUrl);
    setIsLoading(true);
    setErrorMessage(null);
    playSfx('radar', soundFxEnabled);

    try {
      const res = await fetch('/api/playwright/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl, extractDepth: 'deep' }),
      });

      if (!res.ok) {
        throw new Error(`Error HTTP ${res.status} al consultar el nodo Playwright en AWS`);
      }

      const data = await res.json();
      setPageData(data);
      playSfx('grant', soundFxEnabled);

      if (onSpeakSummary && data.findings?.[0]) {
        onSpeakSummary(
          `Inspección completada para ${data.title}. Código de estado HTTP ${data.status}. Resumen disponible en pantalla.`
        );
      }
    } catch (err: any) {
      console.error('Playwright scrape error:', err);
      setErrorMessage(err.message || 'No se pudo contactar el nodo Playwright');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyText = () => {
    if (!pageData?.sampleText) return;
    navigator.clipboard.writeText(pageData.sampleText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      id="playwright-browser-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-4xl bg-[#0b1017] border border-[#05E1FF]/40 rounded-2xl overflow-hidden shadow-2xl shadow-[#05E1FF]/20 flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#060a0f]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#05E1FF]/15 border border-[#05E1FF]/40 flex items-center justify-center text-[#05E1FF]">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-white font-mono font-bold text-base tracking-wide flex items-center gap-2">
                PLAYWRIGHT AWS NODE · INSPECTOR WEB
                <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-[#05E1FF]/20 text-[#05E1FF] border border-[#05E1FF]/40">
                  HEADLESS CHROMIUM
                </span>
              </h3>
              <p className="text-xs text-white/50 font-mono">
                Navegación remota e indexación semántica en clúster AWS EC2
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

        {/* Address Bar & Quick Bookmarks */}
        <div className="p-4 bg-[#090d14] border-b border-white/10 space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleInspect();
            }}
            className="flex items-center gap-2"
          >
            <div className="flex-1 relative flex items-center">
              <div className="absolute left-3.5 text-white/40">
                <Globe className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Ingresa cualquier URL o dominio (ej: reuters.com)..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/50 border border-white/15 text-white font-mono text-xs focus:outline-none focus:border-[#05E1FF] transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#05E1FF] to-[#00FFA3] text-black font-mono font-bold text-xs flex items-center gap-2 shadow-lg shadow-[#05E1FF]/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <Search className="w-4 h-4" />
              <span>{isLoading ? 'Inspeccionando...' : 'Inspeccionar'}</span>
            </button>
          </form>

          {/* Quick Bookmarks */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-mono">
            <span className="text-white/40 text-[11px] whitespace-nowrap">Accesos Rápidos:</span>
            {QUICK_LINKS.map((item) => (
              <button
                key={item.url}
                onClick={() => {
                  setUrlInput(item.url);
                  handleInspect(item.url);
                }}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-[#05E1FF] whitespace-nowrap transition-colors"
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>

        {/* Viewport Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {isLoading ? (
            <div className="h-72 flex flex-col items-center justify-center space-y-4">
              <div className="w-12 h-12 rounded-full border-3 border-[#05E1FF] border-t-transparent animate-spin" />
              <div className="text-center font-mono">
                <p className="text-sm text-white font-bold">Despachando clúster Playwright en AWS...</p>
                <p className="text-xs text-[#05E1FF]/70">Cargando DOM completo, renderizando scripts y analizando metadatos</p>
              </div>
            </div>
          ) : errorMessage ? (
            <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 font-mono text-xs flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm mb-1">Error al inspeccionar página</p>
                <p>{errorMessage}</p>
              </div>
            </div>
          ) : pageData ? (
            <div className="space-y-4 font-mono">
              {/* Executive Summary Card */}
              <div className="p-4 rounded-xl bg-[#05E1FF]/10 border border-[#05E1FF]/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#05E1FF] font-bold flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#00FFA3]" />
                    INFORME EJECUTIVO DE NAVEGACIÓN
                  </span>
                  <span className="text-[11px] text-white/50">{pageData.inspectedAt}</span>
                </div>

                <h4 className="text-sm font-bold text-white leading-snug">
                  {pageData.title}
                </h4>

                <p className="text-xs text-white/80 leading-relaxed">
                  {pageData.description}
                </p>

                <div className="space-y-1.5 pt-2 border-t border-white/10">
                  {pageData.findings?.map((finding: string, idx: number) => (
                    <div key={idx} className="text-xs text-white/70 flex items-start gap-2">
                      <span className="text-[#05E1FF]">•</span>
                      <span>{finding}</span>
                    </div>
                  ))}
                </div>

                {onSpeakSummary && (
                  <button
                    onClick={() =>
                      onSpeakSummary(
                        `Informe de ${pageData.title}: ${pageData.description || 'Página inspeccionada con éxito.'}`
                      )
                    }
                    className="mt-2 px-3 py-1.5 rounded-lg bg-[#05E1FF]/15 hover:bg-[#05E1FF]/25 border border-[#05E1FF]/40 text-[#05E1FF] text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Escuchar Informe con Voz de Ultron</span>
                  </button>
                )}
              </div>

              {/* Extracted Content View */}
              <div className="p-4 rounded-xl bg-black/50 border border-white/10 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/60 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    TEXTO EXTRAÍDO DEL DOCUMENTO
                  </span>
                  <button
                    onClick={handleCopyText}
                    className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-white/70 flex items-center gap-1 transition-colors"
                  >
                    {copied ? <Check className="w-3 h-3 text-[#00FFA3]" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copiado' : 'Copiar Texto'}</span>
                  </button>
                </div>

                <div className="max-h-60 overflow-y-auto p-3 bg-black/80 rounded-lg text-xs text-white/80 leading-relaxed font-mono whitespace-pre-wrap select-all">
                  {pageData.sampleText || 'No se extrajo contenido textual relevante.'}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-center font-mono text-white/40">
              <Globe className="w-12 h-12 mb-3 text-white/20" />
              <p className="text-sm text-white/70">Listo para inspeccionar páginas web</p>
              <p className="text-xs">
                Ingresa una dirección URL arriba o selecciona uno de los accesos rápidos.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#060a0f] border-t border-white/10 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-white/50">
            <Cpu className="w-4 h-4 text-[#05E1FF]" />
            <span>Nodo: AWS EC2 Playwright Headless Worker</span>
          </div>

          <div className="flex items-center gap-3">
            {activeUrl && (
              <a
                href={activeUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Abrir en Nueva Pestaña</span>
              </a>
            )}

            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
