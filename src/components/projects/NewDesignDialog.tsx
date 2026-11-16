import { Box, LayoutTemplate } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useProjects } from '@/store/projectStore';
import { useStudio, type StudioId } from '@/app/studio';
import { useMakerHandoff } from '@/platform/handoff';
import { MAKER_ENTRIES } from '@/platform/catalog';

/**
 * New design: a blank Design Studio design, a new design in one of the makers, or a template.
 * Each is a new project of its own; nothing already saved is touched, and unsaved changes are
 * asked about first.
 */
export function NewDesignDialog() {
  const open = useProjects((s) => s.dialog === 'new');
  if (!open) return null;
  const close = () => useProjects.getState().setDialog(null);
  const card =
    'flex items-start gap-3 rounded-xl border border-line bg-panel p-3 text-left hover:border-brand hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand';
  return (
    <Modal title="New design" onClose={close} width={640}>
      <div className="grid gap-2 sm:grid-cols-2" data-testid="new-design-dialog">
        <button
          type="button"
          className={`${card} sm:col-span-2`}
          data-testid="new-blank"
          onClick={() => {
            close();
            useStudio.getState().setStudio('design');
            void useProjects.getState().newProject();
          }}
        >
          <Box size={22} className="mt-0.5 shrink-0 text-brand-ink" />
          <span>
            <span className="block text-[14px] font-semibold text-ink">Blank Design Studio design</span>
            <span className="block text-[12px] text-muted">An empty workplane with every modelling tool.</span>
          </span>
        </button>
        {MAKER_ENTRIES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={card}
            data-testid={`new-maker-${m.id}`}
            onClick={() => {
              close();
              useMakerHandoff.getState().giveFresh(m.studio);
              useStudio.getState().setStudio(m.studio as StudioId);
            }}
          >
            <img src={m.image} alt="" className="h-10 w-10 shrink-0 object-contain" />
            <span>
              <span className="block text-[14px] font-semibold text-ink">{m.name}</span>
              <span className="block text-[12px] leading-snug text-muted">{m.line}</span>
            </span>
          </button>
        ))}
        <button
          type="button"
          className={`${card} sm:col-span-2`}
          onClick={() => {
            close();
            useStudio.getState().setStudio('design');
            useProjects.getState().setView('templates');
          }}
        >
          <LayoutTemplate size={22} className="mt-0.5 shrink-0 text-brand-ink" />
          <span>
            <span className="block text-[14px] font-semibold text-ink">Start from a template</span>
            <span className="block text-[12px] text-muted">A ready-made Design Studio design to change.</span>
          </span>
        </button>
      </div>
    </Modal>
  );
}
