import { useEffect, useRef, useState } from 'react';
import { useProjects } from '@/store/projectStore';
import { useEditor } from '@/store/editorStore';
import { useMakerHandoff, type PendingMakerProject } from '@/platform/handoff';
import { ConfirmChoice } from '@/components/ui/ConfirmChoice';
import type { ProjectActions } from '@/components/projects/ProjectMenu';
import type { MeshData } from '@/cad/kernel/meshData';
import { isTypingTarget } from '@/hooks/useKeyboardShortcuts';
import { capturePreview } from './capture';

/**
 * What a maker tells the shared project lifecycle about itself. Each maker keeps its own
 * workflow and settings; saving, opening, new designs and "Open in Design Studio" all go through
 * the one project store (one project, two views).
 */
export interface MakerAdapter {
  studio: string;
  /** "Keyring Maker". */
  label: string;
  schema: number;
  project: () => { id: string; name: string } | null;
  setProject: (p: { id: string; name: string } | null) => void;
  dirty: () => boolean;
  /** The maker's settings, as saved with the project. */
  state: () => unknown;
  /** The built parts to save (or a promise of them), or null while the design is still building. */
  parts: () => Parts | null | Promise<Parts | null>;
  /** Open saved settings. */
  load: (state: unknown) => void;
  /** Start a new, blank design. */
  startBlank: () => void;
  suggestedName: () => string;
}

type Parts = { name: string; mesh: MeshData; color?: string }[];

type Question =
  | { kind: 'leave'; next: string; resolve: (c: 'save' | 'discard' | 'cancel') => void }
  | { kind: 'rebuild'; name: string; resolve: (c: 'rebuild' | 'copy' | 'cancel') => void };

/**
 * A maker's project controls: Save, Save as, Open in Design Studio, and the Save / Discard /
 * Cancel question when another design is about to replace unsaved work. Also takes designs
 * handed to the maker (opened from the dashboard, New design…). Returns the controls and the
 * dialog element to render.
 */
export function useMakerProject(a: MakerAdapter) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [busy, setBusy] = useState(false);
  const adapter = useRef(a);
  useEffect(() => {
    adapter.current = a;
  });

  const ask = <T,>(q: (resolve: (v: T) => void) => Question) =>
    new Promise<T>((resolve) =>
      setQuestion(
        q((v) => {
          setQuestion(null);
          resolve(v);
        }),
      ),
    );

  const save = async (asNew = false): Promise<boolean> => {
    const m = adapter.current;
    const projects = useProjects.getState();
    const project = m.project();
    let name = project?.name ?? '';
    if (!project || asNew) {
      const asked = await projects.askName(
        asNew ? 'Save as' : 'Save design',
        asNew ? 'Save copy' : 'Save',
        asNew ? `${name} copy` : m.suggestedName(),
      );
      if (!asked) return false;
      name = asked;
    } else if (projects.projects.find((p) => p.id === project.id)?.studioEdited) {
      // Changed in the Design Studio since: rebuilding from the maker replaces those changes.
      const c = await ask<'rebuild' | 'copy' | 'cancel'>((resolve) => ({ kind: 'rebuild', name, resolve }));
      if (c === 'cancel') return false;
      if (c === 'copy') return save(true);
    }
    setBusy(true);
    try {
      const parts = await m.parts();
      if (!parts) {
        useEditor.getState().notify('The design is still building. Try again in a moment.');
        return false;
      }
      const id = await projects.saveMakerProject({
        id: asNew ? null : project?.id,
        name,
        studio: m.studio,
        schema: m.schema,
        state: m.state(),
        parts,
        thumbnail: capturePreview(),
      });
      m.setProject({ id, name });
      return true;
    } catch (e) {
      useEditor.getState().notify(`Could not save: ${e instanceof Error ? e.message : e}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Fine to replace the design on screen? (Asks about unsaved changes first.) */
  const confirmLeave = async (next: string) => {
    const m = adapter.current;
    if (!m.dirty()) return true;
    const c = await ask<'save' | 'discard' | 'cancel'>((resolve) => ({ kind: 'leave', next, resolve }));
    if (c === 'cancel') return false;
    if (c === 'discard') return true;
    return save();
  };

  const openInDesign = async () => {
    const m = adapter.current;
    // The Design Studio opens the saved project itself, so save first.
    if ((m.dirty() || !m.project()) && !(await save())) return;
    const p = m.project();
    if (p) await useProjects.getState().openInDesign(p.id);
  };

  // Designs handed to this maker: a saved project (dashboard, Open…) or a new design.
  useEffect(() => {
    const take = async () => {
      const h = useMakerHandoff.getState();
      const m = adapter.current;
      const fresh = h.takeFresh(m.studio);
      const handed: PendingMakerProject | null = fresh ? null : h.take(m.studio);
      if (!fresh && !handed) return;
      if (handed && handed.projectId === m.project()?.id && !m.dirty()) return;
      if (!(await confirmLeave(handed ? `open “${handed.name}”` : 'start a new design'))) return;
      if (handed) {
        m.load(handed.state);
        m.setProject({ id: handed.projectId, name: handed.name });
      } else {
        m.startBlank();
        m.setProject(null);
      }
    };
    void take();
    const stop = useMakerHandoff.subscribe((s, prev) => {
      if (s.pending !== prev.pending || s.fresh !== prev.fresh) void take();
    });
    // Ctrl+S saves the maker's design.
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !isTypingTarget(e.target)) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      stop();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const project = a.project();
  const actions: ProjectActions = {
    name: project?.name ?? a.suggestedName(),
    save: () => void save(),
    saveAs: () => void save(true),
    openInDesign: () => void openInDesign(),
    ...(project
      ? {
          rename: async () => {
            const n = await useProjects.getState().askName('Rename design', 'Rename', project.name);
            if (!n) return;
            await useProjects.getState().rename(project.id, n);
            adapter.current.setProject({ id: project.id, name: n });
          },
          duplicate: () => void useProjects.getState().duplicate(project.id),
          remove: async () => {
            await useProjects.getState().remove(project.id);
            adapter.current.startBlank();
            adapter.current.setProject(null);
          },
        }
      : {}),
  } as ProjectActions;

  const dialog = question ? (
    question.kind === 'leave' ? (
      <ConfirmChoice
        title="Save changes?"
        testId="maker-unsaved-prompt"
        onCancel={() => question.resolve('cancel')}
        choices={[
          { label: 'Discard changes', variant: 'danger', testId: 'maker-unsaved-discard', onChoose: () => question.resolve('discard') },
          { label: 'Save', variant: 'primary', testId: 'maker-unsaved-save', onChoose: () => question.resolve('save') },
        ]}
      >
        <p>
          The design in the {a.label} has changes that are not saved. Save them before you {question.next}?
        </p>
      </ConfirmChoice>
    ) : (
      <ConfirmChoice
        title="Rebuild from the maker?"
        testId="maker-rebuild-prompt"
        onCancel={() => question.resolve('cancel')}
        choices={[
          { label: 'Save as a new design', testId: 'maker-rebuild-copy', onChoose: () => question.resolve('copy') },
          { label: 'Rebuild and save', variant: 'primary', testId: 'maker-rebuild-confirm', onChoose: () => question.resolve('rebuild') },
        ]}
      >
        <p>
          “{question.name}” was changed in the Design Studio. Saving it here rebuilds it from the {a.label}’s settings and replaces those
          changes. The Design Studio version is kept in its version history.
        </p>
      </ConfirmChoice>
    )
  ) : null;

  return { actions, save, openInDesign, busy, dialog };
}
