import React from 'react';

interface SpeechBubbleProps {
  text: string;
  visible: boolean;
  hint?: string;
  onExpand?: () => void;
  compact?: boolean;
}

export const SpeechBubble: React.FC<SpeechBubbleProps> = ({
  text,
  visible,
  hint = 'Toca para leer completo o pedir resumen',
  onExpand,
  compact = true,
}) => {
  if (!visible || !text) return null;

  const display =
    compact && text.length > 180 ? `${text.slice(0, 177).trim()}…` : text;

  return (
    <div className="pointer-events-auto absolute right-[96px] top-1/2 z-20 max-w-[min(42vw,380px)] -translate-y-1/2">
      <button
        type="button"
        onClick={onExpand}
        className="w-full rounded-3xl border border-white/10 bg-[#121820]/88 p-4 text-left shadow-2xl backdrop-blur-md transition hover:border-[#3EC9D6]/35"
      >
        <div className="mb-2 text-lg leading-none text-[#3EC9D6]/70">“</div>
        <p className="font-body text-[15px] leading-relaxed text-[#E8EEF4]">{display}</p>
        {hint && (
          <p className="mt-3 text-[11px] text-[#8B9AAB]">
            {text.length > 180 ? hint : 'ULTRON · voz ElevenLabs'}
          </p>
        )}
      </button>
    </div>
  );
};
