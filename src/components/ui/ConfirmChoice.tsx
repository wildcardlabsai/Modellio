import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { Button, type ButtonVariant } from './Button';

export interface Choice {
  label: string;
  onChoose: () => void;
  variant?: ButtonVariant;
  testId?: string;
}

/**
 * A question with several answers (e.g. Save / Discard / Cancel). Escape, the close button and
 * the backdrop all mean `onCancel`; the first choice gets focus.
 */
export function ConfirmChoice({
  title,
  children,
  choices,
  onCancel,
  cancelLabel = 'Cancel',
  testId,
}: {
  title: string;
  children: ReactNode;
  choices: Choice[];
  onCancel: () => void;
  cancelLabel?: string;
  testId?: string;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={460}
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2" data-testid={testId}>
          <Button variant="ghost" onClick={onCancel} data-testid={testId ? `${testId}-cancel` : undefined}>
            {cancelLabel}
          </Button>
          {choices.map((c, i) => (
            <Button
              key={c.label}
              variant={c.variant ?? (i === choices.length - 1 ? 'primary' : 'secondary')}
              onClick={c.onChoose}
              data-testid={c.testId}
              data-autofocus={i === 0 || undefined}
            >
              {c.label}
            </Button>
          ))}
        </div>
      }
    >
      <div className="text-[14px] leading-relaxed text-ink-2">{children}</div>
    </Modal>
  );
}
