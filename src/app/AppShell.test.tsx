import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes } from './router';
import { useSettingsStore } from '../stores/settingsStore';
import { useScanStore } from '../stores/scanStore';
import { useAuthStore } from '../stores/authStore';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('application shell', () => {
  beforeEach(() => {
    useScanStore.setState({ targetUrl: '' });
    useSettingsStore.setState({ theme: 'dark' });
    useAuthStore.getState().reset();
  });

  it('renders the primary navigation with active state on the home route', () => {
    renderAt('/');

    const nav = screen.getByRole('navigation', { name: /primary/i });
    const homeLink = within(nav).getByRole('link', { name: /home/i });
    expect(homeLink).toHaveAttribute('href', '/');
    expect(homeLink.className).toContain('text-text-primary');
  });

  it('renders the projects route with an honest storage state', () => {
    renderAt('/projects');
    expect(screen.getByRole('heading', { name: 'Projects', level: 1 })).toBeInTheDocument();
    // Phase 2: the route reads the real database. Storage is not initialized in
    // this shell test, so it must render the honest unavailable state rather
    // than fabricated rows.
    expect(screen.getByText(/local storage is unavailable/i)).toBeInTheDocument();
  });

  it('renders the scan route with configuration controls and a disabled action', () => {
    renderAt('/scan');
    expect(screen.getByRole('heading', { name: 'Scan', level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText(/max crawl depth/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start scan/i })).toBeDisabled();
  });

  it('renders the authentication panel honestly (no fabricated session)', async () => {
    const user = userEvent.setup();
    renderAt('/scan');

    expect(screen.getByRole('heading', { name: 'Authentication', level: 2 })).toBeInTheDocument();

    // No persisted session is available in this shell test, so the "use saved
    // session" choice must be disabled and the state must read "No session".
    const sessionRadio = screen.getByRole('radio', { name: /use saved session/i });
    expect(sessionRadio).toBeDisabled();
    expect(screen.getByRole('radio', { name: /no authentication/i })).toBeChecked();
    expect(screen.getByText(/no session captured for this project/i)).toBeInTheDocument();

    // No credentials are ever rendered.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /no authentication/i }));
  });

  it('renders the settings route and switches theme', async () => {
    const user = userEvent.setup();
    renderAt('/settings');

    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /light/i }));

    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('shows a not-found view for unknown routes', () => {
    renderAt('/does-not-exist');
    expect(screen.getByText(/view not found/i)).toBeInTheDocument();
  });
});

describe('home URL entry', () => {
  beforeEach(() => {
    useScanStore.setState({ targetUrl: '' });
  });

  it('disables the primary action until the URL is valid', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const action = screen.getByRole('button', { name: /configure scan/i });
    expect(action).toBeDisabled();

    await user.type(screen.getByLabelText(/target website url/i), 'example.com');
    expect(action).toBeEnabled();
  });

  it('reports an invalid URL after the field is touched', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const input = screen.getByLabelText(/target website url/i);
    await user.type(input, 'not a url');
    await user.tab();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
