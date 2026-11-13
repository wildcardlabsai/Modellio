import { useMemo, useState } from 'react';
import { Check, Copy, Link2, CircleAlert } from 'lucide-react';
import { Modal, primaryBtn, secondaryBtn } from '@/components/ui/Modal';
import { useProjects } from '@/store/projectStore';

/** Share a view-only copy of the design as a link (the design lives in the link itself). */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const link = useMemo(() => useProjects.getState().shareLink(), []);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!('url' in link)) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: select the text so the user can copy it manually.
      (document.getElementById('share-url') as HTMLInputElement | null)?.select();
    }
  };
  return (
    <Modal
      title="Share a view-only link"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Close
          </button>
          {'url' in link && (
            <button type="button" className={primaryBtn} onClick={() => void copy()}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy link'}
            </button>
          )}
        </>
      }
    >
      {'url' in link ? (
        <>
          <label htmlFor="share-url" className="text-[13px] font-semibold text-ink">
            Link
          </label>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2">
            <Link2 size={16} className="shrink-0 text-muted" />
            <input
              id="share-url"
              readOnly
              value={link.url}
              onFocus={(e) => e.target.select()}
              className="w-full min-w-0 bg-transparent font-mono text-[12px] text-ink outline-none"
            />
          </div>
          <ul className="mt-4 space-y-1.5 text-[12px] leading-snug text-muted">
            <li>• Anyone with the link can view the design and make their own copy to edit.</li>
            <li>• The design is stored inside the link — nothing is uploaded to a server.</li>
            <li>• Later changes are not included: share again to send an updated version.</li>
          </ul>
          <p className="mt-3 text-[11px] text-muted">Link length: {(link.chars / 1024).toFixed(1)} kB</p>
        </>
      ) : (
        <p className="flex items-start gap-2 text-[13px] text-amber-800">
          <CircleAlert size={16} className="mt-px shrink-0" /> {link.error}
        </p>
      )}
    </Modal>
  );
}
