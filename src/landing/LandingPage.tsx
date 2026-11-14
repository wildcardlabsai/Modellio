import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Boxes,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Menu,
  PlayCircle,
  Printer,
  Sparkles,
  Users,
  X,
  Check,
  Type,
  ImageUp,
  Cog,
  Package,
  FlipVertical2,
  ScanSearch,
  Sun,
  Wrench,
  Spline,
  Layers3,
  FileBox,
} from 'lucide-react';
import { useProjects } from '@/store/projectStore';
import { MAKER_ENTRIES, TOOL_ENTRIES } from '@/platform/catalog';
import { SectionHeading, StudioLink, buttonClass } from '@/components/ui/platform';
import { AccountButton } from '@/components/layout/AccountButton';
import { cloudConfigured } from '@/cad/serialization/supabaseRepository';
import { FAQ } from './content';

const TOOL_ICONS: Record<string, typeof Type> = {
  text: Type,
  svg: ImageUp,
  gear: Cog,
  box: Package,
  underside: FlipVertical2,
  print: ScanSearch,
  fillet: Spline,
  loft: Layers3,
  step: FileBox,
  lithophane: Sun,
  thread: Wrench,
};

/** Open the Design Studio on its template gallery. */
const openTemplates = () => useProjects.getState().setView('templates');

/**
 * The MODELLIO landing page: what it is, the specialist makers, the Design Studio, the tools
 * that exist today, and how to start. Every link goes somewhere real.
 */
export function LandingPage() {
  const [overview, setOverview] = useState(false);
  return (
    <div className="bg-aurora dark-scroll h-full overflow-y-auto scroll-smooth" data-testid="landing">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-night-950"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" className="overflow-x-clip">
        <Hero onOverview={() => setOverview(true)} />
        <MakersSection />
        <StudioSection />
        <ToolsSection />
        <WhySection />
        <PricingSection />
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
      {overview && <OverviewDialog onClose={() => setOverview(false)} />}
    </div>
  );
}

const NAV: { label: string; href?: string; studio?: 'design' | 'dashboard'; before?: () => void }[] = [
  { label: 'Home', href: '#top' },
  { label: 'Makers', href: '#makers' },
  { label: 'Design Studio', studio: 'design' },
  { label: 'Tools', href: '#tools' },
  { label: 'Explore', studio: 'design', before: openTemplates },
  { label: 'Pricing', href: '#pricing' },
];

function NavItem({ item, onDone, className }: { item: (typeof NAV)[number]; onDone?: () => void; className: string }) {
  if (item.studio)
    return (
      <StudioLink
        to={item.studio}
        className={className}
        before={() => {
          item.before?.();
          onDone?.();
        }}
      >
        {item.label}
      </StudioLink>
    );
  return (
    <a href={item.href} className={className} onClick={onDone}>
      {item.label}
    </a>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header id="top" className="sticky top-0 z-30 border-b border-white/5 bg-night-950/75 px-4 backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6">
        <a href="/" aria-label="Modellio home" className="flex shrink-0 items-center">
          <img src="/logo-light.png" alt="modellio" className="h-[26px] w-auto" draggable={false} />
        </a>
        <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((n) => (
            <NavItem
              key={n.label}
              item={n}
              className="rounded-lg px-3 py-2 text-[14px] font-medium text-haze transition-colors hover:bg-white/5 hover:text-white"
            />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {cloudConfigured() && (
            <span className="hidden sm:block">
              <AccountButton />
            </span>
          )}
          <span className="hidden sm:block">
            <StudioLink to="dashboard" className={buttonClass('primary', 'sm')} testId="get-started">
              Get Started Free
            </StudioLink>
          </span>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-fog hover:bg-white/10 lg:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {open && (
        <nav
          id="mobile-menu"
          aria-label="Mobile"
          className="mx-auto max-w-7xl border-t border-white/10 pb-4 pt-2 lg:hidden"
          data-testid="mobile-menu"
        >
          {NAV.map((n) => (
            <NavItem
              key={n.label}
              item={n}
              onDone={() => setOpen(false)}
              className="block rounded-lg px-3 py-3 text-[16px] font-medium text-fog hover:bg-white/5"
            />
          ))}
          <StudioLink to="dashboard" className={buttonClass('primary', 'md', 'mt-3 w-full')}>
            Get Started Free
          </StudioLink>
        </nav>
      )}
    </header>
  );
}

const HERO_VISUALS = [
  { src: '/landing/hero-keyring.webp', alt: 'A personalised two-colour keyring', label: 'Keyring', className: 'col-start-1 row-start-1' },
  { src: '/landing/hero-vase.webp', alt: 'A twisted sculptural vase', label: 'Vase', className: 'col-start-2 row-span-2 row-start-1' },
  { src: '/landing/hero-sign.webp', alt: 'A custom house-number sign', label: 'Sign', className: 'col-start-1 row-start-2' },
  { src: '/landing/hero-planter.webp', alt: 'A ribbed planter with a saucer', label: 'Planter', className: 'col-span-2 row-start-3' },
];

function Hero({ onOverview }: { onOverview: () => void }) {
  return (
    <section className="relative px-4 pb-20 pt-14 sm:px-6 lg:pb-28 lg:pt-20" aria-labelledby="hero-title">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <p className="inline-flex items-center gap-2 rounded-pill border border-violet-400/30 bg-violet/10 px-3.5 py-1.5 text-[13px] font-medium text-violet-300">
            <Sparkles size={14} aria-hidden /> Design · Create · Customise · 3D Print
          </p>
          <h1 id="hero-title" className="mt-6">
            <span className="text-gradient block text-[56px] font-extrabold leading-none tracking-tight sm:text-[76px] lg:text-[88px]">
              MODELLIO
            </span>
            <span className="mt-4 block text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[38px]">
              The Complete 3D Creation Platform
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-haze sm:text-[18px]">
            Create, customise and design amazing 3D models with powerful makers, a full design studio and professional tools — all in your
            browser.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <StudioLink to="dashboard" className={buttonClass('primary', 'lg')} testId="hero-get-started">
              Get Started Free <ArrowRight size={18} />
            </StudioLink>
            <button type="button" onClick={onOverview} className={buttonClass('secondary', 'lg')}>
              <PlayCircle size={19} /> Watch Overview
            </button>
          </div>
          <p className="mt-5 text-[13px] text-mist">Free · No install · No account needed</p>
        </div>
        <div className="relative grid grid-cols-2 grid-rows-[repeat(3,minmax(0,auto))] gap-4 overflow-visible" data-testid="hero-visuals">
          <div
            className="pointer-events-none absolute -inset-4 -z-10 rounded-[3rem] sm:-inset-8 bg-[radial-gradient(closest-side,rgb(124_58_237/0.28),transparent)]"
            aria-hidden
          />
          {HERO_VISUALS.map((v, i) => (
            <figure key={v.label} className={`card-night flex items-center justify-center overflow-hidden p-3 ${v.className}`}>
              <img
                src={v.src}
                alt={v.alt}
                className="float-slow max-h-[260px] w-full object-contain drop-shadow-[0_18px_30px_rgba(0,0,0,0.45)]"
                style={{ animationDelay: `${i * -1.7}s` }}
                draggable={false}
              />
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function MakersSection() {
  return (
    <section id="makers" className="scroll-mt-20 px-4 py-20 sm:px-6" aria-labelledby="makers-title">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="makers-title"
          eyebrow="Makers"
          title="Specialist Makers"
          intro="Create ready-to-print models in minutes with our dedicated makers."
        />
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MAKER_ENTRIES.map((m) => (
            <li key={m.id}>
              <StudioLink
                to={m.studio}
                className="card-night card-night-hover group flex h-full flex-col overflow-hidden"
                testId={`studio-card-${m.id}`}
                label={`Open ${m.name}`}
              >
                <div className="flex h-48 items-center justify-center bg-[radial-gradient(closest-side,rgb(59_130_246/0.16),transparent)] p-4">
                  <img
                    src={m.image}
                    alt=""
                    className="max-h-full w-auto object-contain drop-shadow-[0_14px_24px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:scale-[1.04]"
                    draggable={false}
                  />
                </div>
                <div className="flex flex-1 flex-col p-5 pt-2">
                  <h3 className="text-[19px] font-semibold text-white">{m.name}</h3>
                  <p className="mt-1.5 flex-1 text-[14px] leading-relaxed text-haze">{m.line}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-violet-300 group-hover:text-white">
                    Open maker <ArrowRight size={15} />
                  </span>
                </div>
              </StudioLink>
            </li>
          ))}
        </ul>
        <div className="mt-10 text-center">
          <StudioLink to="dashboard" className={buttonClass('secondary', 'md')}>
            Explore All Makers <ArrowRight size={16} />
          </StudioLink>
        </div>
      </div>
    </section>
  );
}

const STUDIO_BENEFITS = [
  'Build from scratch or customise existing models.',
  'Precise modelling with sketch, extrude and more.',
  'Edit, combine and refine with advanced tools.',
  'Prepare and export models for 3D printing.',
];

function StudioSection() {
  return (
    <section id="design-studio" className="scroll-mt-20 px-4 py-20 sm:px-6" aria-labelledby="studio-title">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[0.9fr_1.4fr]">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-violet-300">Design Studio</p>
          <h2 id="studio-title" className="mt-2 text-[32px] font-bold leading-tight tracking-tight text-white sm:text-[40px]">
            The MODELLIO Design Studio
          </h2>
          <p className="mt-3 text-[17px] leading-relaxed text-haze">
            A powerful, flexible 3D modelling environment for anything you can imagine.
          </p>
          <ul className="mt-6 space-y-3">
            {STUDIO_BENEFITS.map((b) => (
              <li key={b} className="flex gap-3 text-[15px] text-fog">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-electric/20 text-electric-300">
                  <Check size={13} aria-hidden />
                </span>
                {b}
              </li>
            ))}
          </ul>
          <StudioLink to="design" className={buttonClass('primary', 'lg', 'mt-8')} testId="open-design-studio">
            Open Design Studio <ArrowRight size={18} />
          </StudioLink>
        </div>
        <figure className="card-night overflow-hidden p-2" data-testid="studio-card-design">
          <img
            src="/landing/design-studio.jpg"
            alt="The MODELLIO Design Studio with a model, the shape library and the inspector"
            className="w-full rounded-[0.9rem]"
          />
        </figure>
      </div>
    </section>
  );
}

function ToolsSection() {
  return (
    <section id="tools" className="scroll-mt-20 px-4 py-20 sm:px-6" aria-labelledby="tools-title">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="tools-title"
          eyebrow="Tools"
          title="Powerful Design Tools"
          intro="Focused tools inside the Design Studio for the jobs that come up again and again."
        />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TOOL_ENTRIES.map((t) => {
            const Icon = TOOL_ICONS[t.id] ?? Boxes;
            const body = (
              <>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet/25 to-electric/25 text-violet-300">
                  <Icon size={21} aria-hidden />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold text-white">{t.name}</h3>
                <p className="mt-1 flex-1 text-[14px] leading-relaxed text-haze">{t.line}</p>
                <span className={`mt-4 text-[12px] font-medium ${t.studio ? 'text-electric-300' : 'text-mist'}`}>
                  {t.studio ? t.where : 'Coming soon'}
                </span>
              </>
            );
            return (
              <li key={t.id} data-testid={t.studio ? `tool-${t.id}` : `soon-card-${t.id}`}>
                {t.studio ? (
                  <StudioLink
                    to={t.studio}
                    className="card-night card-night-hover flex h-full flex-col p-5"
                    label={`${t.name}: ${t.where}`}
                  >
                    {body}
                  </StudioLink>
                ) : (
                  <div className="card-night flex h-full flex-col p-5 opacity-70" aria-disabled="true">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

const WHY = [
  {
    Icon: Boxes,
    title: 'All in One Platform',
    text: 'Makers, a full design studio and print tools share one project system, so nothing gets stuck in one place.',
  },
  {
    Icon: GraduationCap,
    title: 'Beginner Friendly',
    text: 'Start from a template or a maker; every size is a number you can type, and every change can be undone.',
  },
  {
    Icon: Printer,
    title: 'Designed for 3D Printing',
    text: 'Closed solids, real millimetres, print checks, colours kept in 3MF, and parts laid out for your plate.',
  },
  {
    Icon: Users,
    title: 'For Everyone',
    text: 'Gifts and keyrings, signs and planters, enclosures and replacement parts — from your first print onwards.',
  },
];

function WhySection() {
  return (
    <section id="why" className="scroll-mt-20 px-4 py-20 sm:px-6" aria-labelledby="why-title">
      <div className="mx-auto max-w-7xl">
        <SectionHeading id="why-title" title="Why Choose MODELLIO?" />
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {WHY.map(({ Icon, title, text }) => (
            <li key={title} className="card-night p-6">
              <Icon size={26} className="text-electric-400" aria-hidden />
              <h3 className="mt-4 text-[17px] font-semibold text-white">{title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-haze">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section id="pricing" className="scroll-mt-20 px-4 py-20 sm:px-6" aria-labelledby="pricing-title">
      <div className="mx-auto max-w-3xl">
        <SectionHeading
          id="pricing-title"
          eyebrow="Pricing"
          title="Free while we build"
          intro="Every maker and tool on this page is free to use. No install, no card, no account needed."
        />
        <div className="card-night mt-10 p-7 sm:p-9">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[15px] font-semibold text-violet-300">Free</p>
              <p className="mt-1 text-[44px] font-extrabold leading-none text-white">£0</p>
            </div>
            <StudioLink to="dashboard" className={buttonClass('primary', 'md')}>
              Get Started Free
            </StudioLink>
          </div>
          <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
            {[
              'All makers and the Design Studio',
              'STL, OBJ and 3MF export',
              'Projects saved in your browser',
              'Version history and share links',
            ].map((f) => (
              <li key={f} className="flex gap-2.5 text-[14px] text-fog">
                <Check size={16} className="mt-0.5 shrink-0 text-electric-400" aria-hidden /> {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-20 px-4 py-20 sm:px-6" aria-labelledby="faq-title">
      <div className="mx-auto max-w-3xl">
        <SectionHeading id="faq-title" title="Questions" />
        <div className="mt-10 space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="card-night group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold text-white">
                {f.q}
                <ChevronRight size={18} className="shrink-0 text-violet-300 transition-transform group-open:rotate-90" aria-hidden />
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-haze">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-4 py-20 sm:px-6" aria-labelledby="cta-title">
      <div className="card-night mx-auto max-w-5xl overflow-hidden px-6 py-14 text-center sm:px-12">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_16rem_at_50%_0%,rgb(124_58_237/0.25),transparent)]"
          aria-hidden
        />
        <h2 id="cta-title" className="relative text-[30px] font-bold tracking-tight text-white sm:text-[40px]">
          Ready to bring your ideas to life?
        </h2>
        <p className="relative mt-3 text-[17px] text-haze">Join MODELLIO today and start creating in 3D — for free.</p>
        <StudioLink to="dashboard" className={buttonClass('primary', 'lg', 'relative mt-8')}>
          Get Started Free <ArrowRight size={18} />
        </StudioLink>
      </div>
    </section>
  );
}

function FooterLink({
  children,
  href,
  studio,
  before,
}: {
  children: ReactNode;
  href?: string;
  studio?: 'design' | 'dashboard' | 'privacy' | 'licences';
  before?: () => void;
}) {
  const cls = 'text-[14px] text-haze hover:text-white';
  return studio ? (
    <StudioLink to={studio} className={cls} before={before}>
      {children}
    </StudioLink>
  ) : (
    <a href={href} className={cls}>
      {children}
    </a>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/5 px-4 pb-10 pt-14 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <img src="/logo-light.png" alt="modellio" className="h-[24px] w-auto" />
          <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-mist">
            Everything you need to create in 3D, from your first keyring to your next engineered product.
          </p>
        </div>
        <nav aria-label="Product">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-fog">Product</h2>
          <ul className="mt-3 space-y-2">
            <li>
              <FooterLink href="#makers">Makers</FooterLink>
            </li>
            <li>
              <FooterLink studio="design">Design Studio</FooterLink>
            </li>
            <li>
              <FooterLink href="#tools">Tools</FooterLink>
            </li>
            <li>
              <FooterLink href="#pricing">Pricing</FooterLink>
            </li>
          </ul>
        </nav>
        <nav aria-label="Resources">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-fog">Resources</h2>
          <ul className="mt-3 space-y-2">
            <li>
              <FooterLink studio="design" before={openTemplates}>
                Templates
              </FooterLink>
            </li>
            <li>
              <FooterLink href="#faq">Help &amp; FAQ</FooterLink>
            </li>
            <li>
              <FooterLink studio="dashboard">Dashboard</FooterLink>
            </li>
          </ul>
        </nav>
        <nav aria-label="Company">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-fog">Company</h2>
          <ul className="mt-3 space-y-2">
            <li>
              <FooterLink href="#why">About</FooterLink>
            </li>
            <li>
              <FooterLink studio="privacy">Privacy Policy</FooterLink>
              <FooterLink studio="licences">Open-source licences</FooterLink>
            </li>
          </ul>
        </nav>
      </div>
      <p className="mx-auto mt-12 max-w-7xl text-[13px] text-mist">© {new Date().getFullYear()} MODELLIO</p>
    </footer>
  );
}

const OVERVIEW = [
  {
    src: '/landing/keyring-maker.jpg',
    title: '1. Start with a maker',
    text: 'Pick a maker or a template and type your text. The maker does the fiddly geometry: holes, borders, colours.',
  },
  {
    src: '/landing/design-studio.jpg',
    title: '2. Refine in the Design Studio',
    text: 'Open a copy in the Design Studio to combine shapes, cut holes, add text and set every size in millimetres.',
  },
  {
    src: '/landing/vase-maker.jpg',
    title: '3. Shape anything',
    text: 'Drag a profile, twist it, add a pattern: every change rebuilds a real, closed solid you can print.',
  },
  {
    src: '/landing/split-studio.jpg',
    title: '4. Print it',
    text: 'Check overhangs and thin walls, split colours into parts, and export STL or 3MF for your slicer.',
  },
];

/** "Watch Overview": the workflow in four steps, shown with real screenshots of the app. */
function OverviewDialog({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % OVERVIEW.length), 6000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((v) => (v + 1) % OVERVIEW.length);
      if (e.key === 'ArrowLeft') setI((v) => (v + OVERVIEW.length - 1) % OVERVIEW.length);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const s = OVERVIEW[i];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="overview-title"
        className="surface-night w-full max-w-4xl overflow-hidden rounded-2xl border border-night-line bg-night-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="overview-dialog"
      >
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <h2 id="overview-title" className="text-[16px] font-semibold text-white">
            MODELLIO overview
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close overview"
            className="rounded-lg p-1.5 text-haze hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <img src={s.src} alt={s.title} className="aspect-[16/9] w-full bg-night-800 object-cover" />
        <div className="flex items-center gap-4 px-5 py-4">
          <button
            type="button"
            aria-label="Previous step"
            onClick={() => setI((i + OVERVIEW.length - 1) % OVERVIEW.length)}
            className="rounded-lg p-2 text-haze hover:bg-white/10"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1" aria-live="polite">
            <p className="text-[16px] font-semibold text-white">{s.title}</p>
            <p className="mt-0.5 text-[14px] text-haze">{s.text}</p>
          </div>
          <button
            type="button"
            aria-label="Next step"
            onClick={() => setI((i + 1) % OVERVIEW.length)}
            className="rounded-lg p-2 text-haze hover:bg-white/10"
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="flex justify-center gap-1.5 pb-4" aria-hidden>
          {OVERVIEW.map((o, k) => (
            <span key={o.title} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-6 bg-violet-400' : 'w-1.5 bg-white/20'}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
