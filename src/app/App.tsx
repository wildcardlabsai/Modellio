import { useEffect, useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { LeftRail, type LeftPanel } from '@/components/layout/LeftRail';
import { WorkplanePanel } from '@/components/layout/WorkplanePanel';
import { TextPanel } from '@/components/layout/TextPanel';
import { ShapeLibrary } from '@/components/shapes/ShapeLibrary';
import { Inspector } from '@/components/inspector/Inspector';
import { Viewport } from '@/viewport/Viewport';
import { ShortcutsDialog } from '@/components/layout/ShortcutsDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { CadResources } from '@/viewport/cadReady';
import { useEditor } from '@/store/editorStore';
import { viewport, worldToScreen } from '@/viewport/viewportBridge';
import * as hierarchy from '@/cad/hierarchy';
import { computeCombined } from '@/cad/operations/combine';

export function App() {
  useKeyboardShortcuts();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [panel, setPanel] = useState<LeftPanel>('shapes');

  // Expose the store for debugging and automated workflow tests.
  useEffect(() => {
    (window as unknown as { modellio: unknown }).modellio = { store: useEditor, viewport, worldToScreen, hierarchy, computeCombined };
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
        <LeftRail panel={panel} onChange={setPanel} />
        {panel === 'shapes' ? <ShapeLibrary /> : panel === 'text' ? <TextPanel /> : <WorkplanePanel />}
        <main className="relative min-w-0 flex-1">
          <Viewport />
        </main>
        <Inspector />
      </div>
      <CadResources />
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
