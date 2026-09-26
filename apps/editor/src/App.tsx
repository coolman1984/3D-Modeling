import { useEffect, useState } from 'react';
import { EditorPage } from './pages/EditorPage.js';
import { ProjectsPage } from './pages/ProjectsPage.js';
import { ReportPage } from './pages/ReportPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

type Route = { page: 'projects' } | { page: 'settings' } | { page: 'editor'; id: string } | { page: 'report'; id: string };

function parse(hash: string): Route {
  const report = /^#\/p\/([\w-]+)\/report/.exec(hash);
  if (report) return { page: 'report', id: report[1]! };
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
  if (route.page === 'report') return <ReportPage projectId={route.id} />;
  if (route.page === 'editor') return <EditorPage key={route.id} projectId={route.id} />;
  if (route.page === 'settings') return <SettingsPage />;
  return <ProjectsPage open={(id) => (window.location.hash = `#/p/${id}`)} />;
}
