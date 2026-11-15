import { Suspense, type ComponentType, type LazyExoticComponent, lazy, useEffect, useState } from 'react';
import { ReturnBar } from '@/components/layout/ReturnBar';
import { HistoryTimeline } from '@/components/layout/HistoryTimeline';
import { SketchHost } from '@/components/sketch/SketchHost';
import { TopBar } from '@/components/layout/TopBar';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { LeftRail, type LeftPanel } from '@/components/layout/LeftRail';
const WorkplanePanel = lazy(() => import('@/components/layout/WorkplanePanel').then((m) => ({ default: m.WorkplanePanel })));
const TextPanel = lazy(() => import('@/components/layout/TextPanel').then((m) => ({ default: m.TextPanel })));
const AssetsPanel = lazy(() => import('@/components/layout/AssetsPanel').then((m) => ({ default: m.AssetsPanel })));
const AssistantPanel = lazy(() => import('@/components/assistant/AssistantPanel').then((m) => ({ default: m.AssistantPanel })));
const PrintPanel = lazy(() => import('@/components/print/PrintPanel').then((m) => ({ default: m.PrintPanel })));
import { ShapeLibrary } from '@/components/shapes/ShapeLibrary';
import { Inspector } from '@/components/inspector/Inspector';
import { Viewport } from '@/viewport/Viewport';
const ShortcutsDialog = lazy(() => import('@/components/layout/ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog })));
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { CadResources } from '@/viewport/cadReady';
import { useProjects } from '@/store/projectStore';
const TemplatesPage = lazy(() => import('@/components/projects/TemplatesPage').then((m) => ({ default: m.TemplatesPage })));
const ProjectsPage = lazy(() => import('@/components/projects/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const ImportDialog = lazy(() => import('@/components/files/ImportDialog').then((m) => ({ default: m.ImportDialog })));
const ExportDialog = lazy(() => import('@/components/files/ExportDialog').then((m) => ({ default: m.ExportDialog })));
import { useFileUi } from '@/components/files/fileIntake';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ViewportCrash } from '@/components/layout/CrashScreens';
import { useDebug } from '@/utils/debug';
import { Announcer } from '@/components/ui/Announcer';
import { useLayout, useResponsiveLayout } from '@/hooks/useLayout';
import { SmallScreenNotice } from '@/components/layout/SmallScreenNotice';
import { SharedBanner } from '@/components/layout/SharedBanner';
import { TEMPLATES } from '@/templates/templates';
import { Tour, useFirstRunTour } from '@/components/onboarding/Tour';
import { useGuides } from '@/viewport/guides';
import { useEditor } from '@/store/editorStore';
import { viewport, worldToScreen } from '@/viewport/viewportBridge';
import * as hierarchy from '@/cad/hierarchy';
import { booleanStats, computeCombined } from '@/cad/operations/combine';
import { useStudio, type StudioId } from './studio';
import { WORKSPACE_LABEL } from '@/platform/catalog';
import { LandingPage } from '@/landing/LandingPage';
import { useFeatureTool } from '@/components/features/featureTool';
const SplitStudio = lazy(() => import('@/split/ui/SplitStudio'));
const CookieStudio = lazy(() => import('@/makers/cookie/CookieStudio'));
const VaseStudio = lazy(() => import('@/makers/vase/VaseStudio'));
const KeyringStudio = lazy(() => import('@/makers/keyring/KeyringStudio'));
const KeyTagStudio = lazy(() => import('@/makers/keytag/KeyTagStudio'));
const SignStudio = lazy(() => import('@/makers/sign/SignStudio'));
const Dashboard = lazy(() => import('@/dashboard/Dashboard'));
const PrivacyPage = lazy(() => import('@/platform/PrivacyPage'));
const LicencesPage = lazy(() => import('@/platform/LicencesPage'));

/** Workspaces other than the Design Studio, loaded on demand. */
const WORKSPACES: Partial<Record<StudioId, LazyExoticComponent<ComponentType>>> = {
  dashboard: Dashboard,
  split: SplitStudio,
  cookie: CookieStudio,
  vase: VaseStudio,
  keyring: KeyringStudio,
  keytag: KeyTagStudio,
  sign: SignStudio,
};

export function App() {
  useKeyboardShortcuts();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [panel, setPanel] = useState<LeftPanel>('shapes');
  useResponsiveLayout();
  const compact = useLayout((st) => st.compact);
  const leftOpen = useLayout((st) => st.leftOpen);
  const inspectorOpen = useLayout((st) => st.inspectorOpen);
  /** Rail click: switch panel; on compact screens it also opens/closes the drawer. */
  const choosePanel = (p: LeftPanel) => {
    const { compact: c, leftOpen: open, setLeftOpen } = useLayout.getState();
    if (c) setLeftOpen(!(open && p === panel));
    setPanel(p);
  };
  // On compact screens, close the shape drawer once something is added so the result is visible.
  const objectCount = useEditor((st) => st.doc.rootIds.length);
  useEffect(() => {
    if (useLayout.getState().compact) useLayout.getState().setLeftOpen(false);
  }, [objectCount]);

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
      templates: TEMPLATES,
      features: useFeatureTool,
    };
  }, []);

  const studio = useStudio((s) => s.studio);
  useFirstRunTour(studio === 'design');
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
      if (e.key === '?' && !(e.target instanceof HTMLInputElement) && useStudio.getState().studio === 'design') setShowShortcuts((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (studio === 'home') return <LandingPage />;
  if (studio === 'privacy' || studio === 'licences')
    return <Suspense fallback={null}>{studio === 'privacy' ? <PrivacyPage /> : <LicencesPage />}</Suspense>;
  const Workspace = WORKSPACES[studio];

  return (
    // The Design Studio uses the dark professional shell; the makers keep their light look.
    <div className="flex h-full flex-col" data-ui={Workspace ? undefined : 'studio-dark'}>
      <TopBar onShowShortcuts={() => setShowShortcuts(true)} />
      <ReturnBar />
      {Workspace ? (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-[13px] text-muted" role="status">
              <Loader2 size={16} className="mr-2 animate-spin" /> Opening {WORKSPACE_LABEL[studio] ?? 'MODELLIO'}…
            </div>
          }
        >
          <ErrorBoundary fallback={(error, reset) => <ViewportCrash error={error} reset={reset} />}>
            <Workspace />
          </ErrorBoundary>
        </Suspense>
      ) : (
        <DesignStudio
          panel={panel}
          choosePanel={choosePanel}
          compact={compact}
          leftOpen={leftOpen}
          inspectorOpen={inspectorOpen}
          view={view}
        />
      )}
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

interface DesignStudioProps {
  panel: LeftPanel;
  choosePanel: (p: LeftPanel) => void;
  compact: boolean;
  leftOpen: boolean;
  inspectorOpen: boolean;
  view: string;
}

/** The modelling workspace (the original MODELLIO editor). */
function DesignStudio({ panel, choosePanel, compact, leftOpen, inspectorOpen, view }: DesignStudioProps) {
  return (
    <>
      <Toolbar />
      <SharedBanner />
      <SmallScreenNotice />
      <div className="relative flex min-h-0 flex-1">
        <LeftRail panel={panel} onChange={choosePanel} />
        {/* On compact screens the panel is a drawer over the 3D view. */}
        {(!compact || leftOpen) && (
          <div className={compact ? 'absolute bottom-0 left-[76px] top-0 z-30 flex shadow-float' : 'contents'} data-testid="left-panel">
            <Suspense fallback={<PanelLoading />}>
              {panel === 'shapes' ? (
                <ShapeLibrary onOpenPanel={choosePanel} />
              ) : panel === 'text' ? (
                <TextPanel />
              ) : panel === 'assets' ? (
                <AssetsPanel />
              ) : panel === 'print' ? (
                <PrintPanel />
              ) : panel === 'assistant' ? (
                <AssistantPanel />
              ) : (
                <WorkplanePanel />
              )}
            </Suspense>
          </div>
        )}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
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
          </div>
          {!compact && <HistoryTimeline />}
          <SketchHost />
        </main>
        {(!compact || inspectorOpen) && (
          <div className={compact ? 'absolute bottom-0 right-0 top-0 z-30 flex shadow-float' : 'contents'} data-testid="inspector-panel">
            <Inspector onOpenPanel={choosePanel} />
          </div>
        )}
        {/* The editor stays mounted (keeps the WebGL context) while the projects page is shown. */}
        {view === 'projects' && (
          <Suspense fallback={null}>
            <ProjectsPage />
          </Suspense>
        )}
        {view === 'templates' && (
          <Suspense fallback={null}>
            <TemplatesPage />
          </Suspense>
        )}
      </div>
    </>
  );
}

function PanelLoading() {
  return <aside className="w-[264px] shrink-0 border-r border-line bg-panel" aria-busy="true" />;
}
