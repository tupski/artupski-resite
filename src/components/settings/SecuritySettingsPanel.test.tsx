import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecuritySettingsPanel, type SecurityDependencies } from './SecuritySettingsPanel';
import { createStructuredError } from '../../services/infra/errors';
import { useUiStore } from '../../stores/uiStore';

function deps(overrides: Partial<SecurityDependencies> = {}): SecurityDependencies {
  return {
    secretAvailable: vi.fn(async () => true),
    getSecret: vi.fn(async () => ({ ok: true as const, value: 'sk-secret-value' })),
    deleteSecret: vi.fn(async () => ({ ok: true })),
    purgeAllSessions: vi.fn(async () => ({ ok: true as const, data: 2 })),
    ...overrides
  };
}

describe('SecuritySettingsPanel', () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarExpanded: true, notices: [] });
  });

  it('reports a stored key honestly when one is present', async () => {
    render(<SecuritySettingsPanel providerId="openai" dependencies={deps()} />);
    expect(await screen.findByText(/api key stored in the os keychain/i)).toBeInTheDocument();
  });

  it('reports an absent key without fabricating one', async () => {
    render(
      <SecuritySettingsPanel
        providerId="openai"
        dependencies={deps({ getSecret: vi.fn(async () => ({ ok: true as const, value: null })) })}
      />
    );
    expect(await screen.findByText(/no api key stored/i)).toBeInTheDocument();
  });

  it('fails closed and says so when no OS secret store is available', async () => {
    const getSecret = vi.fn();
    render(
      <SecuritySettingsPanel
        providerId="openai"
        dependencies={deps({ secretAvailable: vi.fn(async () => false), getSecret })}
      />
    );
    expect(
      await screen.findByText(/os keychain unavailable — key not stored/i)
    ).toBeInTheDocument();
    // Never probes for a key when the store itself is unavailable.
    expect(getSecret).not.toHaveBeenCalled();
  });

  it('revokes the key through the injected keychain and reflects the honest state', async () => {
    const user = userEvent.setup();
    const deleteSecret = vi.fn(async () => ({ ok: true }));
    render(
      <SecuritySettingsPanel providerId="openai" dependencies={deps({ deleteSecret })} />
    );

    await screen.findByText(/api key stored in the os keychain/i);
    await user.click(screen.getByRole('button', { name: /revoke key/i }));

    expect(deleteSecret).toHaveBeenCalledWith('openai');
    expect(await screen.findByText(/no api key stored/i)).toBeInTheDocument();
  });

  it('renders an honest error when revoke fails', async () => {
    const user = userEvent.setup();
    const failure = createStructuredError({
      code: 'SECRET_WRITE_FAILED',
      category: 'io',
      message: 'The credential store rejected the delete.',
      suggestedAction: 'Retry.'
    });
    render(
      <SecuritySettingsPanel
        providerId="openai"
        dependencies={deps({ deleteSecret: vi.fn(async () => ({ ok: false, error: failure })) })}
      />
    );

    await screen.findByText(/api key stored in the os keychain/i);
    await user.click(screen.getByRole('button', { name: /revoke key/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/SECRET_WRITE_FAILED/);
  });

  it('purges captured sessions and reports the honest count', async () => {
    const user = userEvent.setup();
    const purgeAllSessions = vi.fn(async () => ({ ok: true as const, data: 3 }));
    render(
      <SecuritySettingsPanel providerId="openai" dependencies={deps({ purgeAllSessions })} />
    );

    await user.click(screen.getByRole('button', { name: /purge captured sessions/i }));

    expect(purgeAllSessions).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/purged 3 captured sessions/i)).toBeInTheDocument();
  });

  it('reports an honest empty purge state when nothing exists', async () => {
    const user = userEvent.setup();
    render(
      <SecuritySettingsPanel
        providerId="openai"
        dependencies={deps({ purgeAllSessions: vi.fn(async () => ({ ok: true as const, data: 0 })) })}
      />
    );

    await user.click(screen.getByRole('button', { name: /purge captured sessions/i }));
    expect(await screen.findByText(/no captured sessions to purge/i)).toBeInTheDocument();
  });

  it('states that secrets are never logged or exported', async () => {
    render(<SecuritySettingsPanel providerId="openai" dependencies={deps()} />);
    await waitFor(() =>
      expect(screen.getByText(/secrets are never written to logs or exports/i)).toBeInTheDocument()
    );
  });

  it('never renders a secret value', async () => {
    render(<SecuritySettingsPanel providerId="openai" dependencies={deps()} />);
    await screen.findByText(/api key stored in the os keychain/i);
    expect(screen.queryByText(/sk-secret-value/)).not.toBeInTheDocument();
  });
});
