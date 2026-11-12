import { useState } from 'react';
import { Type } from 'lucide-react';
import { useEditor } from '@/store/editorStore';
import { FONTS } from '@/cad/text/fonts';
import { SHAPE_DRAG_MIME } from '@/viewport/Viewport';

/** Left panel for adding 3D text. Text is real, watertight geometry (usable as a hole for engraving). */
export function TextPanel() {
  const [content, setContent] = useState('Hello');
  const [busy, setBusy] = useState(false);
  const addText = useEditor((s) => s.addText);

  const add = async () => {
    if (!content.trim()) return;
    setBusy(true);
    await addText(content);
    setBusy(false);
  };

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-white" aria-label="Text">
      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
        <h2 className="text-[15px] font-semibold text-ink">3D Text</h2>
        <p className="mt-1 text-[12px] text-muted">Solid, printable lettering. Make it a hole to engrave it into another shape.</p>
        <label className="mt-4 block text-[13px] font-semibold text-ink" htmlFor="new-text">
          Text
        </label>
        <textarea
          id="new-text"
          value={content}
          rows={3}
          onChange={(e) => setContent(e.target.value)}
          className="mt-1.5 w-full resize-none rounded-lg border border-line px-3 py-2 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
        <button
          type="button"
          disabled={busy || !content.trim()}
          onClick={add}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(SHAPE_DRAG_MIME, `text:${content}`);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-[13px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
        >
          <Type size={16} /> {busy ? 'Creating…' : 'Add text'}
        </button>
        <p className="mt-2 text-[11px] text-muted">Tip: drag the button onto the workplane to place it.</p>
        <h3 className="mb-2 mt-5 text-[13px] font-semibold text-ink">Fonts</h3>
        <ul className="space-y-1 text-[12px] text-muted">
          {FONTS.map((f) => (
            <li key={f.id}>{f.label}</li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted">Change the font of a selected text in the inspector. All fonts are SIL Open Font License.</p>
      </div>
    </aside>
  );
}
