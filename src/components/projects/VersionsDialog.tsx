import { useEffect, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { Modal, secondaryBtn } from '@/components/ui/Modal';
import { useProjects } from '@/store/projectStore';
import type { VersionInfo } from '@/cad/serialization/repository';

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Earlier saved versions of the open design. Restoring is undoable. */
export function VersionsDialog({ onClose }: { onClose: () => void }) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  useEffect(() => {
    void useProjects.getState().listVersions().then(setVersions);
  }, []);
  return (
    <Modal
      title="Version history"
      onClose={onClose}
      footer={
        <button type="button" className={secondaryBtn} onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="text-[13px] text-muted">
        Versions are kept every few minutes while you work, and each time you press Ctrl/⌘+S. Restoring can be undone, and your current
        design is kept as a version first.
      </p>
      {versions === null ? (
        <p className="mt-4 text-[13px] text-muted">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-muted">
          <History size={15} /> No earlier versions yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line" aria-label="Versions" data-testid="versions">
          {versions.map((v) => (
            <li key={v.key} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{fmt.format(v.savedAt)}</p>
                <p className="text-[12px] text-muted">
                  {v.label} · {v.objectCount} object{v.objectCount === 1 ? '' : 's'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void useProjects.getState().restoreVersion(v.key);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold text-[#344054] hover:bg-brand-50 hover:text-brand"
              >
                <RotateCcw size={14} /> Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
