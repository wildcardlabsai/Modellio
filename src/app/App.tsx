import { useEffect, useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { LeftRail } from '@/components/layout/LeftRail';
import { ShapeLibrary } from '@/components/shapes/ShapeLibrary';
import { Inspector } from '@/components/inspector/Inspector';
import { Viewport } from '@/viewport/Viewport';
import { ShortcutsDialog } from '@/components/layout/ShortcutsDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useEditor } from '@/store/editorStore';
import { viewport, worldToScreen } from '@/viewport/viewportBridge';

export function App() {
  useKeyboardShortcuts();
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Expose the store for debugging and automated workflow tests.
  useEffect(() => {
    (window as unknown as { modellio: unknown }).modellio = { store: useEditor, viewport, worldToScreen };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !(e.target instanceof HTMLInputElement)) setShowShortcuts((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar onShowShortcuts={() => setShowShortcuts(true)} />
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LeftRail />
        <ShapeLibrary />
        <main className="relative min-w-0 flex-1">
          <Viewport />
        </main>
        <Inspector />
      </div>
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
