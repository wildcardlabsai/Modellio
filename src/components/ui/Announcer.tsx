import { useEffect, useState } from 'react';
import { useEditor } from '@/store/editorStore';

/**
 * Screen-reader announcements (always mounted, so updates are reliably read):
 * notices, undo/redo and selection changes.
 */
export function Announcer() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const say = (text: string) => {
      // Clear first so repeating the same message is announced again.
      setMessage('');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMessage(text), 50);
    };
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.notice && s.notice !== prev.notice) say(s.notice.text);
      else if (s.actionSeq !== prev.actionSeq && s.lastAction && /^(Undo|Redo) /.test(s.lastAction)) say(s.lastAction);
      else if (s.selection !== prev.selection) {
        const names = s.selection.map((id) => s.doc.objects[id]?.name).filter(Boolean);
        say(names.length === 0 ? 'Selection cleared' : names.length === 1 ? `${names[0]} selected` : `${names.length} objects selected`);
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="announcer">
      {message}
    </div>
  );
}
