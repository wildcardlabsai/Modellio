import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Menu,
  PlayCircle,
  Users,
  X,
  Check,
  Type,
  ImageUp,
  Cog,
  Package,
  FlipVertical2,
  ScanSearch,
  Spline,
  Layers3,
  FileBox,
  Zap,
  Layers,
  Box,
} from 'lucide-react';
import { useProjects } from '@/store/projectStore';
import { MAKER_ENTRIES, TOOL_ENTRIES } from '@/platform/catalog';
import { StudioLink, buttonClass } from '@/components/ui/platform';
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
    <header id="top" className="sticky top-0 z-30 border-b border-white/5 bg-night-950/80 px-4 backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex h-[68px] max-w-7xl items-center gap-6">
        <a href="/" aria-label="Modellio home" className="flex shrink-0 items-center">
          <img src="/logo-light.png" alt="modellio" className="h-[28px] w-auto" draggable={false} />
        </a>
        <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((n, i) => (
            <NavItem
              key={n.label}
              item={n}
              className={`rounded-full px-4 py-2 text-[15px] font-medium transition-colors ${
                i === 0 ? 'bg-violet/15 text-white ring-1 ring-inset ring-violet-400/40' : 'text-haze hover:bg-white/5 hover:text-white'
              }`}
            />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {cloudConfigured() && (
            <span className="hidden sm:block">
              <AccountButton />
            </span>
          )}
          <span className="hidden sm:block">
            <StudioLink to="dashboard" className={buttonClass('primary', 'md')} testId="get-started">
              Get Started Free
            </StudioLink>
          </span>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-fog hover:bg-white/10 lg:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={24} /> : <Menu size={24} />}
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
              className="block rounded-xl px-3 py-3 text-[17px] font-medium text-fog hover:bg-white/5"
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

function Hero({ onOverview }: { onOverview: () => void }) {
  return (
    <section className="relative px-4 pb-8 pt-8 sm:px-6 lg:pb-12 lg:pt-10" aria-labelledby="hero-title">
      <div className="mx-auto grid max-w-7xl items-center gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-6">
        <div className="relative z-10">
          <p className="text-[15px] font-semibold tracking-wide text-violet-300 sm:text-[16px]">
            Design <span className="text-violet-400/70">•</span> Create <span className="text-violet-400/70">•</span> Customise{' '}
            <span className="text-violet-400/70">•</span> 3D Print
          </p>
          <h1 id="hero-title" className="mt-4">
            <span className="block text-[54px] font-extrabold leading-[0.95] tracking-tight text-white sm:text-[76px] lg:text-[88px]">
              MODELLIO
            </span>
            <span className="mt-3 block text-[30px] font-bold leading-[1.1] tracking-tight text-white sm:text-[40px] lg:text-[44px]">
              The Complete 3D Creation Platform
            </span>
          </h1>
          <p className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-haze sm:text-[18px]">
            Create, customise and design amazing 3D models with powerful makers, a full design studio and professional tools — all in your
            browser.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <StudioLink to="dashboard" className={buttonClass('primary', 'lg')} testId="hero-get-started">
              Get Started Free <ArrowRight size={18} />
            </StudioLink>
            <button
              type="button"
              onClick={onOverview}
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-violet-400/60 px-5 text-[16px] font-semibold text-white transition-colors hover:border-violet-300 hover:bg-violet/10"
            >
              <PlayCircle size={19} /> Watch Overview
            </button>
          </div>
          <p className="mt-5 text-[13px] text-mist">Free · No install · No account needed</p>
        </div>
        <div className="relative" data-testid="hero-visuals">
          <div
            className="pointer-events-none absolute inset-x-[-10%] inset-y-[-25%] -z-0 bg-[radial-gradient(closest-side,rgb(124_58_237/0.35),rgb(59_130_246/0.12)_55%,transparent)]"
            aria-hidden
          />
          <img
            src="/landing/art/modellio-hero-products.webp"
            alt="Things you can make with MODELLIO: a name keyring, a planter, a welcome sign and a twisted vase"
            width={1600}
            height={863}
            className="relative w-full object-contain drop-shadow-[0_30px_40px_rgba(0,0,0,0.5)]"
            draggable={false}
          />
        </div>
      </div>
    </section>
  );
}

/** A gentle tint behind each maker's product, as in the design. */
const MAKER_TINT: Record<string, string> = {
  keyring: 'from-violet-600/30',
  keytag: 'from-electric/20',
  sign: 'from-amber-600/20',
  vase: 'from-emerald-500/15',
  split: 'from-fuchsia-500/20',
  cookie: 'from-pink-500/20',
};

function MakersSection() {
  return (
    <section id="makers" className="scroll-mt-20 px-4 py-10 sm:px-6 lg:py-14" aria-labelledby="makers-title">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="makers-title" className="text-[32px] font-bold leading-tight tracking-tight text-white sm:text-[40px]">
              Specialist Makers
            </h2>
            <p className="mt-2 max-w-md text-[17px] leading-relaxed text-haze">
              Create ready-to-print models in minutes with our dedicated makers.
            </p>
          </div>
          <StudioLink
            to="dashboard"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-violet-400/60 px-4 text-[15px] font-semibold text-white hover:bg-violet/10"
          >
            Explore All Makers <ArrowRight size={16} />
          </StudioLink>
        </div>
        <ul className="mt-8 grid gap-5 min-[560px]:grid-cols-2 lg:grid-cols-3" data-testid="maker-grid">
          {MAKER_ENTRIES.map((m) => (
            <li key={m.id}>
              <StudioLink
                to={m.studio}
                className="group relative flex h-full flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-night-850/80 transition duration-200 hover:-translate-y-1 hover:border-violet-400/50 hover:shadow-[0_18px_50px_-12px_rgb(124_58_237/0.45)]"
                testId={`studio-card-${m.id}`}
                label={`Open ${m.name}`}
              >
                <div className={`relative aspect-[16/9] bg-gradient-to-b ${MAKER_TINT[m.id] ?? 'from-violet-600/20'} to-transparent`}>
                  {/* Absolutely placed so every card's image area is the same size, whatever the picture's shape. */}
                  <img
                    src={m.art ?? m.image}
                    alt=""
                    className="absolute inset-0 h-full w-full object-contain px-6 pb-1 pt-5 drop-shadow-[0_16px_24px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:scale-[1.04]"
                    draggable={false}
                    data-testid="maker-art"
                  />
                </div>
                <div className="flex flex-1 flex-col items-center px-5 pb-5 pt-3 text-center">
                  <h3 className="text-[19px] font-semibold text-white">{m.name}</h3>
                  <p className="mt-1.5 flex-1 text-[14px] leading-relaxed text-haze">{m.line}</p>
                  <span
                    className="mt-4 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-electric text-white shadow-[0_6px_18px_-4px_rgb(124_58_237/0.7)] transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  >
                    <ArrowRight size={17} />
                  </span>
                  <span className="sr-only">Open maker</span>
                </div>
              </StudioLink>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STUDIO_BENEFITS = [
  'Build from scratch or customise existing models',
  'Precise modelling with sketch, extrude, fillet and loft',
  'Edit, combine and refine with advanced tools',
  'Prepare and export models for 3D printing',
];

function StudioSection() {
  return (
    <section id="design-studio" className="scroll-mt-20 px-4 py-10 sm:px-6 lg:py-14" aria-labelledby="studio-title">
      <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[0.85fr_1.25fr] lg:gap-14">
        <div>
          <h2 id="studio-title" className="text-[34px] font-bold leading-[1.1] tracking-tight text-white sm:text-[44px]">
            The MODELLIO
            <br />
            Design Studio
          </h2>
          <p className="mt-4 text-[18px] leading-relaxed text-haze">
            A powerful, flexible 3D modelling environment for anything you can imagine.
          </p>
          <ul className="mt-6 space-y-3.5">
            {STUDIO_BENEFITS.map((b) => (
              <li key={b} className="flex gap-3 text-[16px] text-fog">
                <span className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-violet-600 text-white">
                  <Check size={14} strokeWidth={3} aria-hidden />
                </span>
                {b}
              </li>
            ))}
          </ul>
          <StudioLink to="design" className={buttonClass('primary', 'lg', 'mt-8')} testId="open-design-studio">
            Open Design Studio <ArrowRight size={18} />
          </StudioLink>
        </div>
        <figure className="relative" data-testid="studio-card-design">
          <div
            className="pointer-events-none absolute inset-[-12%] bg-[radial-gradient(closest-side,rgb(124_58_237/0.28),transparent)]"
            aria-hidden
          />
          {/* A laptop frame around a real screenshot of the Design Studio. */}
          <div className="relative rounded-[1.4rem] border border-white/15 bg-[#0b0f1d] p-[2.2%] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)]">
            <img
              src="/landing/design-studio-2026.jpg"
              alt="The MODELLIO Design Studio with a gear selected, the shape library and the inspector"
              width={1600}
              height={1000}
              className="w-full rounded-[0.6rem]"
            />
          </div>
          <div className="relative mx-[-4%] h-3 rounded-b-[1.2rem] bg-gradient-to-b from-[#c7cbd6] to-[#7c8294]" aria-hidden />
        </figure>
      </div>
    </section>
  );
}

const LIVE_TOOLS = TOOL_ENTRIES.filter((t) => t.studio);

function ToolsSection() {
  return (
    <section id="tools" className="scroll-mt-20 px-4 py-10 sm:px-6 lg:py-14" aria-labelledby="tools-title">
      <div className="mx-auto max-w-7xl">
        <div>
          <h2 id="tools-title" className="text-[32px] font-bold leading-tight tracking-tight text-white sm:text-[40px]">
            Powerful Design Tools
          </h2>
          <p className="mt-2 text-[17px] leading-relaxed text-haze">
            Specialised tools inside the Design Studio to take your ideas further.
          </p>
        </div>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LIVE_TOOLS.map((t) => {
            const Icon = TOOL_ICONS[t.id] ?? Boxes;
            return (
              <li key={t.id} data-testid={`tool-${t.id}`}>
                <StudioLink
                  to={t.studio!}
                  className="group flex h-full gap-4 rounded-2xl border border-white/10 bg-night-850/70 p-5 transition hover:border-violet-400/50 hover:bg-night-800"
                  label={`${t.name}: ${t.where}`}
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-600/15 text-violet-300 group-hover:text-white">
                    <Icon size={24} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[17px] font-semibold text-white">{t.name}</span>
                    <span className="mt-1 text-[14px] leading-relaxed text-haze">{t.line}</span>
                    <span className="mt-2 text-[12px] font-medium text-electric-300">{t.where}</span>
                  </span>
                </StudioLink>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

const WHY = [
  { Icon: Zap, title: 'All in One Platform', text: 'Makers, a design studio and print tools in one place, sharing one project system.' },
  { Icon: Layers, title: 'Beginner Friendly', text: 'Start from a template or a maker; type any size, undo any change.' },
  { Icon: Box, title: 'Designed for 3D Printing', text: 'Closed solids in real millimetres, print checks, and colours kept in 3MF.' },
  { Icon: Users, title: 'For Everyone', text: 'From first keyrings to enclosures and replacement parts.' },
];

function WhySection() {
  return (
    <section id="why" className="scroll-mt-20 px-4 py-10 sm:px-6 lg:py-14" aria-labelledby="why-title">
      <div className="mx-auto max-w-7xl">
        <h2 id="why-title" className="text-[32px] font-bold leading-tight tracking-tight text-white sm:text-[40px]">
          Why Choose MODELLIO?
        </h2>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
          {WHY.map(({ Icon, title, text }, i) => (
            <li key={title} className={`flex gap-4 ${i ? 'lg:border-l lg:border-white/10 lg:pl-6' : ''} lg:pr-6`}>
              <Icon size={34} strokeWidth={1.6} className="shrink-0 text-violet-400" aria-hidden />
              <div>
                <h3 className="text-[17px] font-semibold text-white">{title}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-haze">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section id="pricing" className="scroll-mt-20 px-4 py-10 sm:px-6 lg:py-12" aria-labelledby="pricing-title">
      <div className="mx-auto grid max-w-7xl items-center gap-8 rounded-[1.5rem] border border-white/10 bg-night-850/60 p-7 sm:p-10 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="text-[14px] font-semibold uppercase tracking-[0.16em] text-violet-300">Pricing</p>
          <h2 id="pricing-title" className="mt-2 text-[30px] font-bold tracking-tight text-white sm:text-[36px]">
            Free while we build
          </h2>
          <p className="mt-2 text-[16px] leading-relaxed text-haze">
            Every maker and tool on this page is free to use. No install, no card, no account needed.
          </p>
        </div>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <ul className="grid gap-2.5">
            {[
              'All makers and the Design Studio',
              'STL, OBJ, 3MF and STEP export',
              'Projects saved in your browser',
              'Version history and share links',
            ].map((f) => (
              <li key={f} className="flex gap-2.5 text-[15px] text-fog">
                <Check size={17} className="mt-0.5 shrink-0 text-violet-400" aria-hidden /> {f}
              </li>
            ))}
          </ul>
          <div className="shrink-0 text-left sm:text-right">
            <p className="text-[44px] font-extrabold leading-none text-white">£0</p>
            <StudioLink to="dashboard" className={buttonClass('primary', 'md', 'mt-3')}>
              Get Started Free
            </StudioLink>
          </div>
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-20 px-4 py-10 sm:px-6 lg:py-12" aria-labelledby="faq-title">
      <div className="mx-auto max-w-7xl">
        <h2 id="faq-title" className="text-center text-[30px] font-bold tracking-tight text-white sm:text-[36px]">
          Questions
        </h2>
        <div className="mt-8 grid items-start gap-3 lg:grid-cols-2">
          {FAQ.map((f) => (
            <details
              key={f.q}
              className="group rounded-2xl border border-white/10 bg-night-850/60 px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
            >
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
    <section className="px-4 py-10 sm:px-6 lg:py-12" aria-labelledby="cta-title">
      <div className="relative mx-auto flex max-w-7xl flex-col items-center gap-6 overflow-hidden rounded-[1.5rem] border border-violet-300/30 bg-gradient-to-r from-violet-700 via-violet-600 to-electric px-6 py-10 text-center shadow-[0_30px_80px_-30px_rgb(124_58_237/0.8)] sm:px-10 md:flex-row md:text-left">
        <span className="hidden h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white/10 md:flex" aria-hidden>
          <Box size={44} strokeWidth={1.5} className="text-white" />
        </span>
        <span className="hidden h-16 w-px bg-white/25 md:block" aria-hidden />
        <div className="flex-1">
          <h2 id="cta-title" className="text-[28px] font-bold tracking-tight text-white sm:text-[34px]">
            Ready to bring your ideas to life?
          </h2>
          <p className="mt-1.5 text-[17px] text-white/85">Join MODELLIO today and start creating in 3D — for free.</p>
        </div>
        <StudioLink
          to="dashboard"
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-white px-6 text-[16px] font-semibold text-violet-700 shadow-lg transition hover:bg-violet-50"
        >
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
  const cls = 'text-[15px] text-haze hover:text-white';
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
    <footer className="border-t border-white/10 px-4 pb-10 pt-12 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div>
          <img src="/logo-light.png" alt="modellio" className="h-[26px] w-auto" />
          <p className="mt-3 text-[15px] text-haze">The Complete 3D Creation Platform</p>
        </div>
        <nav aria-label="Product">
          <h2 className="text-[15px] font-semibold text-white">Product</h2>
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
          <h2 className="text-[15px] font-semibold text-white">Resources</h2>
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
          <h2 className="text-[15px] font-semibold text-white">Company</h2>
          <ul className="mt-3 space-y-2">
            <li>
              <FooterLink href="#why">About</FooterLink>
            </li>
            <li>
              <FooterLink studio="privacy">Privacy Policy</FooterLink>
            </li>
            <li>
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
