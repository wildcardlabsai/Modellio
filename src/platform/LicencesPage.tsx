import { ArrowLeft } from 'lucide-react';
import { StudioLink } from '@/components/ui/platform';

/**
 * Open-source software MODELLIO is built with, and the notices their licences ask for. The
 * OpenCascade engine is LGPL: it is shipped unmodified as a separate WebAssembly file
 * (assets/replicad_single-*.wasm) that the app loads at run time, so it can be replaced.
 */
const LIBS: { name: string; use: string; licence: string; url: string }[] = [
  {
    name: 'Open CASCADE Technology (via replicad-opencascadejs)',
    use: 'Precise solids: fillet, chamfer, loft, sweep, STEP import and export',
    licence: 'GNU LGPL 2.1 with the Open CASCADE exception',
    url: 'https://github.com/Open-Cascade-SAS/OCCT',
  },
  { name: 'replicad', use: 'JavaScript interface to OpenCascade', licence: 'MIT', url: 'https://github.com/sgenoud/replicad' },
  { name: 'Manifold', use: 'Solid modelling, Booleans and meshes', licence: 'Apache 2.0', url: 'https://github.com/elalish/manifold' },
  { name: 'three.js', use: '3D rendering', licence: 'MIT', url: 'https://github.com/mrdoob/three.js' },
  { name: 'React Three Fiber and drei', use: '3D view components', licence: 'MIT', url: 'https://github.com/pmndrs/react-three-fiber' },
  { name: 'React', use: 'User interface', licence: 'MIT', url: 'https://github.com/facebook/react' },
  { name: 'opentype.js', use: 'Fonts for 3D text', licence: 'MIT', url: 'https://github.com/opentypejs/opentype.js' },
  { name: 'fflate', use: '3MF files and share links', licence: 'MIT', url: 'https://github.com/101arrowz/fflate' },
  { name: 'Zustand and Immer', use: 'Editor state and undo', licence: 'MIT', url: 'https://github.com/pmndrs/zustand' },
  { name: 'Lucide', use: 'Icons', licence: 'ISC', url: 'https://github.com/lucide-icons/lucide' },
];

export default function LicencesPage() {
  return (
    <div className="bg-aurora dark-scroll surface-night h-full overflow-y-auto" data-testid="licences">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <StudioLink to="home" className="inline-flex items-center gap-1.5 text-[14px] text-haze hover:text-white">
          <ArrowLeft size={16} /> Back to MODELLIO
        </StudioLink>
        <h1 className="mt-6 text-[36px] font-bold tracking-tight text-white">Open-source licences</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-haze">
          MODELLIO is built with these open-source projects. Thank you to everyone who works on them.
        </p>
        <ul className="mt-6 divide-y divide-white/10 rounded-2xl border border-white/10" data-testid="licence-list">
          {LIBS.map((l) => (
            <li key={l.name} className="px-4 py-3">
              <a href={l.url} target="_blank" rel="noreferrer" className="text-[15px] font-semibold text-white hover:underline">
                {l.name}
              </a>
              <p className="text-[13px] text-haze">
                {l.use} · <span className="text-mist">{l.licence}</span>
              </p>
            </li>
          ))}
        </ul>
        <section className="mt-8 space-y-3 text-[14px] leading-relaxed text-haze">
          <h2 className="text-[19px] font-semibold text-white">Open CASCADE Technology (LGPL)</h2>
          <p>
            The precise-solid engine is Open CASCADE Technology, compiled to WebAssembly by the replicad project. It is used unmodified and
            is delivered as its own file, downloaded the first time you use fillet, chamfer, loft, sweep or STEP. You may replace that file
            with your own build of the same library. Its source code is available from the{' '}
            <a className="text-white underline" href="https://github.com/Open-Cascade-SAS/OCCT" target="_blank" rel="noreferrer">
              Open CASCADE repository
            </a>{' '}
            and the build scripts from the{' '}
            <a className="text-white underline" href="https://github.com/sgenoud/replicad" target="_blank" rel="noreferrer">
              replicad repository
            </a>
            . The full licence text is the{' '}
            <a
              className="text-white underline"
              href="https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html"
              target="_blank"
              rel="noreferrer"
            >
              GNU Lesser General Public License, version 2.1
            </a>
            , with the{' '}
            <a className="text-white underline" href="https://dev.opencascade.org/resources/licensing" target="_blank" rel="noreferrer">
              Open CASCADE exception
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
