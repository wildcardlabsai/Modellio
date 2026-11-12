import { Box, FolderOpen, LayoutGrid, Users, Keyboard } from 'lucide-react';

const NAV = [
  { label: 'Design', Icon: Box, active: true },
  { label: 'My Projects', Icon: FolderOpen, soon: 'Local projects arrive in Phase 4' },
  { label: 'Templates', Icon: LayoutGrid, soon: 'Coming soon' },
  { label: 'Community', Icon: Users, soon: 'Coming soon' },
];

export function TopBar({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-6 bg-navy px-5 text-white">
      <a href="/" className="flex items-center" aria-label="Modellio home">
        <img src="/logo-light.png" alt="modellio" className="h-[26px] w-auto" draggable={false} />
      </a>
      <nav className="flex items-center gap-1" aria-label="Main">
        {NAV.map(({ label, Icon, active, soon }) => (
          <button
            key={label}
            type="button"
            disabled={!active}
            title={soon}
            aria-current={active ? 'page' : undefined}
            className={`flex h-9 items-center gap-2 rounded-lg px-3.5 text-[14px] font-medium transition-colors ${
              active ? 'bg-brand text-white shadow-sm' : 'text-white/55 hover:bg-white/5'
            } disabled:cursor-default`}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
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
