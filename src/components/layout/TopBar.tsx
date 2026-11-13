import { Box, FolderOpen, LayoutGrid, Users, Keyboard, CircleHelp, Compass } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { useTour } from '@/components/onboarding/Tour';
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
      <span className="hidden text-[12px] font-medium tracking-wide text-white/60 lg:block">Make anything. Shape everything.</span>
      <Popover
        align="right"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-haspopup="menu"
            className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-white/80 hover:bg-white/10"
          >
            <CircleHelp size={17} />
            <span className="hidden md:inline">Help</span>
          </button>
        )}
      >
        {(close) => (
          <div className="w-52" role="menu" aria-label="Help">
            {[
              { label: 'Take the tour', Icon: Compass, run: () => useTour.getState().start() },
              { label: 'Keyboard shortcuts', Icon: Keyboard, run: onShowShortcuts },
            ].map(({ label, Icon, run }) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  run();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-[#344054] hover:bg-brand-50 hover:text-brand"
              >
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </header>
  );
}
