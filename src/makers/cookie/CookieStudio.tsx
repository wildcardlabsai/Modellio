import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { CircleAlert, CircleCheck, Download, FileUp, Info, Loader2, Maximize, PencilRuler, TriangleAlert } from 'lucide-react';
import { useCookie, readImageFile, type SourceTab } from './store';
import { SHAPES, type Poly } from './shapes';
import { svgOutlines } from './svg';
import type { CookieParams, CookiePart } from './geometry';
import { meshDataToGeometry } from '@/cad/kernel/meshData';
import { getKernel, initKernel } from '@/cad/kernel/kernel';
import { FONTS } from '@/cad/text/fonts';
import type { FontId } from '@/types/document';
import { NumberField } from '@/components/ui/NumberField';
import { Toggle } from '@/components/ui/Toggle';
import { Segmented } from '@/components/ui/Modal';
import { IconButton } from '@/components/ui/IconButton';
import { write3mf } from '@/cad/export/threemf';
import { writeBinaryStl } from '@/cad/export/writers';
import { useEditor } from '@/store/editorStore';
import { useStudio } from '@/app/studio';

const PART_COLOURS: Record<CookiePart['id'], string> = { cutter: '#2463EB', stamp: '#EC4899', handle: '#F59E0B' };
const section = 'border-b border-line p-4';
const heading = 'mb-2 text-[13px] font-semibold text-ink';

/**
 * Cookie Cutter & Stamp Maker: pick a shape, type a name or upload a picture, and get a
 * print-ready cutter, a matching stamp and a handle.
 */
export default function CookieStudio() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    (window as unknown as { modellioCookie: unknown }).modellioCookie = { store: useCookie };
    void initKernel();
    useCookie.getState().rebuild();
  }, []);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) void openFile(f);
  };
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-testid="cookie-studio"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Header />
      <div className="relative flex min-h-0 flex-1">
        <LeftPanel />
        <main className="relative min-w-0 flex-1" aria-label="Preview">
          <Preview />
        </main>
        <RightPanel />
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand bg-brand-50/80 text-[15px] font-semibold text-brand">
          Drop an SVG or picture to use it as the cookie shape
        </div>
      )}
    </div>
  );
}

async function openFile(file: File) {
  const st = useCookie.getState();
  try {
    if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
      const { polygons } = svgOutlines(await file.text());
      if (!polygons.length) throw new Error('This SVG has no filled shapes or lines to use.');
      st.setUpload({ kind: 'svg', name: file.name, polygons });
    } else if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
      st.setUpload(await readImageFile(file));
    } else {
      throw new Error(`"${file.name}" isn't an SVG or a picture.`);
    }
  } catch (e) {
    useCookie.setState({ error: (e as Error).message });
  }
}

function pickFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.svg,image/svg+xml,image/png,image/jpeg,image/webp';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void openFile(f);
  };
  input.click();
}

function Header() {
  const make = useCookie((s) => s.params.make);
  const setParams = useCookie((s) => s.setParams);
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-white px-3 sm:px-5">
      <h1 className="text-[14px] font-semibold text-ink">Cookie Cutter & Stamp Maker</h1>
      <div className="flex-1" />
      <div className="w-[260px]">
        <Segmented
          label="What to make"
          value={make}
          options={[
            { value: 'cutter', label: 'Cutter' },
            { value: 'stamp', label: 'Stamp' },
            { value: 'both', label: 'Both' },
          ]}
          onChange={(v) => setParams({ make: v })}
        />
      </div>
    </div>
  );
}

/** Outline thumbnail: the shape's filled outline, rendered from the kernel's cleaned polygons when available. */
function ShapeIcon({ polygons }: { polygons: Poly[] }) {
  const d = useMemo(() => {
    let polys = polygons;
    const k = getKernel();
    if (k) {
      const cs = new k.CrossSection(polygons, 'Positive');
      polys = cs.toPolygons() as Poly[];
      cs.delete();
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of polys)
      for (const [x, y] of p) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    const s = 32 / Math.max(maxX - minX, maxY - minY);
    const ox = (40 - (maxX - minX) * s) / 2;
    const oy = (40 - (maxY - minY) * s) / 2;
    return polys
      .map((p) => 'M' + p.map(([x, y]) => `${(ox + (x - minX) * s).toFixed(1)} ${(40 - oy - (y - minY) * s).toFixed(1)}`).join('L') + 'Z')
      .join('');
  }, [polygons]);
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden>
      <path d={d} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

function LeftPanel() {
  const tab = useCookie((s) => s.tab);
  const setTab = useCookie((s) => s.setTab);
  const p = useCookie((s) => s.params);
  const setParams = useCookie((s) => s.setParams);
  const [kernelReady, setKernelReady] = useState(!!getKernel());
  useEffect(() => {
    if (!kernelReady) void initKernel().then(() => setKernelReady(true));
  }, [kernelReady]);
  const num = (label: string, key: keyof CookieParams, min: number, max: number, step: number, decimals = 1) => (
    <label key={key} className="text-[12px] text-muted">
      {label}
      <NumberField
        ariaLabel={`${label} (mm)`}
        value={p[key] as number}
        min={min}
        max={max}
        step={step}
        decimals={decimals}
        suffix="mm"
        onCommit={(v) => setParams({ [key]: v })}
      />
    </label>
  );
  return (
    <aside
      className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-r border-line bg-white xl:w-[300px]"
      aria-label="Cookie design"
      data-testid="cookie-left"
    >
      <section className={section} aria-labelledby="cookie-design-heading">
        <h2 id="cookie-design-heading" className={heading}>
          Design
        </h2>
        <Segmented<SourceTab>
          label="Design source"
          value={tab}
          options={[
            { value: 'shape', label: 'Shape' },
            { value: 'text', label: 'Text' },
            { value: 'picture', label: 'Picture' },
          ]}
          onChange={setTab}
        />
        <div className="mt-3">
          {tab === 'shape' ? <ShapePicker key={String(kernelReady)} /> : tab === 'text' ? <TextInput /> : <PictureInput />}
        </div>
      </section>
      <section className={section} aria-labelledby="cookie-size-heading">
        <h2 id="cookie-size-heading" className={heading}>
          Size and outline
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {num('Cookie size', 'size', 20, 220, 5, 0)}
          {num('Outline margin', 'outline', 0, 20, 0.5)}
          {num('Smoothing', 'smoothing', 0, 5, 0.1)}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Size is the cookie's longest side. A margin draws a rounded outline around the design and joins separate letters.
        </p>
        <Toggle label="Mirror for printing (recommended)" checked={p.mirror} onChange={(v) => setParams({ mirror: v })} />
      </section>
      {p.make !== 'stamp' && (
        <section className={section} aria-labelledby="cookie-cutter-heading">
          <h2 id="cookie-cutter-heading" className={heading}>
            Cutter
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {num('Height', 'cutterHeight', 6, 40, 1, 0)}
            {num('Blade', 'blade', 0.4, 3, 0.1)}
            {num('Flange width', 'rimWidth', 0, 10, 0.5)}
            {num('Flange height', 'rimHeight', 0.6, 6, 0.2)}
          </div>
        </section>
      )}
      {p.make !== 'cutter' && (
        <section className="p-4" aria-labelledby="cookie-stamp-heading">
          <h2 id="cookie-stamp-heading" className={heading}>
            Stamp
          </h2>
          <p className="mb-1 text-[12px] text-muted">Pattern</p>
          <Segmented
            label="Stamp pattern"
            value={p.stampStyle}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'outline', label: 'Lines' },
              { value: 'filled', label: 'Filled' },
            ]}
            onChange={(v) => setParams({ stampStyle: v })}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            {num('Relief', 'reliefHeight', 0.6, 6, 0.2)}
            {num('Line width', 'lineWidth', 0.6, 5, 0.1)}
            {num('Plate', 'plateThickness', 2, 10, 0.5)}
            {num('Gap to cutter', 'gap', 0, 3, 0.1, 2)}
          </div>
          <Toggle label="Separate handle" checked={p.handle} onChange={(v) => setParams({ handle: v })} />
        </section>
      )}
    </aside>
  );
}

function ShapePicker() {
  const shapeId = useCookie((s) => s.shapeId);
  const setShape = useCookie((s) => s.setShape);
  const shapes = useMemo(() => SHAPES.map((s) => ({ ...s, polys: s.polygons() })), []);
  return (
    <ul className="grid grid-cols-4 gap-1.5" data-testid="cookie-shapes">
      {shapes.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => setShape(s.id)}
            aria-pressed={shapeId === s.id}
            title={s.label}
            aria-label={s.label}
            className={`flex aspect-square w-full items-center justify-center rounded-lg border ${shapeId === s.id ? 'border-brand bg-brand-50 text-brand' : 'border-line text-[#344054] hover:bg-[#f9fafb]'}`}
          >
            <ShapeIcon polygons={s.polys} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function TextInput() {
  const text = useCookie((s) => s.text);
  const font = useCookie((s) => s.font);
  const setText = useCookie((s) => s.setText);
  const setFont = useCookie((s) => s.setFont);
  const [draft, setDraft] = useState(text);
  useEffect(() => {
    const t = setTimeout(() => {
      if (draft !== useCookie.getState().text) setText(draft);
    }, 250);
    return () => clearTimeout(t);
  }, [draft, setText]);
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[12px] text-muted" htmlFor="cookie-text">
        Text
      </label>
      <input
        id="cookie-text"
        value={draft}
        maxLength={40}
        onChange={(e) => setDraft(e.target.value)}
        className="h-9 rounded-lg border border-line px-2.5 text-[14px] text-ink outline-none focus:border-brand"
        placeholder="A name or a word"
      />
      <label className="text-[12px] text-muted" htmlFor="cookie-font">
        Font
      </label>
      <select
        id="cookie-font"
        value={font}
        onChange={(e) => setFont(e.target.value as FontId)}
        className="h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-ink"
      >
        {FONTS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function PictureInput() {
  const upload = useCookie((s) => s.upload);
  const setImageOptions = useCookie((s) => s.setImageOptions);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={pickFile}
        className="flex h-10 items-center justify-center gap-2 rounded-lg border border-dashed border-[#c9d1de] text-[13px] font-medium text-[#344054] hover:bg-[#f9fafb]"
      >
        <FileUp size={16} /> {upload ? 'Choose another file' : 'Choose an SVG or picture'}
      </button>
      {!upload && (
        <p className="text-[12px] leading-relaxed text-muted">
          SVG logos work best. Pictures (PNG, JPG) are traced: use a dark drawing on a light background, or a PNG with a transparent
          background.
        </p>
      )}
      {upload && (
        <p className="truncate text-[12px] text-[#344054]" title={upload.name}>
          {upload.kind === 'svg' ? 'SVG' : 'Picture'}: <span className="font-medium">{upload.name}</span>
        </p>
      )}
      {upload?.kind === 'image' && (
        <>
          {!upload.usesAlpha && (
            <label className="text-[12px] text-muted" htmlFor="cookie-threshold">
              Darkness threshold: {upload.threshold}
              <input
                id="cookie-threshold"
                type="range"
                min={1}
                max={254}
                value={upload.threshold}
                onChange={(e) => setImageOptions({ threshold: Number(e.target.value) })}
                className="mt-1 w-full accent-[#2463eb]"
              />
            </label>
          )}
          <Toggle
            label={upload.usesAlpha ? 'Use the transparent area' : 'Use the light area'}
            checked={upload.invert}
            onChange={(v) => setImageOptions({ invert: v })}
          />
        </>
      )}
    </div>
  );
}

function RightPanel() {
  const result = useCookie((s) => s.result);
  const error = useCookie((s) => s.error);
  const building = useCookie((s) => s.building);
  const name = useCookie(
    (s) =>
      (s.tab === 'shape'
        ? SHAPES.find((x) => x.id === s.shapeId)?.label
        : s.tab === 'text'
          ? s.text.trim()
          : s.upload?.name.replace(/\.[^.]+$/, '')) || 'cookie',
  );
  const slug = name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'cookie';
  const body = (p: CookiePart) => ({ id: p.id, name: p.name, color: PART_COLOURS[p.id], mesh: p.mesh, watertight: p.watertight });
  const customise = () => {
    if (!result) return;
    useEditor.getState().importMeshes(
      result.parts.map((p) => ({ name: p.name, mesh: p.mesh })),
      { groupName: `${name} cookie` },
    );
    useStudio.getState().setStudio('design');
  };
  return (
    <aside
      className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-l border-line bg-white xl:w-[300px]"
      aria-label="Result"
      data-testid="cookie-right"
    >
      <section className={section} aria-labelledby="cookie-result-heading">
        <h2 id="cookie-result-heading" className={`${heading} flex items-center gap-2`}>
          Your cookie {building && <Loader2 size={14} className="animate-spin text-brand" aria-label="updating" />}
        </h2>
        {error && (
          <p role="alert" className="flex gap-2 rounded-lg bg-red-50 p-2 text-[12px] text-red-800" data-testid="cookie-error">
            <CircleAlert size={14} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}
        {result && (
          <>
            <p className="text-[13px] text-[#344054]" data-testid="cookie-size">
              {result.cookie.width.toFixed(1)} × {result.cookie.height.toFixed(1)} mm
            </p>
            <ul className="mt-3 flex flex-col gap-1.5" data-testid="cookie-parts">
              {result.parts.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg bg-[#f9fafb] px-2.5 py-2 text-[12px]"
                  data-testid="cookie-part"
                  data-part={p.id}
                >
                  <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: PART_COLOURS[p.id] }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{p.name}</span>
                    <span className="text-muted">{p.size.map((v) => v.toFixed(1)).join(' × ')} mm</span>
                  </span>
                  {p.watertight ? (
                    <CircleCheck size={14} className="shrink-0 text-[#067647]" aria-label="closed solid" />
                  ) : (
                    <CircleAlert size={14} className="text-red-600" aria-label="not a closed solid" />
                  )}
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-1 font-medium text-brand hover:bg-brand-50"
                    aria-label={`Download ${p.name} as STL`}
                    onClick={() => download(new Uint8Array(writeBinaryStl([body(p)])), `${slug}-${p.id}.stl`, 'model/stl')}
                  >
                    STL
                  </button>
                </li>
              ))}
            </ul>
            {result.warnings.map((w) => (
              <p
                key={w}
                className="mt-2 flex gap-2 rounded-lg bg-amber-50 p-2 text-[12px] leading-relaxed text-amber-900"
                data-testid="cookie-warning"
              >
                <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {w}
              </p>
            ))}
            {result.notes.map((n) => (
              <p key={n} className="mt-2 flex gap-2 text-[12px] leading-relaxed text-muted">
                <Info size={14} className="mt-0.5 shrink-0 text-brand" /> {n}
              </p>
            ))}
          </>
        )}
      </section>
      {result && (
        <section className="flex flex-col gap-2 p-4">
          <button
            type="button"
            data-testid="cookie-download"
            onClick={() => download(write3mf(result.parts.map(body), `${name} cookie`), `${slug}-cookie.3mf`, 'model/3mf')}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-[14px] font-semibold text-white hover:bg-brand-600"
          >
            <Download size={16} /> Download all parts (3MF)
          </button>
          <button
            type="button"
            onClick={customise}
            className="flex h-10 items-center justify-center gap-2 rounded-lg border border-line text-[13px] font-medium text-[#344054] hover:bg-[#f9fafb]"
          >
            <PencilRuler size={16} /> Customise in Design Studio
          </button>
          <p className="text-[11px] leading-relaxed text-muted">
            Print the cutter flange-down and the stamp face-up; no supports needed. Printed layers can trap dough: use a filament rated for
            food contact, hand-wash, and dust the cutter with flour.
          </p>
        </section>
      )}
    </aside>
  );
}

function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function Preview() {
  const result = useCookie((s) => s.result);
  const group = useRef<THREE.Group>(null);
  const fit = useRef<() => void>(() => {});
  return (
    <div className="relative h-full w-full" data-testid="cookie-viewport" role="region" aria-label="3D preview of the cutter and stamp">
      <Canvas
        camera={{ position: [80, -140, 120], fov: 40, near: 0.5, far: 10000, up: [0, 0, 1] }}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => gl.setClearColor('#f5f7fb')}
      >
        <hemisphereLight args={['#ffffff', '#b9c2d0', 1.6]} />
        <directionalLight position={[80, -120, 200]} intensity={1.6} />
        <directionalLight position={[-120, 100, 60]} intensity={0.5} />
        <gridHelper args={[600, 60, '#c9d1de', '#e3e8f0']} rotation={[Math.PI / 2, 0, 0]} />
        <group ref={group}>
          {result?.parts.map((p) => (
            <PartMesh key={`${p.id}-${p.mesh.indices.length}-${p.volume}`} part={p} />
          ))}
        </group>
        <FitControls
          target={group}
          fitRef={fit}
          contentKey={result ? `${result.parts.length}-${result.cookie.width.toFixed(0)}-${result.cookie.height.toFixed(0)}` : ''}
        />
      </Canvas>
      <div className="absolute right-3 top-3 rounded-xl bg-white/95 p-1 shadow-panel">
        <IconButton label="Fit in view" tooltipSide="left" onClick={() => fit.current()}>
          <Maximize size={17} />
        </IconButton>
      </div>
    </div>
  );
}

function PartMesh({ part }: { part: CookiePart }) {
  const geometry = useMemo(() => meshDataToGeometry(part.mesh, (40 * Math.PI) / 180), [part.mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} name={part.id}>
      <meshStandardMaterial color={PART_COLOURS[part.id]} roughness={0.55} metalness={0.02} />
    </mesh>
  );
}

function FitControls({
  target,
  fitRef,
  contentKey,
}: {
  target: React.RefObject<THREE.Group | null>;
  fitRef: React.MutableRefObject<() => void>;
  contentKey: string;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    fitRef.current = () => {
      const c = controls.current;
      const g = target.current;
      if (!c || !g) return;
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dist = (Math.max(sphere.radius, 1) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.95;
      c.target.copy(sphere.center);
      camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(0.35, -0.75, 0.75).normalize(), dist);
      camera.near = Math.max(0.05, dist / 1000);
      camera.far = dist * 50;
      camera.updateProjectionMatrix();
      c.update();
    };
    const id = requestAnimationFrame(() => fitRef.current());
    return () => cancelAnimationFrame(id);
  }, [contentKey, camera, target, fitRef]);
  return <OrbitControls ref={controls} makeDefault enableDamping={false} />;
}
