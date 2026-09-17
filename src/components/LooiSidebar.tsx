import React, { useEffect, useState } from 'react';
import { Moon, LayoutGrid, Compass, CircleDot } from 'lucide-react';

export type DeskPresence = 'sleep' | 'stay' | 'explore';

interface LooiSidebarProps {
  presence: DeskPresence;
  onPresenceChange: (p: DeskPresence) => void;
  onOpenMenu: () => void;
  clock?: string;
}

export const LooiSidebar: React.FC<LooiSidebarProps> = ({
  presence,
  onPresenceChange,
  onOpenMenu,
  clock,
}) => {
  const [now, setNow] = useState(clock || '');

  useEffect(() => {
    if (clock) {
      setNow(clock);
      return;
    }
    const tick = () => {
      const d = new Date();
      setNow(
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      );
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [clock]);

  const item = (id: DeskPresence, label: string, icon: React.ReactNode) => {
    const on = presence === id;
    return (
      <button
        type="button"
        onClick={() => onPresenceChange(id)}
        className={`flex w-full flex-col items-center gap-1 rounded-2xl px-2 py-3 transition ${
          on ? 'bg-[#3EC9D6]/20 text-[#7AE4EF]' : 'text-[#8B9AAB] hover:bg-white/5 hover:text-[#E8EEF4]'
        }`}
      >
        <div className={`grid h-10 w-10 place-items-center rounded-xl ${on ? 'bg-[#3EC9D6]/25' : 'bg-transparent'}`}>
          {icon}
        </div>
        <span className="text-[10px] font-medium tracking-wide">{label}</span>
      </button>
    );
  };

  return (
    <aside className="pointer-events-auto absolute right-3 top-1/2 z-30 flex w-[72px] -translate-y-1/2 flex-col items-center gap-2 rounded-3xl border border-white/10 bg-[#0c1016]/80 py-3 backdrop-blur-xl">
      <div className="font-display text-sm font-semibold tracking-wider text-[#E8EEF4]">{now}</div>
      <div className="my-1 h-px w-8 bg-white/10" />
      {item('sleep', 'sleep', <Moon className="h-5 w-5" />)}
      {item('stay', 'stay', <CircleDot className="h-5 w-5" />)}
      {item('explore', 'explore', <Compass className="h-5 w-5" />)}
      <div className="my-1 h-px w-8 bg-white/10" />
      <button
        type="button"
        onClick={onOpenMenu}
        className="flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-[#8B9AAB] hover:bg-white/5 hover:text-[#E8EEF4]"
        title="Menú de herramientas"
      >
        <LayoutGrid className="h-5 w-5" />
      </button>
    </aside>
  );
};
