import { useEffect } from 'react';
import { EffectsOverlay } from './components/EffectsOverlay';
import { Toasts } from './components/Toasts';
import { LinkConflictDialog } from './components/project/LinkConflictDialog';
import { CloseDialog } from './components/project/CloseDialog';
import { PanelResizer } from './components/PanelResizer';
import { Deck } from './components/layout/Deck';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { Inspector } from './components/inspector/Inspector';
import { isDesktop } from './desktop/bridge';
import { syncTitleBar, useDesktopSync } from './desktop/useDesktopSync';
import { href, navigate, useRoute, type Route } from './lib/router';
import { useShortcuts } from './lib/useShortcuts';
import { defaultTab } from './lib/sections';
import { useFindReveal } from './lib/find';
import { SearchPalette } from './components/SearchPalette';
import { useScrollMemory } from './lib/scrollMemory';
import { useInterfaceZoom } from './lib/interfaceZoom';
import { useLiveWrite } from './lib/useLiveWrite';
import { KeyboardPage } from './pages/KeyboardPage';
import { LayersPage } from './pages/LayersPage';
import { EncodersPage } from './pages/EncodersPage';
import { MacrosPage } from './pages/MacrosPage';
import { AdvancedPage } from './pages/AdvancedPage';
import { LightingPage } from './pages/LightingPage';
import { HardwarePage } from './pages/HardwarePage';
import { FirmwarePage } from './pages/FirmwarePage';
import { DevicePage } from './pages/DevicePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { setLanguage, t } from './i18n';
import { lastProjectId, useProjectStore } from './store/projectStore';
import { useDeviceStore } from './store/deviceStore';
import { watchKeyCounts } from './store/keyCountsStore';
import { useSettingsStore } from './store/settingsStore';
import { applyTheme } from './theme/applyTheme';

/** Sections that take the whole main area (no page scrolling). */
const FILL = new Set<Route['section']>(['keyboard', 'hardware']);

function renderPage(route: Route) {
  switch (route.section) {
    case 'keyboard':
      return <KeyboardPage />;
    case 'layers':
      return <LayersPage />;
    case 'encoders':
      return <EncodersPage />;
    case 'macros':
      return <MacrosPage />;
    case 'advanced':
      return <AdvancedPage tab={route.tab} />;
    case 'lighting':
      return <LightingPage />;
    case 'hardware':
      return <HardwarePage tab={route.tab} />;
    case 'firmware':
      return <FirmwarePage tab={route.tab} />;
    case 'device':
      return <DevicePage />;
    case 'projects':
      return <ProjectsPage tab={route.tab} />;
    case 'settings':
      return <SettingsPage tab={route.tab} />;
  }
}

/**
 * Sections with a right panel: the selected key (Keyboard), the selected geometry key (Hardware), the firmware
 * features (Firmware). Elsewhere it held nothing about the page, so the page gets the width.
 */
const WITH_INSPECTOR = new Set<Route['section']>(['keyboard', 'hardware', 'firmware']);

/** Sections that need an open project. */
const NEEDS_PROJECT = new Set<Route['section']>(['keyboard', 'layers', 'encoders', 'macros', 'advanced', 'lighting', 'hardware', 'firmware']);

export function App() {
  const route = useRoute();
  const settings = useSettingsStore((s) => s.settings);
  setLanguage(settings.language);
  const status = useProjectStore((s) => s.status);
  const project = useProjectStore((s) => s.project);
  const projectName = project?.name;

  useEffect(() => {
    applyTheme(settings);
    syncTitleBar();
  }, [settings]);
  useEffect(() => {
    document.title = `${settings.brand.name}${projectName ? ` · ${projectName}` : ''}`;
  }, [settings.brand.name, projectName]);
  useDesktopSync();
  useShortcuts(route);
  useInterfaceZoom();
  useLiveWrite();
  useFindReveal();

  // Startup: project list, the last opened one; look for keyboards.
  useEffect(() => {
    const store = useProjectStore.getState();
    void store.refreshList().then(async () => {
      const last = lastProjectId();
      const list = useProjectStore.getState().list;
      const id = last && list.some((p) => p.id === last) ? last : list[0]?.id;
      if (id) await store.open(id);
      else navigate({ section: 'projects', tab: 'new' }, { replace: true });
    });
    void useDeviceStore.getState().refresh();
    watchKeyCounts();
  }, []);

  // A project was opened/created — connect to its keyboard if it is plugged in and auto-connect is on.
  const projectDevice = project?.device ? `${project.device.vid}:${project.device.pid}` : null;
  useEffect(() => {
    if (!projectDevice || !useSettingsStore.getState().settings.device.autoConnect) return;
    const device = useDeviceStore.getState();
    if (device.status === 'connected' || device.status === 'busy' || device.status === 'connecting') return;
    const [vid, pid] = projectDevice.split(':').map(Number);
    void device.refresh().then(() => {
      const match = useDeviceStore.getState().devices.find((d) => d.vendorId === vid && d.productId === pid);
      if (match && useDeviceStore.getState().status !== 'connected') void useDeviceStore.getState().connect(match.key);
    });
  }, [projectDevice]);

  const needsProject = NEEDS_PROJECT.has(route.section) && !project;
  const fill = FILL.has(route.section) && !needsProject;
  const scrollRef = useScrollMemory(`${route.section}/${route.tab ?? defaultTab(route.section) ?? ''}`);
  const inspector = settings.layout.inspector && WITH_INSPECTOR.has(route.section);

  return (
    <div className="app" data-sidebar={settings.layout.sidebar ? 'on' : 'off'} data-inspector={inspector ? 'on' : 'off'}>
      {isDesktop && (
        <div className="titlebar" aria-hidden="true">
          <span className="titlebar-text">
            {settings.brand.name}
            {projectName && <span className="titlebar-dim"> · {projectName}</span>}
          </span>
        </div>
      )}
      <div className="ambient" aria-hidden="true" />
      {settings.layout.sidebar && <Sidebar route={route} />}
      {settings.layout.sidebar && <PanelResizer side="sidebar" />}
      <main className="main" id="main-content" tabIndex={-1} data-route={route.section}>
        <TopBar route={route} />
        {needsProject ? (
          <div className="page-scroll">
            <div className="page-wrap">
              <div className="empty-state">
                <p>{status === 'loading' ? t('Opening the project…', 'Открываю проект…') : t('No project is open.', 'Проект не открыт.')}</p>
                {status !== 'loading' && (
                  <a className="btn btn--primary" href={href({ section: 'projects', tab: 'new' })}>
                    {t('create or open a project', 'создать или открыть проект')}
                  </a>
                )}
              </div>
            </div>
          </div>
        ) : fill ? (
          <div className="page-fill" key={route.section}>
            {renderPage(route)}
          </div>
        ) : (
          <div className="page-scroll" ref={scrollRef}>
            {/* Keyed by section only: a tab switch keeps the page (its visited tabs stay mounted) and its scroll. */}
            <div className="page-wrap" key={route.section}>
              {renderPage(route)}
            </div>
          </div>
        )}
      </main>
      {inspector && <Inspector route={route} />}
      {inspector && <PanelResizer side="right" />}
      <Deck />
      <LinkConflictDialog />
      <CloseDialog />
      <SearchPalette />
      <Toasts />
      <EffectsOverlay />
    </div>
  );
}
