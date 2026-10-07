import { lazy, Suspense, useEffect, useState } from 'react';
import { ProjectsPage } from './pages/ProjectsPage.js';

// The projects page loads first and alone; the editor (with the 3D engine) and the other pages
// load on demand, and the editor is fetched in the background once the list is up, so opening a
// project is still immediate.
const loadEditor = () => import('./pages/EditorPage.js');
const EditorPage = lazy(() => loadEditor().then((m) => ({ default: m.EditorPage })));
const PlantPage = lazy(() => import('./pages/PlantPage.js').then((m) => ({ default: m.PlantPage })));
const ReportPage = lazy(() => import('./pages/ReportPage.js').then((m) => ({ default: m.ReportPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage.js').then((m) => ({ default: m.SettingsPage })));
const ShipmentPage = lazy(() => import('./pages/ShipmentPage.js').then((m) => ({ default: m.ShipmentPage })));

/** While a page's code arrives: a quiet line, no layout jump. */
function Opening() {
  return (
    <div className="opening" role="status" aria-live="polite">
      <span className="opening-bar" />
      <span className="sr-only">Opening…</span>
    </div>
  );
}

type Route = { page: 'projects' } | { page: 'settings' } | { page: 'editor'; id: string } | { page: 'report'; id: string } | { page: 'plant'; id: string } | { page: 'shipment'; id: string };

function parse(hash: string): Route {
  const plant = /^#\/p\/([\w-]+)\/plant/.exec(hash);
  if (plant) return { page: 'plant', id: plant[1]! };
  const report = /^#\/p\/([\w-]+)\/report/.exec(hash);
  if (report) return { page: 'report', id: report[1]! };
  const shipment = /^#\/s\/([\w-]+)/.exec(hash);
  if (shipment) return { page: 'shipment', id: shipment[1]! };
  const editor = /^#\/p\/([\w-]+)/.exec(hash);
  if (editor) return { page: 'editor', id: editor[1]! };
  if (hash.startsWith('#/settings')) return { page: 'settings' };
  return { page: 'projects' };
}

/** Pages live in the address hash so the browser's back button works and links can be shared locally. */
export function App() {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 400));
    idle(() => void loadEditor());
  }, []);
  if (route.page === 'projects') return <ProjectsPage open={(id) => (window.location.hash = `#/p/${id}`)} />;
  return (
    <Suspense fallback={<Opening />}>
      {route.page === 'report' && <ReportPage projectId={route.id} />}
      {route.page === 'plant' && <PlantPage key={route.id} projectId={route.id} />}
      {route.page === 'editor' && <EditorPage key={route.id} projectId={route.id} />}
      {route.page === 'settings' && <SettingsPage />}
      {route.page === 'shipment' && <ShipmentPage key={route.id} shipmentId={route.id} />}
    </Suspense>
  );
}
