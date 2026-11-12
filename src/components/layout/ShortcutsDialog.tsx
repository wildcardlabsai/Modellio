import { X } from 'lucide-react';
import { MOD } from '@/utils/platform';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Editing',
    items: [
      ['Undo', `${MOD} Z`],
      ['Redo', `${MOD} ⇧ Z`],
      ['Duplicate', `${MOD} D`],
      ['Copy / Cut / Paste', `${MOD} C / X / V`],
      ['Group', `${MOD} G`],
      ['Ungroup', `${MOD} ⇧ G`],
      ['Delete', 'Del / ⌫'],
      ['Select all', `${MOD} A`],
      ['Deselect / cancel drag', 'Esc'],
      ['Drop to workplane', 'D'],
      ['Toggle hole / solid', 'H'],
      ['Measure tool', 'M'],
    ],
  },
  {
    title: 'Transform',
    items: [
      ['Move tool', 'W'],
      ['Rotate tool', 'E'],
      ['Resize tool', 'R'],
      ['Nudge X / Y', '← → ↑ ↓'],
      ['Nudge Z', 'PgUp / PgDn'],
      ['Nudge ×10', '⇧ + nudge'],
    ],
  },
  {
    title: 'View',
    items: [
      ['Orbit', 'Left drag'],
      ['Pan', 'Right drag / ⇧ Left drag'],
      ['Zoom to cursor', 'Wheel'],
      ['Fit selection / all', 'F'],
      ['Multi-select', '⇧ / Ctrl click'],
      ['Select inside a group', 'Double-click'],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-[min(720px,92vw)] rounded-2xl bg-white p-6 shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-ink">Keyboard shortcuts</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-canvas">
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">{g.title}</h3>
              <ul className="space-y-1.5">
                {g.items.map(([label, keys]) => (
                  <li key={label} className="flex items-center justify-between gap-2 text-[13px] text-[#344054]">
                    {label}
                    <kbd className="whitespace-nowrap rounded-md border border-line bg-canvas px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink">{keys}</kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
