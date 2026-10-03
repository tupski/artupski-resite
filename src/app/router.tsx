import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { HomeRoute } from '../routes/HomeRoute';
import { ProjectsRoute } from '../routes/ProjectsRoute';
import { ProjectDetailRoute } from '../routes/ProjectDetailRoute';
import { ScanRoute } from '../routes/ScanRoute';
import { SettingsRoute } from '../routes/SettingsRoute';
import { NotFoundRoute } from '../routes/NotFoundRoute';

/** Route table. Exported separately so tests can mount a memory router. */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: 'projects', element: <ProjectsRoute /> },
      { path: 'projects/:projectId', element: <ProjectDetailRoute /> },
      { path: 'scan', element: <ScanRoute /> },
      { path: 'settings', element: <SettingsRoute /> },
      { path: '*', element: <NotFoundRoute /> }
    ]
  }
];

export const router = createBrowserRouter(routes);
