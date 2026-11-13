import { SquaresUnite, SquaresSubtract, SquaresIntersect, Layers2, Scissors, CircleDashed, type LucideIcon } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { useCadReady } from '@/viewport/cadReady';

interface Item {
  label: string;
  hint: string;
  Icon: LucideIcon;
  run: () => void;
  disabled?: boolean;
}

export function CombineMenu({ onDone }: { onDone: () => void }) {
  const s = useEditor.getState();
  const count = useEditor((st) => st.selection.length);
  const ready = useCadReady((st) => st.kernel);
  const hasCombined = useEditor((st) =>
    st.selection.some((id) => {
      const o = st.doc.objects[id];
      return o?.kind === 'group' && !!o.combine;
    }),
  );
  const hasMesh = useEditor((st) =>
    st.selection.some((id) => {
      const o = st.doc.objects[id];
      return o?.kind === 'shape' && o.shape === 'mesh';
    }),
  );
  const allHoles = useEditor(
    (st) =>
      st.selection.length > 0 &&
      st.selection.every((id) => {
        const o = st.doc.objects[id];
        return o?.kind === 'shape' && o.isHole;
      }),
  );

  const booleans: Item[] = [
    {
      label: 'Union',
      hint: 'Merge into one solid. Holes cut through it.',
      Icon: SquaresUnite,
      run: () => s.combineSelected('union'),
      disabled: count < 2,
    },
    {
      label: 'Subtract',
      hint: 'Cut the others out of the first-selected object.',
      Icon: SquaresSubtract,
      run: () => s.combineSelected('subtract'),
      disabled: count < 2,
    },
    {
      label: 'Intersect',
      hint: 'Keep only the volume they share.',
      Icon: SquaresIntersect,
      run: () => s.combineSelected('intersect'),
      disabled: count < 2,
    },
  ];
  const tools: Item[] = [
    {
      label: allHoles ? 'Make solid' : 'Make hole',
      hint: allHoles ? 'Turn the hole back into a solid.' : 'Turn the selection into a cutter (H).',
      Icon: CircleDashed,
      run: () => s.setHole(useEditor.getState().selection, !allHoles),
      disabled: count < 1,
    },
    {
      label: 'Flatten to mesh',
      hint: 'Bake a combination into one fixed mesh.',
      Icon: Layers2,
      run: () => s.bakeSelected(),
      disabled: !hasCombined,
    },
    {
      label: 'Separate parts',
      hint: 'Split a mesh into its disconnected pieces.',
      Icon: Scissors,
      run: () => s.separateSelected(),
      disabled: !hasMesh,
    },
  ];

  const render = (items: Item[]) =>
    items.map(({ label, hint, Icon, run, disabled }) => (
      <button
        key={label}
        type="button"
        disabled={disabled || !ready}
        onClick={() => {
          run();
          onDone();
        }}
        className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-brand-50 disabled:pointer-events-none disabled:opacity-40"
      >
        <Icon size={18} className="mt-0.5 shrink-0 text-brand" />
        <span>
          <span className="block text-[13px] font-semibold text-ink">{label}</span>
          <span className="block text-[12px] leading-snug text-muted">{hint}</span>
        </span>
      </button>
    ));

  return (
    <div className="w-[290px]">
      <p className="px-2.5 pb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
        Combine {count > 1 ? `${count} objects` : ''}
      </p>
      {render(booleans)}
      <div className="my-1.5 border-t border-line" />
      {render(tools)}
      {!ready && <p className="px-2.5 pt-1 text-[12px] text-muted">Loading the solid-modelling engine…</p>}
      <p className="px-2.5 pt-2 text-[11px] leading-snug text-muted">
        Combinations stay editable: select a part in the Objects list to change it, or ungroup to get the parts back.
      </p>
    </div>
  );
}
