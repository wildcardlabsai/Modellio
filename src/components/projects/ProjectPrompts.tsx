import { useState } from 'react';
import { useProjects } from '@/store/projectStore';
import { ConfirmChoice } from '@/components/ui/ConfirmChoice';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

/**
 * Questions the project lifecycle asks: what to do with unsaved changes before leaving a design
 * (Save / Discard / Cancel), and a name for a design being saved. Mounted once for every workspace.
 */
export function ProjectPrompts() {
  const prompt = useProjects((s) => s.prompt);
  if (!prompt) return null;
  if (prompt.kind === 'guard')
    return (
      <ConfirmChoice
        title="Save changes?"
        testId="unsaved-prompt"
        onCancel={() => prompt.resolve('cancel')}
        choices={[
          { label: 'Discard changes', variant: 'danger', testId: 'unsaved-discard', onChoose: () => prompt.resolve('discard') },
          { label: 'Save', variant: 'primary', testId: 'unsaved-save', onChoose: () => prompt.resolve('save') },
        ]}
      >
        <p>
          <strong className="font-semibold text-ink">{prompt.name}</strong> has changes that are not saved. Save them before you{' '}
          {prompt.next}?
        </p>
        <p className="mt-2 text-[13px] text-muted">Discarding keeps the design as it was last saved.</p>
      </ConfirmChoice>
    );
  return <NamePrompt key={prompt.title + prompt.initial} {...prompt} />;
}

function NamePrompt({
  title,
  action,
  initial,
  resolve,
}: {
  title: string;
  action: string;
  initial: string;
  resolve: (name: string | null) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Modal
      title={title}
      onClose={() => resolve(null)}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => resolve(null)}>
            Cancel
          </Button>
          <Button variant="primary" form="project-name-form" type="submit" disabled={!name.trim()} data-testid="project-name-save">
            {action}
          </Button>
        </>
      }
    >
      <form
        id="project-name-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) resolve(name);
        }}
      >
        <label className="block text-[13px] font-medium text-ink-2">
          Design name
          <input
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            maxLength={80}
            data-testid="project-name-input"
            className="mt-1.5 h-10 w-full rounded-lg border border-line bg-panel px-3 text-[14px] text-ink outline-none focus:border-brand"
          />
        </label>
        <p className="mt-2 text-[12px] text-muted">Saved on this device. Open it again from My projects, the dashboard or Open design.</p>
      </form>
    </Modal>
  );
}
