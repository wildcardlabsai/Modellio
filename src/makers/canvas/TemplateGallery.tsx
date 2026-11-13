import { useState } from 'react';
import { Plus } from 'lucide-react';

/** A maker's template grid with category filters and a "Start blank" tile. */
export function TemplateGallery({
  templates,
  categories,
  selected,
  thumbDir,
  testPrefix,
  blankHint,
  onOpen,
  onBlank,
}: {
  templates: { id: string; name: string; category: string; description: string }[];
  categories: string[];
  selected: string | null;
  /** Thumbnails are /<thumbDir>/<id>.jpg. */
  thumbDir: string;
  testPrefix: string;
  blankHint: string;
  onOpen: (id: string) => void;
  onBlank: () => void;
}) {
  const [cat, setCat] = useState<string>('All');
  const list = templates.filter((t) => cat === 'All' || t.category === cat);
  return (
    <div className="p-3">
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Template category">
        {['All', ...categories].map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={cat === c}
            onClick={() => setCat(c)}
            className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${cat === c ? 'border-brand bg-brand-50 text-brand' : 'border-line text-[#344054] hover:bg-[#f9fafb]'}`}
          >
            {c}
          </button>
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-2" data-testid={`${testPrefix}-templates`}>
        <li>
          <button
            type="button"
            onClick={onBlank}
            className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#c9d1de] text-center text-[13px] font-semibold text-[#344054] hover:border-brand hover:text-brand"
            data-testid={`${testPrefix}-blank`}
          >
            <Plus size={22} />
            Start blank
            <span className="px-3 text-[11px] font-normal text-muted">{blankHint}</span>
          </button>
        </li>
        {list.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onOpen(t.id)}
              aria-pressed={selected === t.id}
              title={t.description}
              className={`block w-full overflow-hidden rounded-lg border text-left ${selected === t.id ? 'border-brand ring-2 ring-brand/30' : 'border-line hover:border-[#98a2b3]'}`}
              data-testid={`${testPrefix}-template`}
              data-template={t.id}
            >
              <img
                src={`/${thumbDir}/${t.id}.jpg`}
                alt=""
                width={200}
                height={200}
                loading="lazy"
                className="aspect-square w-full bg-[#f5f7fb] object-cover"
              />
              <span className="block px-2 py-1.5">
                <span className="block truncate text-[12px] font-semibold text-ink">{t.name}</span>
                <span className="block truncate text-[11px] text-muted">{t.category}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
