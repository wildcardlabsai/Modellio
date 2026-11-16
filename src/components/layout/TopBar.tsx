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
  Flower2,
  ChevronDown,
  KeyRound,
  Signpost,
  Grid3x3,
  Image,
  LayoutDashboard,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { AccountButton } from './AccountButton';
import { useTour } from '@/components/onboarding/Tour';
import { useProjects } from '@/store/projectStore';
import { useStudio, type StudioId } from '@/app/studio';
import { MAKER_ENTRIES } from '@/platform/catalog';

const NAV = [
  { label: 'Dashboard', Icon: LayoutDashboard, studio: 'dashboard' as const, hint: 'Your projects, makers and tools' },
  { label: 'Design', Icon: Box, view: 'editor' as const },
  { label: 'Split Studio', Icon: Scissors, studio: 'split' as const, hint: 'Split a multi-colour 3MF into parts' },
  { label: 'My Projects', Icon: FolderOpen, view: 'projects' as const },
  // On a phone these two are left out of the bar (Templates is on the Dashboard; Community is not open yet).
  { label: 'Templates', Icon: LayoutGrid, view: 'templates' as const, wide: true },
  { label: 'Community', Icon: Users, soon: 'Coming soon', wide: true },
];

/** Focused makers (from the shared catalogue), plus makers still to come, shown disabled. */
const MAKER_ICONS: Record<string, LucideIcon> = {
  keyring: KeyRound,
  keytag: Tag,
  sign: Signpost,
  vase: Flower2,
  split: Scissors,
  cookie: Cookie,
};
export const MAKERS: { id: string; label: string; Icon: LucideIcon; studio?: StudioId }[] = [
  ...MAKER_ENTRIES.filter((m) => m.id !== 'split').map((m) => ({
    id: m.id,
    label: m.name,
    Icon: MAKER_ICONS[m.id] ?? Wand2,
    studio: m.studio,
  })),
  { id: 'organiser', label: 'Organiser Generator', Icon: Grid3x3 },
  { id: 'lithophane', label: 'Lithophane Studio', Icon: Image },
];
const MAKER_STUDIOS = new Set(MAKERS.map((m) => m.studio).filter(Boolean));

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
          className={`flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2 text-[14px] sm:px-2.5 font-medium transition-colors lg:px-3 xl:px-3.5 ${
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
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-ink-2 hover:bg-brand-50 hover:text-brand-ink disabled:cursor-default disabled:text-[#667085] disabled:hover:bg-transparent"
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
    <header className="flex h-14 shrink-0 items-center gap-2 bg-navy px-3 text-white sm:gap-6 sm:px-5">
      <a
        href="/"
        className="flex shrink-0 items-center"
        aria-label="Modellio home"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          setStudio('home');
        }}
      >
        <img src="/logo-light.png" alt="modellio" className="h-[22px] w-auto max-w-none sm:h-[26px]" draggable={false} />
      </a>
      <nav className="flex min-w-0 items-center gap-0.5 sm:gap-1" aria-label="Main">
        {NAV.map(({ label, Icon, view: target, studio: targetStudio, soon, hint, wide }) => {
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
              className={`flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2 text-[14px] sm:px-2.5 font-medium transition-colors lg:px-3 xl:px-3.5 ${wide ? 'max-sm:hidden' : ''} ${
                active ? 'bg-brand text-white shadow-sm' : enabled ? 'text-white/80 hover:bg-white/10' : 'text-white/40'
              } disabled:cursor-default`}
            >
              <Icon size={17} />
              <span className="hidden xl:inline">{label}</span>
            </button>
          );
          // The Makers menu sits right after the studios.
          return targetStudio === 'split'
            ? [button, <MakersMenu key="makers" active={MAKER_STUDIOS.has(studio)} onOpen={setStudio} />]
            : button;
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
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-ink-2 hover:bg-brand-50 hover:text-brand-ink"
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
