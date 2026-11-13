import {
  Box,
  FolderOpen,
  LayoutGrid,
  Users,
  Keyboard,
  CircleHelp,
  Compass,
  Scissors,
  Wand2,
  Cookie,
  ChevronDown,
  KeyRound,
  Signpost,
  Grid3x3,
  Package,
  Image,
  type LucideIcon,
} from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { AccountButton } from './AccountButton';
import { useTour } from '@/components/onboarding/Tour';
import { useProjects } from '@/store/projectStore';
import { useStudio, type StudioId } from '@/app/studio';

const NAV = [
  { label: 'Design', Icon: Box, view: 'editor' as const },
  { label: 'Split Studio', Icon: Scissors, studio: 'split' as const, hint: 'Split a multi-colour 3MF into parts' },
  { label: 'My Projects', Icon: FolderOpen, view: 'projects' as const },
  { label: 'Templates', Icon: LayoutGrid, view: 'templates' as const },
  { label: 'Community', Icon: Users, soon: 'Coming soon' },
];

/** Focused makers. Coming-soon entries are shown, labelled and disabled. */
export const MAKERS: { id: string; label: string; Icon: LucideIcon; studio?: StudioId }[] = [
  { id: 'cookie', label: 'Cookie Cutter & Stamp', Icon: Cookie, studio: 'cookie' },
  { id: 'keyring', label: 'Keyring Maker', Icon: KeyRound },
  { id: 'sign', label: 'Sign Maker', Icon: Signpost },
  { id: 'organiser', label: 'Organiser Generator', Icon: Grid3x3 },
  { id: 'box', label: 'Box & Lid Maker', Icon: Package },
  { id: 'lithophane', label: 'Lithophane Studio', Icon: Image },
];

function MakersMenu({ active, onOpen }: { active: boolean; onOpen: (s: StudioId) => void }) {
  return (
    <Popover
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Makers"
          aria-current={active ? 'page' : undefined}
          className={`flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-[14px] font-medium transition-colors lg:px-3 xl:px-3.5 ${
            active ? 'bg-brand text-white shadow-sm' : 'text-white/80 hover:bg-white/10'
          }`}
        >
          <Wand2 size={17} />
          <span className="hidden xl:inline">Makers</span>
          <ChevronDown size={14} className="hidden xl:inline" />
        </button>
      )}
    >
      {(close) => (
        <div className="w-60" role="menu" aria-label="Makers">
          {MAKERS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitem"
              disabled={!m.studio}
              onClick={() => {
                if (!m.studio) return;
                close();
                onOpen(m.studio);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-[#344054] hover:bg-brand-50 hover:text-brand disabled:cursor-default disabled:text-[#667085] disabled:hover:bg-transparent"
            >
              <m.Icon size={16} className={m.studio ? '' : 'opacity-40'} />
              <span className="flex-1">{m.label}</span>
              {!m.studio && <span className="text-[11px] font-normal">Soon</span>}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export function TopBar({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const view = useProjects((s) => s.view);
  const setView = useProjects((s) => s.setView);
  const studio = useStudio((s) => s.studio);
  const setStudio = useStudio((s) => s.setStudio);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 bg-navy px-3 text-white sm:gap-6 sm:px-5">
      <a
        href="/"
        className="flex items-center"
        aria-label="Modellio home"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          setStudio('home');
        }}
      >
        <img src="/logo-light.png" alt="modellio" className="h-[26px] w-auto" draggable={false} />
      </a>
      <nav className="flex items-center gap-1" aria-label="Main">
        {NAV.map(({ label, Icon, view: target, studio: targetStudio, soon, hint }) => {
          const enabled = !!(target || targetStudio);
          const active = targetStudio ? studio === targetStudio : studio === 'design' && target === view;
          const button = (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (targetStudio) setStudio(targetStudio);
                else if (target) {
                  setStudio('design');
                  setView(target);
                }
              }}
              disabled={!enabled}
              title={soon ?? hint}
              aria-current={active ? 'page' : undefined}
              aria-label={label}
              className={`flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-[14px] font-medium transition-colors lg:px-3 xl:px-3.5 ${
                active ? 'bg-brand text-white shadow-sm' : enabled ? 'text-white/80 hover:bg-white/10' : 'text-white/40'
              } disabled:cursor-default`}
            >
              <Icon size={17} />
              <span className="hidden xl:inline">{label}</span>
            </button>
          );
          // The Makers menu sits right after the studios.
          return targetStudio === 'split' ? [button, <MakersMenu key="makers" active={studio === 'cookie'} onOpen={setStudio} />] : button;
        })}
      </nav>
      <div className="flex-1" />
      <span className="hidden whitespace-nowrap text-[12px] font-medium tracking-wide text-white/60 xl:block">
        Make anything. Shape everything.
      </span>
      <AccountButton />
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
            {(studio === 'design'
              ? [
                  { label: 'Take the tour', Icon: Compass, run: () => useTour.getState().start() },
                  { label: 'Keyboard shortcuts', Icon: Keyboard, run: onShowShortcuts },
                ]
              : [{ label: 'Back to Design', Icon: Box, run: () => setStudio('design') }]
            ).map(({ label, Icon, run }) => (
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
