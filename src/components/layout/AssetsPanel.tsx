import { useEffect, useState, type DragEvent } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { ASSET_ACCEPT, ASSET_DRAG_MIME, assetFile, useAssets, type AssetRecord } from '@/assets/library';
import { handleFiles } from '@/components/files/fileIntake';

const KIND_LABEL: Record<AssetRecord['kind'], string> = { svg: 'SVG', image: 'Picture', stl: 'STL', obj: 'OBJ', '3mf': '3MF' };

/** Add a saved asset to the design (at a workplane point, or a free spot). */
export function addAssetToDesign(a: AssetRecord, at?: [number, number]) {
  return handleFiles([assetFile(a)], at, { save: false });
}

function pickFiles(onFiles: (files: File[]) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ASSET_ACCEPT;
  input.multiple = true;
  input.onchange = () => onFiles([...(input.files ?? [])]);
  input.click();
}

/**
 * Design Studio asset library: logos, artwork and models kept on this device. Click to add,
 * or drag onto the workplane. Files are shared with the makers.
 */
export function AssetsPanel() {
  const assets = useAssets((s) => s.assets);
  const loaded = useAssets((s) => s.loaded);
  const [over, setOver] = useState(false);
  useEffect(() => void useAssets.getState().load(), []);
  // Upload: save to the library and add to the design.
  const upload = (files: File[]) => void handleFiles(files);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void useAssets.getState().add([...e.dataTransfer.files]);
  };
  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-white" aria-label="Assets" data-testid="assets-panel">
      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
        <h2 className="text-[15px] font-semibold text-ink">Assets</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Your logos, artwork and models. Click one to add it, or drag it onto the workplane. They are kept on this device and are also
          available in the makers.
        </p>
        <button
          type="button"
          onClick={() => pickFiles(upload)}
          onDragOver={(e) => {
            if (![...e.dataTransfer.types].includes('Files')) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={`mt-3 flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed px-3 py-4 text-center text-[13px] font-semibold ${
            over ? 'border-brand bg-brand-50 text-brand' : 'border-[#c9d1de] text-[#344054] hover:border-brand hover:text-brand'
          }`}
          data-testid="assets-upload"
        >
          <Upload size={18} />
          Upload files
          <span className="text-[11px] font-normal text-muted">SVG, PNG, JPG, STL, OBJ or 3MF</span>
        </button>
        {loaded && !assets.length && (
          <p className="mt-4 text-[12px] leading-relaxed text-muted">
            Nothing here yet. SVGs and pictures are traced into a solid you can raise, engrave or cut out; models come in as they are.
          </p>
        )}
        <ul className="mt-4 grid grid-cols-2 gap-2" data-testid="assets-list">
          {assets.map((a) => (
            <li key={a.id} className="group relative">
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(ASSET_DRAG_MIME, a.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => void addAssetToDesign(a)}
                title={`Add ${a.name}`}
                className="block w-full overflow-hidden rounded-lg border border-line text-left hover:border-brand"
                data-testid="asset"
                data-asset={a.name}
              >
                <img src={a.thumb} alt="" className="aspect-square w-full bg-[#f5f7fb] object-contain" draggable={false} />
                <span className="block px-1.5 py-1">
                  <span className="block truncate text-[11px] font-semibold text-ink">{a.name.replace(/\.[^.]+$/, '')}</span>
                  <span className="block text-[10px] text-[#475467]">{KIND_LABEL[a.kind]}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => void useAssets.getState().remove(a.id)}
                aria-label={`Remove ${a.name} from assets`}
                className="absolute right-1 top-1 rounded-md bg-white/90 p-1 text-[#475467] opacity-0 shadow-sm hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
