import { Box, FolderOpen, LayoutGrid, Users, Keyboard } from 'lucide-react';
import { useProjects } from '@/store/projectStore';

const NAV = [
  { label: 'Design', Icon: Box, view: 'editor' as const },
  { label: 'My Projects', Icon: FolderOpen, view: 'projects' as const },
  { label: 'Templates', Icon: LayoutGrid, soon: 'Coming soon' },
  { label: 'Community', Icon: Users, soon: 'Coming soon' },
];

export function TopBar({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const view = useProjects((s) => s.view);
  const setView = useProjects((s) => s.setView);
  return (
    <header className="flex h-14 shrink-0 items-center gap-6 bg-navy px-5 text-white">
      <a href="/" className="flex items-center" aria-label="Modellio home">
        <img src="/logo-light.png" alt="modellio" className="h-[26px] w-auto" draggable={false} />
      </a>
      <nav className="flex items-center gap-1" aria-label="Main">
        {NAV.map(({ label, Icon, view: target, soon }) => {
          const active = target === view;
          return (
            <button
              key={label}
              type="button"
              onClick={() => target && setView(target)}
              disabled={!target}
              title={soon}
              aria-current={active ? 'page' : undefined}
              className={`flex h-9 items-center gap-2 rounded-lg px-3.5 text-[14px] font-medium transition-colors ${
                active ? 'bg-brand text-white shadow-sm' : target ? 'text-white/80 hover:bg-white/10' : 'text-white/40'
              } disabled:cursor-default`}
            >
              <Icon size={17} />
              {label}
            </button>
          );
        })}
      </nav>
      <div className="flex-1" />
      <span className="hidden text-[12px] font-medium tracking-wide text-white/45 lg:block">Make anything. Shape everything.</span>
      <button
        type="button"
        onClick={onShowShortcuts}
        className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-white/80 hover:bg-white/10"
        aria-label="Keyboard shortcuts"
      >
        <Keyboard size={17} />
        <span className="hidden md:inline">Shortcuts</span>
      </button>
    </header>
  );
}
