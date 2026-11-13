import { useState, type CSSProperties, type ReactNode } from 'react';
import '@fontsource/space-mono/400.css';
import { ArrowRight, ArrowUpRight, Menu, X, Plus } from 'lucide-react';
import { useStudio, studioUrl, type StudioId } from '@/app/studio';
import { useProjects } from '@/store/projectStore';
import { TEMPLATES, type Template } from '@/templates/templates';
import { COMING_SOON, DESIGN_STUDIO, FAQ, MAKERS, type Maker } from './content';

/** Navigate inside the app while keeping a real href (so links open in a new tab too). */
function StudioLink({
  to,
  className,
  children,
  label,
  testId,
}: {
  to: Exclude<StudioId, 'home'>;
  className: string;
  children: ReactNode;
  label?: string;
  testId?: string;
}) {
  return (
    <a
      href={studioUrl(to)}
      aria-label={label}
      className={className}
      data-testid={testId}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        useStudio.getState().setStudio(to);
      }}
    >
      {children}
    </a>
  );
}

const MONO = "font-['Space_Mono',ui-monospace,monospace]";
const INK = 'text-[#16191F]';
const MUTED = 'text-[#5B6270]';
const PAPER = 'bg-[#FAF9F6]';
/** Drafting paper: 2 mm minor and 10 mm major grid lines (at 10 px per mm). */
const GRID: CSSProperties = {
  backgroundImage:
    'linear-gradient(#e6e2d8 1px, transparent 1px), linear-gradient(90deg, #e6e2d8 1px, transparent 1px), linear-gradient(#f0ede6 1px, transparent 1px), linear-gradient(90deg, #f0ede6 1px, transparent 1px)',
  backgroundSize: '100px 100px, 100px 100px, 20px 20px, 20px 20px',
  backgroundPosition: '-1px -1px',
};
const BTN_DARK = `inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#16191F] px-5 text-[15px] font-semibold text-white hover:bg-[#2a2f39]`;
const BTN_BLUE = `inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-600`;

const NAV = [
  { href: '#makers', label: 'Makers' },
  { href: '#design-studio', label: 'Design Studio' },
  { href: '#templates', label: 'Templates' },
  { href: '#faq', label: 'FAQ' },
];

export function LandingPage() {
  return (
    <div className={`h-full overflow-y-auto scroll-smooth ${PAPER} ${INK}`} data-testid="landing">
      <Header />
      <main id="main">
        <Hero />
        <MakersSection />
        <DesignStudioSection />
        <Templates />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-[#E4E0D6] bg-[#FAF9F6]/95 px-4 backdrop-blur sm:px-6">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6">
        <a href="/" className="flex shrink-0 items-center" aria-label="Modellio home">
          <img src="/logo-dark.png" alt="modellio" className="h-[24px] w-auto" draggable={false} />
        </a>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Page sections">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={`rounded-md px-3 py-2 text-[14px] font-medium ${MUTED} hover:bg-[#EFECE4] hover:text-[#16191F]`}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex-1" />
        <StudioLink
          to="design"
          className="hidden h-10 items-center gap-2 rounded-md bg-[#16191F] px-4 text-[14px] font-semibold text-white hover:bg-[#2a2f39] sm:inline-flex"
        >
          Open Design Studio <ArrowRight size={16} />
        </StudioLink>
        <button
          type="button"
          className="rounded-md p-2 hover:bg-[#EFECE4] md:hidden"
          aria-expanded={open}
          aria-controls="landing-mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {open && (
        <nav id="landing-mobile-nav" className={`border-t border-[#E4E0D6] ${PAPER} px-4 pb-4 pt-2 md:hidden`} aria-label="Page sections">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2.5 text-[15px] font-medium hover:bg-[#EFECE4]"
            >
              {n.label}
            </a>
          ))}
          <StudioLink to="design" className={`${BTN_DARK} mt-2 w-full`}>
            Open Design Studio <ArrowRight size={16} />
          </StudioLink>
        </nav>
      )}
    </header>
  );
}

/** A small technical label, like a dimension or a drawing reference. */
function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`${MONO} text-[12px] uppercase tracking-[0.06em] ${MUTED} ${className}`}>{children}</p>;
}

function Hero() {
  return (
    <section className="border-b border-[#E4E0D6] px-4 sm:px-6" style={GRID} aria-labelledby="hero-heading">
      <div className="mx-auto max-w-6xl pb-16 pt-12 lg:pb-20 lg:pt-16">
        <Label>Free · in your browser · for 3D printing</Label>
        <h1 id="hero-heading" className="mt-3 max-w-3xl text-[40px] font-extrabold leading-[1.04] tracking-[-0.02em] sm:text-[60px]">
          What are you making?
        </h1>
        <p className={`mt-4 max-w-2xl text-[18px] leading-relaxed ${MUTED}`}>
          Design it yourself from a blank workplane, or pick a maker that builds one particular thing for you. Either way you get files any
          slicer can print.
        </p>

        <div className="mt-10 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
          {/* Path 1: from scratch */}
          <div className="flex flex-col rounded-lg border border-[#16191F] bg-white" data-testid="path-scratch">
            <div className="flex items-baseline justify-between border-b border-[#E4E0D6] px-5 py-3">
              <Label>01 — Start from scratch</Label>
              <span className={`${MONO} text-[11px] ${MUTED}`}>mm</span>
            </div>
            <div className="flex flex-1 flex-col p-5">
              <h2 className="text-[26px] font-bold tracking-tight">Design Studio</h2>
              <p className={`mt-1.5 text-[15px] leading-relaxed ${MUTED}`}>
                Shapes, holes, text and exact measurements. For anything there isn’t a maker for, or for changing what a maker made.
              </p>
              <img
                src={DESIGN_STUDIO.image}
                alt="The Design Studio with a desk organiser being modelled"
                width={1800}
                height={1125}
                className="mt-4 aspect-[16/9] w-full rounded border border-[#E4E0D6] object-cover object-left-top"
              />
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
                <StudioLink to="design" className={BTN_DARK}>
                  Start designing <ArrowRight size={16} />
                </StudioLink>
                <a
                  href="#templates"
                  className="text-[14px] font-medium underline decoration-[#C9C4B8] underline-offset-4 hover:decoration-[#16191F]"
                >
                  or start from a template
                </a>
              </div>
            </div>
          </div>

          {/* Path 2: makers */}
          <div className="flex flex-col rounded-lg border border-[#16191F] bg-white" data-testid="path-makers">
            <div className="flex items-baseline justify-between border-b border-[#E4E0D6] px-5 py-3">
              <Label>02 — Use a maker</Label>
              <span className={`${MONO} text-[11px] ${MUTED}`}>{MAKERS.length} ready</span>
            </div>
            <div className="flex flex-1 flex-col p-5">
              <h2 className="text-[26px] font-bold tracking-tight">Makers</h2>
              <p className={`mt-1.5 text-[15px] leading-relaxed ${MUTED}`}>
                Tools that make one thing well. Answer a few questions and download print-ready parts.
              </p>
              <ul className="mt-4 divide-y divide-[#E4E0D6] border-y border-[#E4E0D6]">
                {MAKERS.map((m) => (
                  <li key={m.id}>
                    <StudioLink to={m.studio!} className="group flex items-center gap-4 py-3.5" testId={`maker-link-${m.id}`}>
                      {/* Cropped to the model area of the screenshot. */}
                      <span
                        aria-hidden
                        className="h-[64px] w-[88px] shrink-0 rounded border border-[#E4E0D6] bg-[#f5f7fb] bg-no-repeat"
                        style={{
                          backgroundImage: `url(${m.image})`,
                          backgroundSize: '300%',
                          backgroundPosition: m.id === 'cookie' ? '48% 58%' : '42% 40%',
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[16px] font-semibold group-hover:text-brand">{m.name}</span>
                        <span className={`block text-[13px] leading-snug ${MUTED}`}>{m.line}</span>
                      </span>
                      <ArrowRight size={18} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
                    </StudioLink>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <Label>Coming next</Label>
                <p className="mt-1.5 text-[14px] leading-relaxed">{COMING_SOON.map((m) => m.name).join(' · ')}</p>
              </div>
              <a
                href="#makers"
                className="mt-auto pt-5 text-[14px] font-medium underline decoration-[#C9C4B8] underline-offset-4 hover:decoration-[#16191F]"
              >
                What each maker does
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Figure({ src, alt, caption, n }: { src: string; alt: string; caption: string; n: number }) {
  return (
    <figure>
      <img src={src} alt={alt} width={1800} height={1125} loading="lazy" className="w-full rounded border border-[#16191F] bg-white" />
      <figcaption className={`${MONO} mt-2 text-[12px] ${MUTED}`}>
        Fig. {n} — {caption}
      </figcaption>
    </figure>
  );
}

function Facts({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map((f) => (
        <li key={f} className="flex gap-2.5 text-[14px] leading-snug">
          <Plus size={14} className="mt-0.5 shrink-0 text-brand" aria-hidden />
          {f}
        </li>
      ))}
    </ul>
  );
}

function MakerBlock({ m, n, flip }: { m: Maker; n: number; flip: boolean }) {
  return (
    <article className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12" data-testid={`studio-card-${m.id}`}>
      <div className={flip ? 'lg:order-2' : ''}>
        <Figure
          src={m.image!}
          alt={`${m.name} screenshot`}
          caption={
            m.id === 'keyring'
              ? 'a two-colour name tag, 64 × 24 mm'
              : m.id === 'cookie'
                ? 'gingerbread cutter, stamp and handle'
                : m.id === 'vase'
                  ? 'a twisted star vase, 180 mm tall'
                  : 'a multi-colour model split into parts'
          }
          n={n}
        />
      </div>
      <div>
        <h3 className="text-[28px] font-bold leading-tight tracking-tight">{m.name}</h3>
        <p className="mt-1 text-[16px] font-medium">{m.line}</p>
        <p className={`mt-3 text-[15px] leading-relaxed ${MUTED}`}>{m.description}</p>
        <Facts items={m.facts} />
        <StudioLink to={m.studio!} className={`${BTN_BLUE} mt-6`}>
          {m.action} <ArrowRight size={16} />
        </StudioLink>
      </div>
    </article>
  );
}

function SectionHead({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-10 max-w-2xl">
      <h2 id={id} className="text-[34px] font-extrabold leading-tight tracking-[-0.015em] sm:text-[40px]">
        {title}
      </h2>
      {children && <p className={`mt-3 text-[17px] leading-relaxed ${MUTED}`}>{children}</p>}
    </div>
  );
}

function MakersSection() {
  return (
    <section id="makers" className="scroll-mt-16 border-b border-[#E4E0D6] px-4 py-20 sm:px-6" aria-labelledby="makers-heading">
      <div className="mx-auto max-w-6xl">
        <SectionHead id="makers-heading" title="Makers">
          Each maker is built for one job, so it can ask the right questions and get the details right for you. When you want to change
          something it didn’t ask about, send the result to the Design Studio.
        </SectionHead>
        <div className="flex flex-col gap-20">
          {MAKERS.map((m, i) => (
            <MakerBlock key={m.id} m={m} n={i + 1} flip={i % 2 === 1} />
          ))}
        </div>
        <div className="mt-20 rounded-lg border border-dashed border-[#B9B3A6] p-6">
          <h3 id="coming-soon" className="text-[20px] font-bold">
            Coming soon
          </h3>
          <ul className="mt-4 divide-y divide-[#E4E0D6]" aria-labelledby="coming-soon">
            {COMING_SOON.map((m) => (
              <li
                key={m.id}
                className="grid gap-1 py-3 sm:grid-cols-[220px_1fr_auto] sm:items-baseline sm:gap-6"
                data-testid={`soon-card-${m.id}`}
              >
                <span className="text-[15px] font-semibold">{m.name}</span>
                <span className={`text-[14px] ${MUTED}`}>{m.line}</span>
                <span className={`${MONO} text-[11px] uppercase ${MUTED}`}>Coming soon</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function DesignStudioSection() {
  return (
    <section
      id="design-studio"
      className="scroll-mt-16 border-b border-[#E4E0D6] bg-white px-4 py-20 sm:px-6"
      aria-labelledby="design-heading"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_1.2fr] lg:gap-14" data-testid="studio-card-design">
        <div>
          <SectionHead id="design-heading" title="The Design Studio">
            {DESIGN_STUDIO.description}
          </SectionHead>
          <div className="-mt-4">
            <Facts items={DESIGN_STUDIO.facts} />
          </div>
          <StudioLink to="design" className={`${BTN_DARK} mt-7`}>
            {DESIGN_STUDIO.action} <ArrowRight size={16} />
          </StudioLink>
        </div>
        <Figure
          src={DESIGN_STUDIO.image!}
          alt="The Design Studio: shape library, workplane and measurements"
          caption="a desk organiser, 150 × 70 × 45 mm"
          n={MAKERS.length + 1}
        />
      </div>
    </section>
  );
}

function Templates() {
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (t: Template) => {
    setBusy(t.id);
    try {
      await useProjects.getState().init();
      useStudio.getState().setStudio('design');
      await useProjects.getState().createFromTemplate(t);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section id="templates" className="scroll-mt-16 border-b border-[#E4E0D6] px-4 py-20 sm:px-6" aria-labelledby="templates-heading">
      <div className="mx-auto max-w-6xl">
        <SectionHead id="templates-heading" title="Or start from a template">
          Each one is built from ordinary shapes, so you can resize it, change it, or take it apart to see how it was made.
        </SectionHead>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => void open(t)}
                disabled={busy !== null}
                className="group block w-full overflow-hidden rounded-lg border border-[#D9D4C8] bg-white text-left hover:border-[#16191F] disabled:opacity-70"
                aria-label={`Open the ${t.name} template in the Design Studio`}
              >
                <img
                  src={`/templates/${t.id}.jpg`}
                  alt=""
                  width={320}
                  height={200}
                  loading="lazy"
                  className="aspect-[16/10] w-full border-b border-[#E4E0D6] object-cover"
                />
                <span className="block p-4">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[16px] font-bold">{t.name}</span>
                    <span className={`${MONO} text-[11px] uppercase ${MUTED}`}>{t.level}</span>
                  </span>
                  <span className={`mt-1 block text-[14px] leading-relaxed ${MUTED}`}>{t.description}</span>
                  <span className="mt-3 inline-flex items-center gap-1 text-[14px] font-semibold text-brand">
                    {busy === t.id ? 'Opening…' : 'Open in the Design Studio'} <ArrowUpRight size={15} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-16 px-4 py-20 sm:px-6" aria-labelledby="faq-heading">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_2fr]">
        <SectionHead id="faq-heading" title="Questions" />
        <div className="divide-y divide-[#E4E0D6] border-y border-[#E4E0D6]">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold">
                {f.q}
                <Plus size={18} className="shrink-0 transition-transform group-open:rotate-45" aria-hidden />
              </summary>
              <p className={`mt-3 max-w-2xl text-[15px] leading-relaxed ${MUTED}`}>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const link = 'hover:text-brand';
  return (
    <footer className="border-t border-[#16191F] bg-[#16191F] px-4 py-12 text-white sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <img src="/logo-light.png" alt="modellio" className="h-[22px] w-auto" draggable={false} />
          <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-white/70">
            Make anything. Shape everything. Free 3D design for 3D printing, in your browser.
          </p>
        </div>
        <nav aria-label="Tools">
          <h2 className={`${MONO} mb-3 text-[12px] uppercase tracking-[0.06em] text-white/60`}>Tools</h2>
          <ul className="space-y-2 text-[14px]">
            <li>
              <StudioLink to="design" className={link}>
                Design Studio
              </StudioLink>
            </li>
            {MAKERS.map((m) => (
              <li key={m.id}>
                <StudioLink to={m.studio!} className={link}>
                  {m.name}
                </StudioLink>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Coming soon">
          <h2 className={`${MONO} mb-3 text-[12px] uppercase tracking-[0.06em] text-white/60`}>Coming soon</h2>
          <ul className="space-y-2 text-[14px] text-white/70">
            {COMING_SOON.map((m) => (
              <li key={m.id}>{m.name}</li>
            ))}
          </ul>
        </nav>
      </div>
      <p className={`${MONO} mx-auto mt-10 max-w-6xl border-t border-white/15 pt-6 text-[12px] text-white/60`}>
        © {new Date().getFullYear()} MODELLIO
      </p>
    </footer>
  );
}
