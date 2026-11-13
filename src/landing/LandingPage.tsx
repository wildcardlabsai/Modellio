import { useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Cpu,
  Download,
  Lock,
  MonitorSmartphone,
  Sparkles,
  Box,
  Scissors,
  Menu,
  X,
} from 'lucide-react';
import { useStudio, studioUrl, type StudioId } from '@/app/studio';
import { useProjects } from '@/store/projectStore';
import { TEMPLATES, type Template } from '@/templates/templates';
import { AUDIENCES, COMING_SOON, DESIGN_FEATURES, FAQ, LIVE_STUDIOS, SPLIT_FEATURES, STEPS } from './content';

/** Navigate inside the app (keeps a real href so links can be opened in a new tab). */
function StudioLink({
  to,
  className,
  children,
  label,
}: {
  to: Exclude<StudioId, 'home'>;
  className: string;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <a
      href={studioUrl(to)}
      aria-label={label}
      className={className}
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

const PRIMARY =
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-[15px] font-semibold text-white shadow-sm hover:bg-brand-600';
const SECONDARY =
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[#d0d5dd] bg-white px-5 text-[15px] font-semibold text-ink hover:bg-[#f9fafb]';

const NAV = [
  { href: '#studios', label: 'Studios' },
  { href: '#features', label: 'Features' },
  { href: '#split', label: 'Split Studio' },
  { href: '#templates', label: 'Templates' },
  { href: '#faq', label: 'FAQ' },
];

export function LandingPage() {
  return (
    <div className="h-full overflow-y-auto scroll-smooth bg-white text-ink" data-testid="landing">
      <Header />
      <main id="main">
        <Hero />
        <TrustStrip />
        <Studios />
        <DesignFeatures />
        <SplitSection />
        <HowItWorks />
        <Templates />
        <Audiences />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <a href="/" className="flex shrink-0 items-center" aria-label="Modellio home">
          <img src="/logo-dark.png" alt="modellio" className="h-[26px] w-auto" draggable={false} />
        </a>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Page sections">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-lg px-3 py-2 text-[14px] font-medium text-[#475467] hover:bg-[#f2f4f7] hover:text-ink"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex-1" />
        <StudioLink
          to="design"
          className="hidden h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-600 sm:inline-flex"
        >
          Open Design Studio <ArrowRight size={16} />
        </StudioLink>
        <button
          type="button"
          className="rounded-lg p-2 text-ink hover:bg-[#f2f4f7] md:hidden"
          aria-expanded={open}
          aria-controls="landing-mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {open && (
        <nav id="landing-mobile-nav" className="border-t border-line bg-white px-4 pb-4 pt-2 md:hidden" aria-label="Page sections">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-[15px] font-medium text-[#344054] hover:bg-[#f2f4f7]"
            >
              {n.label}
            </a>
          ))}
          <StudioLink to="design" className={`${PRIMARY} mt-2 w-full`}>
            Open Design Studio <ArrowRight size={16} />
          </StudioLink>
        </nav>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden" aria-labelledby="hero-heading">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_0%,#dbe6fd_0%,transparent_70%)]"
        aria-hidden
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:pb-24 lg:pt-20">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-[13px] font-semibold text-brand">
            <Sparkles size={14} /> New: Split Studio for multi-colour 3MF files
          </p>
          <h1 id="hero-heading" className="text-[40px] font-extrabold leading-[1.05] tracking-tight sm:text-[56px]">
            Make anything.
            <br />
            <span className="text-brand">Shape everything.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[18px] leading-relaxed text-[#475467]">
            MODELLIO is a free 3D design studio that runs in your browser. Build real, print-ready parts from simple shapes, measured to the
            millimetre. No install, no account and no learning curve.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <StudioLink to="design" className={PRIMARY}>
              <Box size={18} /> Start designing
            </StudioLink>
            <StudioLink to="split" className={SECONDARY}>
              <Scissors size={18} /> Split a 3MF file
            </StudioLink>
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-[#475467]">
            {['Free to use', 'Works on desktop and iPad', 'Exports STL, OBJ and 3MF'].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check size={16} className="text-brand" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <BrowserFrame src="/landing/design-studio.jpg" alt="The MODELLIO Design Studio with a desk organiser being modelled" eager />
      </div>
    </section>
  );
}

function BrowserFrame({ src, alt, eager }: { src: string; alt: string; eager?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_60px_-20px_rgb(16_24_40/0.35)]">
      <div className="flex h-8 items-center gap-1.5 border-b border-line bg-[#f9fafb] px-3" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-[#f97066]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#fdb022]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#32d583]" />
      </div>
      <img src={src} alt={alt} width={1600} height={1000} loading={eager ? 'eager' : 'lazy'} className="block h-auto w-full" />
    </div>
  );
}

function TrustStrip() {
  const items = [
    { Icon: MonitorSmartphone, text: 'Runs in your browser' },
    { Icon: Lock, text: 'Your files stay on your device' },
    { Icon: Cpu, text: 'Real watertight geometry' },
    { Icon: Download, text: 'Works with any slicer' },
  ];
  return (
    <section className="border-y border-line bg-[#f9fafb]" aria-label="Highlights">
      <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-4 py-6 sm:px-6 lg:grid-cols-4">
        {items.map(({ Icon, text }) => (
          <li key={text} className="flex items-center gap-2.5 text-[14px] font-medium text-[#344054]">
            <Icon size={18} className="shrink-0 text-brand" /> {text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionHeading({ id, eyebrow, title, body }: { id: string; eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.12em] text-brand">{eyebrow}</p>
      <h2 id={id} className="text-[30px] font-extrabold leading-tight tracking-tight sm:text-[38px]">
        {title}
      </h2>
      {body && <p className="mt-4 text-[17px] leading-relaxed text-[#475467]">{body}</p>}
    </div>
  );
}

function Studios() {
  return (
    <section id="studios" className="scroll-mt-16 px-4 py-20 sm:px-6" aria-labelledby="studios-heading">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          id="studios-heading"
          eyebrow="Studios"
          title="One home for everything you print"
          body="Each studio is built for one job. Use the Design Studio for anything you can imagine, or a focused studio to get a common job done in minutes."
        />
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {LIVE_STUDIOS.map((s) => (
            <article
              key={s.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-panel"
              data-testid={`studio-card-${s.id}`}
            >
              {s.image && (
                <img
                  src={s.image}
                  alt={`${s.name} screenshot`}
                  width={1600}
                  height={1000}
                  loading="lazy"
                  className="aspect-[16/10] w-full border-b border-line object-cover object-top"
                />
              )}
              <div className="flex flex-1 flex-col p-6">
                <div className="mb-2 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand">
                    <s.Icon size={19} />
                  </span>
                  <h3 className="text-[20px] font-bold">{s.name}</h3>
                  {s.badge && (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                      {s.badge}
                    </span>
                  )}
                  <span className="ml-auto rounded-full bg-[#ecfdf3] px-2.5 py-0.5 text-[12px] font-semibold text-[#067647]">
                    Available now
                  </span>
                </div>
                <p className="text-[15px] font-semibold text-[#344054]">{s.tagline}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-[#475467]">{s.description}</p>
                <ul className="mt-4 space-y-1.5">
                  {s.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-[14px] text-[#344054]">
                      <Check size={16} className="shrink-0 text-brand" /> {p}
                    </li>
                  ))}
                </ul>
                <div className="flex-1" />
                <StudioLink to={s.studio!} className={`${PRIMARY} mt-6 self-start`}>
                  Open {s.name} <ArrowRight size={16} />
                </StudioLink>
              </div>
            </article>
          ))}
        </div>

        <h3 className="mb-5 mt-16 flex items-center gap-2 text-[20px] font-bold" id="coming-soon">
          <Clock size={20} className="text-brand" /> Coming soon
        </h3>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-labelledby="coming-soon">
          {COMING_SOON.map((s) => (
            <li key={s.id} className="rounded-2xl border border-dashed border-[#d0d5dd] bg-[#fcfcfd] p-5" data-testid={`soon-card-${s.id}`}>
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[#475467] shadow-sm ring-1 ring-line">
                  <s.Icon size={19} />
                </span>
                <h4 className="text-[16px] font-bold">{s.name}</h4>
                <span className="ml-auto rounded-full bg-[#f2f4f7] px-2.5 py-0.5 text-[12px] font-semibold text-[#475467]">
                  Coming soon
                </span>
              </div>
              <p className="text-[14px] font-semibold text-[#344054]">{s.tagline}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-[#475467]">{s.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FeatureGrid({
  items,
}: {
  items: { Icon: React.ComponentType<{ size?: number; className?: string }>; title: string; body: string; soon?: boolean }[];
}) {
  return (
    <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(({ Icon, title, body, soon }) => (
        <li key={title}>
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand">
            <Icon size={20} />
          </span>
          <h3 className="flex items-center gap-2 text-[16px] font-bold">
            {title}
            {soon && <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-[11px] font-semibold text-[#475467]">Coming soon</span>}
          </h3>
          <p className="mt-1.5 text-[14px] leading-relaxed text-[#475467]">{body}</p>
        </li>
      ))}
    </ul>
  );
}

function DesignFeatures() {
  return (
    <section id="features" className="scroll-mt-16 bg-[#f9fafb] px-4 py-20 sm:px-6" aria-labelledby="features-heading">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          id="features-heading"
          eyebrow="Design Studio"
          title="Simple enough for a first model. Precise enough for a real part."
          body="Every object is solid geometry with real dimensions, so what you see on screen is exactly what comes off the printer."
        />
        <FeatureGrid items={DESIGN_FEATURES} />
        <div className="mt-12 text-center">
          <StudioLink to="design" className={PRIMARY}>
            Open the Design Studio <ArrowRight size={16} />
          </StudioLink>
        </div>
      </div>
    </section>
  );
}

function SplitSection() {
  return (
    <section id="split" className="scroll-mt-16 px-4 py-20 sm:px-6" aria-labelledby="split-heading">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <BrowserFrame src="/landing/split-studio.jpg" alt="Split Studio showing the colours found in a multi-colour 3MF file" />
        <div>
          <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.12em] text-brand">Split Studio</p>
          <h2 id="split-heading" className="text-[30px] font-extrabold leading-tight tracking-tight sm:text-[38px]">
            Multi-colour designs on a single-colour printer
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-[#475467]">
            Found a multi-colour model you love but only have one nozzle? Open its 3MF in Split Studio. It reads the colours exactly as your
            slicer would, including filament slots and painted areas, and shows each colour as its own part with real dimensions.
          </p>
          <div className="mt-8">
            <FeatureList />
          </div>
          <StudioLink to="split" className={`${PRIMARY} mt-8`}>
            <Scissors size={18} /> Open Split Studio
          </StudioLink>
          <p className="mt-3 text-[13px] text-[#667085]">Files are processed on your device and never uploaded.</p>
        </div>
      </div>
    </section>
  );
}

function FeatureList() {
  return (
    <ul className="grid gap-5 sm:grid-cols-2">
      {SPLIT_FEATURES.map(({ Icon, title, body, soon }) => (
        <li key={title} className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand">
            <Icon size={18} />
          </span>
          <div>
            <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
              {title}
              {soon && <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-[11px] font-semibold text-[#475467]">Coming soon</span>}
            </h3>
            <p className="mt-0.5 text-[14px] leading-relaxed text-[#475467]">{body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function HowItWorks() {
  return (
    <section className="bg-navy px-4 py-20 text-white sm:px-6" aria-labelledby="how-heading">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.12em] text-[#93b4f8]">How it works</p>
          <h2 id="how-heading" className="text-[30px] font-extrabold leading-tight tracking-tight sm:text-[38px]">
            From idea to printer in three steps
          </h2>
        </div>
        <ol className="grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-2xl bg-navy-2 p-6 ring-1 ring-white/10">
              <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand text-[16px] font-bold">{i + 1}</span>
              <h3 className="text-[18px] font-bold">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-white/75">{s.body}</p>
            </li>
          ))}
        </ol>
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
    <section id="templates" className="scroll-mt-16 px-4 py-20 sm:px-6" aria-labelledby="templates-heading">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          id="templates-heading"
          eyebrow="Templates"
          title="Start from something useful"
          body="Every template is built from ordinary shapes, so you can resize it, change it or take it apart to see how it works."
        />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => void open(t)}
                disabled={busy !== null}
                className="group block w-full overflow-hidden rounded-2xl border border-line bg-white text-left shadow-panel transition-shadow hover:shadow-float disabled:opacity-70"
                aria-label={`Open the ${t.name} template in the Design Studio`}
              >
                <img
                  src={`/templates/${t.id}.jpg`}
                  alt=""
                  width={320}
                  height={200}
                  loading="lazy"
                  className="aspect-[16/10] w-full object-cover"
                />
                <span className="block p-4">
                  <span className="flex items-center gap-2">
                    <span className="text-[16px] font-bold">{t.name}</span>
                    <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-[11px] font-semibold text-[#475467]">{t.level}</span>
                  </span>
                  <span className="mt-1 block text-[14px] leading-relaxed text-[#475467]">{t.description}</span>
                  <span className="mt-3 inline-flex items-center gap-1 text-[14px] font-semibold text-brand">
                    {busy === t.id ? 'Opening…' : 'Use this template'}{' '}
                    <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
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

function Audiences() {
  return (
    <section className="bg-[#f9fafb] px-4 py-20 sm:px-6" aria-labelledby="who-heading">
      <div className="mx-auto max-w-6xl">
        <SectionHeading id="who-heading" eyebrow="Who it's for" title="Made for people who make things" />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {AUDIENCES.map((a) => (
            <li key={a.title} className="rounded-2xl bg-white p-6 shadow-panel ring-1 ring-line">
              <h3 className="text-[17px] font-bold">{a.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#475467]">{a.body}</p>
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
      <div className="mx-auto max-w-3xl">
        <SectionHeading id="faq-heading" eyebrow="FAQ" title="Questions, answered" />
        <div className="divide-y divide-line rounded-2xl border border-line">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold">
                {f.q}
                <ChevronDown size={18} className="shrink-0 text-[#667085] transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-[#475467]">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-4 pb-20 sm:px-6" aria-labelledby="cta-heading">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-brand px-6 py-14 text-center text-white sm:px-12">
        <h2 id="cta-heading" className="text-[30px] font-extrabold leading-tight tracking-tight sm:text-[40px]">
          Your next print starts here
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-white/85">
          Open the Design Studio and make your first part in minutes. It’s free.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <StudioLink
            to="design"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-[15px] font-semibold text-brand hover:bg-brand-50"
          >
            <Box size={18} /> Start designing
          </StudioLink>
          <StudioLink
            to="split"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold text-white ring-1 ring-white/60 hover:bg-white/10"
          >
            <Scissors size={18} /> Split a 3MF file
          </StudioLink>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line bg-white px-4 py-12 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <img src="/logo-dark.png" alt="modellio" className="h-[24px] w-auto" draggable={false} />
          <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-[#475467]">
            Make anything. Shape everything. Free 3D design for makers, in your browser.
          </p>
        </div>
        <nav aria-label="Studios">
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-[#667085]">Studios</h2>
          <ul className="space-y-2 text-[14px]">
            <li>
              <StudioLink to="design" className="text-[#344054] hover:text-brand">
                Design Studio
              </StudioLink>
            </li>
            <li>
              <StudioLink to="split" className="text-[#344054] hover:text-brand">
                Split Studio
              </StudioLink>
            </li>
            <li>
              <StudioLink to="cookie" className="text-[#344054] hover:text-brand">
                Cookie Cutter & Stamp Maker
              </StudioLink>
            </li>
            {COMING_SOON.map((s) => (
              <li key={s.id} className="text-[#667085]">
                {s.name} <span className="text-[12px]">(coming soon)</span>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Explore">
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-[#667085]">Explore</h2>
          <ul className="space-y-2 text-[14px]">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} className="text-[#344054] hover:text-brand">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="mx-auto mt-10 max-w-6xl border-t border-line pt-6 text-[13px] text-[#667085]">© {new Date().getFullYear()} MODELLIO</p>
    </footer>
  );
}
