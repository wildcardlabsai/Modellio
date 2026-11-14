import { PencilRuler, Box, SlidersHorizontal } from 'lucide-react';
import { useMakerPane, type MakerPane } from './mobilePane';

/** Bottom tab bar for makers on phones (hidden from md up, where all columns show side by side). */
export function MobilePaneTabs({ labels }: { labels: Record<MakerPane, string> }) {
  const pane = useMakerPane((s) => s.pane);
  const setPane = useMakerPane((s) => s.setPane);
  const items: { id: MakerPane; Icon: typeof Box }[] = [
    { id: 'tools', Icon: PencilRuler },
    { id: 'canvas', Icon: Box },
    { id: 'settings', Icon: SlidersHorizontal },
  ];
  return (
    <nav
      className="grid shrink-0 grid-cols-3 border-t border-line bg-white md:hidden"
      aria-label="Maker sections"
      data-testid="maker-mobile-tabs"
    >
      {items.map(({ id, Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={pane === id}
          onClick={() => setPane(id)}
          className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${pane === id ? 'text-brand' : 'text-[#475467]'}`}
        >
          <Icon size={18} />
          {labels[id]}
        </button>
      ))}
    </nav>
  );
}
