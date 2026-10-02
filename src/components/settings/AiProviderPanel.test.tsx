import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiProviderPanel, MAX_RENDERED_MODELS, type AiProviderPanelProps } from './AiProviderPanel';
import type { AIConfig } from '../../types/ai';

const CONFIG: AIConfig = {
  providerId: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.1:8b',
  timeoutMs: 60000,
  updatedAt: ''
};

function props(overrides: Partial<AiProviderPanelProps> = {}): AiProviderPanelProps {
  return {
    status: 'idle',
    config: CONFIG,
    apiKeyInput: '',
    hasStoredKey: false,
    models: [],
    error: null,
    loading: false,
    lastVerifiedAt: null,
    onChangeField: vi.fn(),
    onChangeApiKey: vi.fn(),
    onSelectPreset: vi.fn(),
    onSave: vi.fn(),
    onTest: vi.fn(),
    ...overrides
  };
}

describe('AiProviderPanel', () => {
  it('shows an honest unconfigured state', () => {
    render(<AiProviderPanel {...props({ status: 'unconfigured' })} />);
    expect(screen.getByText('No endpoint configured')).toBeInTheDocument();
  });

  it('only shows the connected badge after a verified check', () => {
    const { rerender } = render(<AiProviderPanel {...props({ status: 'idle' })} />);
    expect(screen.getByText('Not verified')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();

    rerender(
      <AiProviderPanel
        {...props({ status: 'ready', lastVerifiedAt: '2026-01-01T00:00:00.000Z' })}
      />
    );
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByText('Not verified')).not.toBeInTheDocument();
  });

  it('renders a failed state with the real code and message', () => {
    render(
      <AiProviderPanel
        {...props({
          status: 'error',
          error: { code: 'API_KEY_INVALID', message: 'bad key', suggestedAction: 'Fix it.' }
        })}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('API_KEY_INVALID: bad key');
  });

  it('disables the connection test when no endpoint is configured', () => {
    render(<AiProviderPanel {...props({ config: { ...CONFIG, baseUrl: '' } })} />);
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
  });

  it('disables both actions while a test is in flight', () => {
    render(<AiProviderPanel {...props({ status: 'testing' })} />);
    expect(screen.getByRole('button', { name: /testing/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /save configuration/i })).toBeDisabled();
  });

  it('never echoes a stored API key in the input value', () => {
    render(<AiProviderPanel {...props({ hasStoredKey: true, apiKeyInput: '' })} />);
    const keyInput = screen.getByLabelText('API key');
    expect(keyInput).toHaveValue('');
    expect((keyInput as HTMLInputElement).type).toBe('password');
  });

  it('invokes change handlers for fields and the key', async () => {
    const onChangeField = vi.fn();
    const onChangeApiKey = vi.fn();
    render(<AiProviderPanel {...props({ onChangeField, onChangeApiKey })} />);
    await userEvent.type(screen.getByLabelText('Model'), '!');
    expect(onChangeField).toHaveBeenCalledWith('model', expect.any(String));
    await userEvent.type(screen.getByLabelText('API key'), 'k');
    expect(onChangeApiKey).toHaveBeenCalled();
  });

  it('lists real models and bounds the rendered list', () => {
    const models = Array.from({ length: MAX_RENDERED_MODELS + 5 }, (_, i) => `model-${i}`);
    render(<AiProviderPanel {...props({ status: 'ready', models })} />);
    expect(screen.getByText(`${models.length} models available`)).toBeInTheDocument();
    expect(screen.getByText(`+5 more`)).toBeInTheDocument();
  });

  it('reports an empty model list honestly rather than inventing models', () => {
    render(<AiProviderPanel {...props({ status: 'ready', models: [] })} />);
    expect(screen.getByText(/no model list returned/i)).toBeInTheDocument();
  });

  it('calls onSave and onTest when enabled', async () => {
    const onSave = vi.fn();
    const onTest = vi.fn();
    render(<AiProviderPanel {...props({ onSave, onTest })} />);
    await userEvent.click(screen.getByRole('button', { name: /save configuration/i }));
    await userEvent.click(screen.getByRole('button', { name: /test connection/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onTest).toHaveBeenCalledTimes(1);
  });
});
