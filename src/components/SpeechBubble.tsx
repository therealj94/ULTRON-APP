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
  hint = 'Di «hey Ultron» o toca el mic',
  onExpand,
  compact = true,
}) => {
  if (!visible || !text) return null;

  const display =
    compact && text.length > 160 ? `${text.slice(0, 157).trim()}…` : text;

  return (
    <div className="pointer-events-auto absolute bottom-[14%] right-[96px] z-20 max-w-[min(40vw,340px)]">
      <button
        type="button"
        onClick={onExpand}
        className="w-full rounded-3xl border border-white/10 bg-[#121820]/88 p-3.5 text-left shadow-2xl backdrop-blur-md transition hover:border-[#3EC9D6]/35"
      >
        <div className="mb-1 text-base leading-none text-[#3EC9D6]/70">“</div>
        <p className="font-body text-[14px] leading-relaxed text-[#E8EEF4]">{display}</p>
        {hint && <p className="mt-2 text-[10px] text-[#8B9AAB]">{hint}</p>}
      </button>
    </div>
  );
};
