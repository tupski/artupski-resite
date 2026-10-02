/**
 * Phase 12 project generator suites - Artupski ReSite
 *
 * Covers structure, Blueprint integration (routes/tokens), component/hook/asset
 * assembly, independence from ReSite, failure isolation, and events. The real
 * build verification lives in `projectGenerator.build.e2e.test.ts`.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '../../infra/eventBus';
import { generateProject } from '../projectGenerator';
import { phase12Blueprint } from './projectFixtures';
import { counterHook, heroComponent, logoAsset, synthesizedComponent } from './projectFixtures';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'resite-project-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function collectEvents(): { events: AppEvent[]; sink: { emit: (e: AppEvent) => void } } {
  const events: AppEvent[] = [];
  return { events, sink: { emit: (event) => events.push(event) } };
}

async function read(root: string, relative: string): Promise<string> {
  return fs.readFile(join(root, relative), 'utf8');
}

describe('generateProject structure (Phase 12 acceptance)', () => {
  it('writes the expected boilerplate files and directories', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [synthesizedComponent(), heroComponent()],
        targetRoot: root
      }
    );

    expect(report.ok).toBe(true);
    for (const path of [
      'package.json',
      'index.html',
      'tsconfig.json',
      'tsconfig.node.json',
      'vite.config.ts',
      'tailwind.config.ts',
      'postcss.config.js',
      '.gitignore',
      'src/main.tsx',
      'src/App.tsx',
      'src/router.tsx',
      'src/tokens.ts',
      'src/styles/index.css'
    ]) {
      expect(report.files).toContain(path);
    }
    expect(report.summary.filesWritten).toBe(report.files.length);
  });

  it('emits a valid package.json without ReSite-only dependencies', async () => {
    const root = await makeRoot();
    await generateProject({}, { blueprint: phase12Blueprint(), components: [], targetRoot: root });
    const manifest = JSON.parse(await read(root, 'package.json')) as {
      name: string;
      private: boolean;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(manifest.private).toBe(true);
    expect(manifest.scripts.build).toContain('vite build');
    expect(manifest.dependencies.react).toBeTruthy();
    expect(manifest.dependencies['react-router-dom']).toBeTruthy();
    for (const forbidden of ['@tauri-apps/api', 'zustand', 'sql.js', 'playwright', 'zod']) {
      expect(manifest.dependencies[forbidden]).toBeUndefined();
      expect(manifest.devDependencies[forbidden]).toBeUndefined();
    }
  });

  it('is deterministic across runs', async () => {
    const first = await makeRoot();
    const second = await makeRoot();
    const input = {
      blueprint: phase12Blueprint(),
      components: [synthesizedComponent(), heroComponent()],
      assets: [logoAsset()],
      hooks: [counterHook()]
    };
    await generateProject({}, { ...input, targetRoot: first });
    await generateProject({}, { ...input, targetRoot: second });

    for (const path of ['src/router.tsx', 'src/tokens.ts', 'src/styles/index.css']) {
      expect(await read(first, path)).toBe(await read(second, path));
    }
  });
});

describe('generateProject Blueprint integration', () => {
  it('injects Blueprint routes into the generated router', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [synthesizedComponent(), heroComponent()],
        targetRoot: root
      }
    );

    expect(report.routes.map((route) => route.path).sort()).toEqual(['/', '/about']);
    const router = await read(root, 'src/router.tsx');
    expect(router).toContain('createBrowserRouter');
    expect(router).toContain("import { HomePage } from './pages/HomePage';");
    expect(router).toContain("import { AboutUsPage } from './pages/AboutUsPage';");
    expect(router).toContain('{ index: true');
  });

  it('records a missing page reference without fabricating a route', async () => {
    const root = await makeRoot();
    const blueprint = phase12Blueprint();
    blueprint.routes = [
      {
        path: '/',
        page_id: 'page_home',
        auth_required: false,
        allowed_roles: [],
        redirect_to: null
      },
      {
        path: '/ghost',
        page_id: 'page_missing',
        auth_required: false,
        allowed_roles: [],
        redirect_to: null
      }
    ];

    const report = await generateProject({}, { blueprint, components: [], targetRoot: root });

    expect(report.routes.map((route) => route.path)).toEqual(['/']);
    expect(report.droppedRoutes).toEqual([{ path: '/ghost', reason: 'missing_page' }]);
    expect(report.summary.partial).toBe(true);
  });

  it('integrates Blueprint design tokens without inventing values', async () => {
    const root = await makeRoot();
    await generateProject({}, { blueprint: phase12Blueprint(), components: [], targetRoot: root });
    const tokens = await read(root, 'src/tokens.ts');
    const css = await read(root, 'src/styles/index.css');

    expect(tokens).toContain('"primary-500": "#0ea5e9"');
    expect(tokens).toContain('"sans": ["Inter", "sans-serif"]');
    expect(css).toContain('--color-primary-500: #0ea5e9;');
    expect(css).toContain('--radius-md: 0.375rem;');
    // A category absent from the Blueprint must not be fabricated.
    expect(tokens).not.toContain('tertiary');
  });

  it('rejects an invalid Blueprint without writing any files', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      { blueprint: { blueprint_version: 99 }, components: [], targetRoot: root }
    );

    expect(report.ok).toBe(false);
    expect(report.error?.code).toBe('BLUEPRINT_VALIDATION_FAILED');
    expect(report.files).toEqual([]);
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });
});

describe('generateProject component & hook assembly', () => {
  it('writes synthesized TSX with resolving relative imports', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [synthesizedComponent(), heroComponent()],
        targetRoot: root
      }
    );

    expect(report.components.map((entry) => entry.path).sort()).toEqual([
      'src/components/Button.tsx',
      'src/components/Hero.tsx'
    ]);
    const page = await read(root, 'src/pages/HomePage.tsx');
    expect(page).toContain("import { Hero } from '../components/Hero';");
    expect(page).toContain("import { Button } from '../components/Button';");
    // Required props are supplied neutral defaults so the page type-checks.
    expect(page).toContain('<Hero title={"Hello"} />');
    expect(page).toContain('<Button label={"Click"} />');
  });

  it('resolves duplicate component file names deterministically', async () => {
    const root = await makeRoot();
    const first = synthesizedComponent();
    const second = synthesizedComponent({
      componentId: 'cmp_button_2',
      name: 'Button2',
      fileName: 'Button.tsx'
    });

    const report = await generateProject(
      {},
      { blueprint: phase12Blueprint(), components: [first, second], targetRoot: root }
    );

    expect(report.components.map((entry) => entry.path).sort()).toEqual([
      'src/components/Button.tsx',
      'src/components/Button2.tsx'
    ]);
  });

  it('skips a malformed component and marks the run partial', async () => {
    const root = await makeRoot();
    const bad = synthesizedComponent({
      componentId: 'cmp_bad',
      name: 'not-valid',
      fileName: '../escape.tsx'
    });

    const report = await generateProject(
      {},
      { blueprint: phase12Blueprint(), components: [synthesizedComponent(), bad], targetRoot: root }
    );

    expect(report.ok).toBe(true);
    expect(report.summary.partial).toBe(true);
    expect(report.skipped.some((failure) => failure.code === 'INVALID_COMPONENT_NAME')).toBe(true);
    // The unsafe file name must never have produced a file.
    expect(report.files.some((path) => path.includes('escape'))).toBe(false);
  });

  it('writes hooks under src/hooks with a sanitized name', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      { blueprint: phase12Blueprint(), components: [], hooks: [counterHook()], targetRoot: root }
    );

    expect(report.files).toContain('src/hooks/useCounter.ts');
    expect(await read(root, 'src/hooks/useCounter.ts')).toContain('export function useCounter');
  });
});

describe('generateProject asset assembly', () => {
  it('copies assets under public/assets and reports them', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      { blueprint: phase12Blueprint(), components: [], assets: [logoAsset()], targetRoot: root }
    );

    expect(report.assets).toEqual([{ id: 'asset_logo', path: 'public/assets/logo.png' }]);
    const written = await fs.readFile(join(root, 'public/assets/logo.png'));
    expect(written[0]).toBe(0x89);
  });

  it('skips an asset with no bytes honestly', async () => {
    const root = await makeRoot();
    const report = await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [],
        assets: [{ id: 'asset_missing', path: 'assets/missing.png', mimeType: 'image/png' }],
        targetRoot: root
      }
    );

    expect(report.assets).toEqual([]);
    expect(report.skipped.some((failure) => failure.code === 'ASSET_BYTES_MISSING')).toBe(true);
    expect(report.summary.partial).toBe(true);
  });
});

describe('generateProject independence & events', () => {
  it('emits no ReSite runtime import in any generated source file', async () => {
    const root = await makeRoot();
    await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [synthesizedComponent(), heroComponent()],
        hooks: [counterHook()],
        targetRoot: root
      }
    );

    const sources = [
      'src/main.tsx',
      'src/App.tsx',
      'src/router.tsx',
      'src/tokens.ts',
      'tailwind.config.ts'
    ];
    for (const path of sources) {
      const content = await read(root, path);
      for (const forbidden of ['@tauri-apps', 'zustand', 'sql.js', '/services/', '../stores/']) {
        expect(content).not.toContain(forbidden);
      }
    }
  });

  it('emits project.* lifecycle events with counts only', async () => {
    const root = await makeRoot();
    const { events, sink } = collectEvents();
    await generateProject(
      { events: sink },
      { blueprint: phase12Blueprint(), components: [], targetRoot: root }
    );

    const types = events.map((event) => event.type);
    expect(types).toContain('project.started');
    expect(types).toContain('project.file_generated');
    expect(types).toContain('project.completed');
    const generated = events.find((event) => event.type === 'project.file_generated');
    expect(Object.keys(generated!.payload)).toEqual(expect.arrayContaining(['path', 'bytes']));
  });

  it('honors a pre-aborted signal without writing', async () => {
    const root = await makeRoot();
    const controller = new AbortController();
    controller.abort();
    const report = await generateProject(
      {},
      {
        blueprint: phase12Blueprint(),
        components: [],
        targetRoot: root,
        options: { signal: controller.signal }
      }
    );

    expect(report.ok).toBe(false);
    expect(report.summary.aborted).toBe(true);
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('never throws past its boundary', async () => {
    const root = await makeRoot();
    const spy = vi.fn();
    const report = await generateProject(
      { events: { emit: spy } },
      { blueprint: phase12Blueprint(), components: [], targetRoot: root }
    );
    expect(report.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});
