import { useState } from 'react';
import { LayoutGrid, Loader2, Sparkles } from 'lucide-react';
import { TEMPLATES, type Template } from '@/templates/templates';
import { useProjects } from '@/store/projectStore';

/** Starter designs: each opens as a new, fully editable project. */
export function TemplatesPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const use = async (t: Template) => {
    setBusy(t.id);
    try {
      await useProjects.getState().createFromTemplate(t);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="absolute inset-0 z-20 overflow-y-auto bg-canvas" aria-label="Templates">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">Templates</h1>
        <p className="mt-1 text-[14px] text-muted">
          Start from a proven design. Every part stays editable — change sizes, text and holes to make it yours.
        </p>
        <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-5">
          {TEMPLATES.map((t) => (
            <li
              key={t.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-panel"
              data-testid="template-card"
            >
              <div className="flex aspect-[16/10] items-center justify-center bg-[#eef3fb]">
                <img
                  src={`/templates/${t.id}.jpg`}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                />
                <LayoutGrid size={36} className="absolute text-[#c4cfe0]" aria-hidden="true" />
              </div>
              <div className="flex flex-1 flex-col px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[15px] font-semibold text-ink">{t.name}</h2>
                  <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-muted">{t.level}</span>
                </div>
                <p className="mt-1 flex-1 text-[13px] leading-snug text-muted">{t.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.tags.map((tag) => (
                    <span key={tag} className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand">
                      {tag}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void use(t)}
                  className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-brand py-2 text-[13px] font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
                >
                  {busy === t.id ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  Use {t.name.toLowerCase()}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
