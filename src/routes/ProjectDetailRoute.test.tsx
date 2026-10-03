import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProjectDetailRoute } from './ProjectDetailRoute';
import { storageService } from '../services/storage';
import { useProjectDetailStore } from '../stores/projectDetailStore';
import { useTechnologyStore } from '../stores/technologyStore';
import { useResponsiveStore } from '../stores/responsiveStore';
import { useCloneStore } from '../stores/cloneStore';
import { useBlueprintStore } from '../stores/blueprintStore';
import { pathForUrl } from '../services/storage/repositories/scanPageRepository';

function renderDetail(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

async function seedProjectWithScan() {
  const repos = storageService.getRepositories();
  const project = await repos.projects.create({
    name: 'Detail project',
    targetUrl: 'https://detail.test',
    storagePath: 'AppData/Local/ArtupskiReSite/projects/detail'
  });
  const scan = await repos.scans.create({ projectId: project.id, status: 'completed' });
  await repos.pages.upsert({
    scanId: scan.id,
    url: 'https://detail.test/',
    finalUrl: 'https://detail.test/',
    path: pathForUrl('https://detail.test/'),
    depth: 0,
    httpStatus: 200,
    title: 'Home page',
    metaDescription: null,
    canonicalUrl: null,
    robotsMeta: null,
    status: 'completed',
    authStatus: null,
    errorCode: null,
    errorMessage: null,
    loadTimeMs: 1,
    domContentLoadedTimeMs: 1,
    domNodeCount: 1,
    headings: [],
    internalLinks: [],
    externalLinks: [],
    images: [],
    warnings: [],
    capturedAt: '2026-01-01T00:00:00.000Z'
  });
  return { project, scan };
}

describe('ProjectDetailRoute', () => {
  beforeEach(async () => {
    useProjectDetailStore.getState().reset();
    useTechnologyStore.getState().clear();
    useResponsiveStore.getState().clear();
    useCloneStore.getState().clear();
    useBlueprintStore.getState().clear();
    await storageService.initialize();
  });

  afterEach(async () => {
    await storageService.resetForTests();
    useProjectDetailStore.getState().reset();
  });

  it('offers maintenance actions for a stored project (rescan + regenerate)', async () => {
    const { project } = await seedProjectWithScan();
    renderDetail(project.id);

    // The project name is the page heading once loaded.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Detail project', level: 1 })).toBeInTheDocument()
    );

    // The Overview tab exposes the maintenance surface. A rescan starts a new
    // scan (never overwrites); regeneration rebuilds derived artifacts.
    expect(screen.getByRole('button', { name: /rescan project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate static clone/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate blueprint/i })).toBeInTheDocument();

    // Docs regeneration is only offered once a Blueprint exists.
    expect(screen.getByRole('button', { name: /regenerate docs/i })).toBeDisabled();
  });

  it('shows the crawled pages in the Pages tab', async () => {
    const { project } = await seedProjectWithScan();
    const user = userEvent.setup();
    renderDetail(project.id);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Detail project', level: 1 })).toBeInTheDocument()
    );

    await user.click(screen.getByRole('tab', { name: 'Pages' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  it('shows an honest not-found state for an unknown project', async () => {
    renderDetail('missing-project');

    expect(await screen.findByText(/project not found/i)).toBeInTheDocument();
  });
});
