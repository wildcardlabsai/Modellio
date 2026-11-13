import { useEffect, useState } from 'react';
import { Monitor, X } from 'lucide-react';

/** Phones get a gentle, dismissible note: everything works, but a bigger screen helps. */
export function SmallScreenNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem('modellio:small-screen-ok') === '1';
    } catch {
      /* ignore */
    }
    setShow(!dismissed && matchMedia('(max-width: 640px)').matches);
  }, []);
  if (!show) return null;
  return (
    <div role="note" className="flex items-center gap-2 border-b border-line bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
      <Monitor size={15} className="shrink-0" />
      <span className="flex-1">MODELLIO works best on a tablet or computer. You can still view and make small edits here.</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setShow(false);
          try {
            sessionStorage.setItem('modellio:small-screen-ok', '1');
          } catch {
            /* ignore */
          }
        }}
        className="rounded p-1 hover:bg-amber-100"
      >
        <X size={14} />
      </button>
    </div>
  );
}
