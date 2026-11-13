import { Suspense, lazy, useEffect, useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { LeftRail, type LeftPanel } from '@/components/layout/LeftRail';
const WorkplanePanel = lazy(() => import('@/components/layout/WorkplanePanel').then((m) => ({ default: m.WorkplanePanel })));
const TextPanel = lazy(() => import('@/components/layout/TextPanel').then((m) => ({ default: m.TextPanel })));
const PrintPanel = lazy(() => import('@/components/print/PrintPanel').then((m) => ({ default: m.PrintPanel })));
import { ShapeLibrary } from '@/components/shapes/ShapeLibrary';
import { Inspector } from '@/components/inspector/Inspector';
import { Viewport } from '@/viewport/Viewport';
const ShortcutsDialog = lazy(() => import('@/components/layout/ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog })));
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { CadResources } from '@/viewport/cadReady';
import { useProjects } from '@/store/projectStore';
const ProjectsPage = lazy(() => import('@/components/projects/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const ImportDialog = lazy(() => import('@/components/files/ImportDialog').then((m) => ({ default: m.ImportDialog })));
const ExportDialog = lazy(() => import('@/components/files/ExportDialog').then((m) => ({ default: m.ExportDialog })));
import { useFileUi } from '@/components/files/fileIntake';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ViewportCrash } from '@/components/layout/CrashScreens';
import { useDebug } from '@/utils/debug';
import { Announcer } from '@/components/ui/Announcer';
import { Tour, useFirstRunTour } from '@/components/onboarding/Tour';
import { useGuides } from '@/viewport/guides';
import { useEditor } from '@/store/editorStore';
import { viewport, worldToScreen } from '@/viewport/viewportBridge';
import * as hierarchy from '@/cad/hierarchy';
import { booleanStats, computeCombined } from '@/cad/operations/combine';

export function App() {
  useKeyboardShortcuts();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [panel, setPanel] = useState<LeftPanel>('shapes');

  // Expose the store for debugging and automated workflow tests.
  useEffect(() => {
    (window as unknown as { modellio: unknown }).modellio = {
      store: useEditor,
      projects: useProjects,
      viewport,
      worldToScreen,
      hierarchy,
      computeCombined,
      debug: useDebug,
      guides: useGuides,
      booleanStats,
    };
  }, []);

  useFirstRunTour();
  const view = useProjects((s) => s.view);
  const busy = useFileUi((s) => s.busy);
  const importQueued = useFileUi((s) => s.queue.length > 0);
  const exportOpen = useFileUi((s) => s.exportOpen);

  // Open the last project (or start a new one), and protect unsaved work.
  useEffect(() => {
    void useProjects.getState().init();
    const onHide = () => {
      if (document.visibilityState === 'hidden' && useProjects.getState().status === 'unsaved') void useProjects.getState().saveNow();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const status = useProjects.getState().status;
      if (status === 'unsaved' || status === 'saving') {
        void useProjects.getState().saveNow();
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
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
      <div className="relative flex min-h-0 flex-1">
        <LeftRail panel={panel} onChange={setPanel} />
        <Suspense fallback={<PanelLoading />}>
          {panel === 'shapes' ? (
            <ShapeLibrary />
          ) : panel === 'text' ? (
            <TextPanel />
          ) : panel === 'print' ? (
            <PrintPanel />
          ) : (
            <WorkplanePanel />
          )}
        </Suspense>
        <main className="relative min-w-0 flex-1">
          <ErrorBoundary
            fallback={(error, reset) => (
              <ViewportCrash
                error={error}
                reset={() => {
                  useDebug.setState({ crashViewport: false });
                  reset();
                }}
              />
            )}
          >
            <Viewport />
          </ErrorBoundary>
        </main>
        <Inspector />
        {/* The editor stays mounted (keeps the WebGL context) while the projects page is shown. */}
        {view === 'projects' && (
          <Suspense fallback={null}>
            <ProjectsPage />
          </Suspense>
        )}
      </div>
      <CadResources />
      <Announcer />
      <Tour />
      {/* Dialogs are only fetched when first needed. */}
      <Suspense fallback={null}>
        {importQueued && <ImportDialog />}
        {exportOpen && <ExportDialog />}
        {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      </Suspense>
      {busy && (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-navy px-3 py-2 text-xs font-medium text-white shadow-float"
        >
          <Loader2 size={14} className="animate-spin" /> {busy}
        </div>
      )}
    </div>
  );
}

function PanelLoading() {
  return <aside className="w-[264px] shrink-0 border-r border-line bg-white" aria-busy="true" />;
}
