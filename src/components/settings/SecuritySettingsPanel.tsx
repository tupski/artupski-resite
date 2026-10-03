/**
 * Security & privacy panel - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-15-impl-plan.md sections 5 (S1/S2), 11,
 * 12 and docs/security/SECURITY.md section 2.1.
 *
 * Reports the honest API-key storage state (present / absent / storage
 * unavailable) for the active provider, allows revoking the stored key, and
 * purges every captured auth session. It NEVER renders, echoes, or logs key
 * material: only a boolean "configured" state and bounded codes cross this
 * boundary. When no OS secret store is available the panel fails closed and
 * says so plainly instead of implying the key is protected.
 *
 * The service calls are injectable so the UI can be unit-tested without a live
 * keychain or database (mirrors the repo's `*ForTests` seam convention).
 */
import { useCallback, useEffect, useState } from 'react';
import type { StructuredError } from '../../services/infra/errors';
import { secretAvailable, getSecret, deleteSecret } from '../../services/security';
import type { SecretResult } from '../../services/security';
import { purgeAllSessions } from '../../services/auth';
import { useAiStore } from '../../stores/aiStore';
import { useUiStore } from '../../stores/uiStore';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { StatusIndicator, type StatusTone } from '../ui/StatusIndicator';

/** The key's persisted state for the active provider. */
export type KeyState = 'checking' | 'present' | 'absent' | 'unavailable';

type MutationResult = { ok: boolean; error?: StructuredError };
type PurgeResult = { ok: true; data: number } | { ok: false; error: StructuredError };

/** Injectable service seam; the default delegates to the live services. */
export interface SecurityDependencies {
  secretAvailable: () => Promise<boolean>;
  getSecret: (account: string) => Promise<SecretResult>;
  deleteSecret: (account: string) => Promise<MutationResult>;
  purgeAllSessions: () => Promise<PurgeResult>;
}

const defaultDependencies: SecurityDependencies = {
  secretAvailable,
  getSecret,
  deleteSecret,
  purgeAllSessions
};

const KEY_STATUS_TONE: Record<KeyState, StatusTone> = {
  checking: 'active',
  present: 'success',
  absent: 'idle',
  unavailable: 'warning'
};

const KEY_STATUS_LABEL: Record<KeyState, string> = {
  checking: 'Checking key storage…',
  present: 'API key stored in the OS keychain',
  absent: 'No API key stored',
  unavailable: 'OS keychain unavailable — key not stored'
};

export interface SecuritySettingsPanelProps {
  /** Provider slug the key is stored under. Defaults to the active AI provider. */
  providerId?: string;
  /** Test seam; merged over the live services. */
  dependencies?: Partial<SecurityDependencies>;
}

export function SecuritySettingsPanel({
  providerId,
  dependencies
}: SecuritySettingsPanelProps) {
  const activeProvider = useAiStore((state) => state.config.providerId);
  const account = (providerId ?? activeProvider ?? 'openai').toLowerCase();

  // Pull the (optional) injected functions out individually with live defaults
  // so each callback has a stable dependency identity. Passing the whole
  // `dependencies` object would change identity every render and re-trigger the
  // key-status effect in a loop.
  const checkAvailable = dependencies?.secretAvailable ?? defaultDependencies.secretAvailable;
  const readSecret = dependencies?.getSecret ?? defaultDependencies.getSecret;
  const removeSecret = dependencies?.deleteSecret ?? defaultDependencies.deleteSecret;
  const purgeSessions = dependencies?.purgeAllSessions ?? defaultDependencies.purgeAllSessions;

  const [keyState, setKeyState] = useState<KeyState>('checking');
  const [keyError, setKeyError] = useState<StructuredError | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeMessage, setPurgeMessage] = useState<string | null>(null);
  const [purgeError, setPurgeError] = useState<StructuredError | null>(null);

  const refreshKeyState = useCallback(async () => {
    setKeyState('checking');
    setKeyError(null);

    const available = await checkAvailable();
    if (!available) {
      setKeyState('unavailable');
      return;
    }

    const result = await readSecret(account);
    if (!result.ok) {
      setKeyState(
        result.error.code === 'SECRET_STORAGE_UNAVAILABLE' ? 'unavailable' : 'absent'
      );
      setKeyError(result.error);
      return;
    }
    setKeyState(result.value !== null ? 'present' : 'absent');
  }, [account, checkAvailable, readSecret]);

  useEffect(() => {
    void refreshKeyState();
  }, [refreshKeyState]);

  const handleRevoke = useCallback(async () => {
    setRevoking(true);
    setKeyError(null);
    try {
      const result = await removeSecret(account);
      if (!result.ok) {
        setKeyError(result.error ?? null);
        if (result.error?.code === 'SECRET_STORAGE_UNAVAILABLE') {
          setKeyState('unavailable');
        }
        return;
      }
      // The keychain service already emits a bounded `security.key_revoked`
      // event; here we only reflect the honest local state.
      setKeyState('absent');
      useUiStore.getState().pushNotice({
        tone: 'success',
        message: 'API key revoked from the OS keychain.'
      });
    } finally {
      setRevoking(false);
    }
  }, [account, removeSecret]);

  const handlePurge = useCallback(async () => {
    setPurging(true);
    setPurgeError(null);
    setPurgeMessage(null);
    try {
      const result = await purgeSessions();
      if (!result.ok) {
        setPurgeError(result.error);
        return;
      }
      setPurgeMessage(
        result.data > 0
          ? `Purged ${result.data} captured session${result.data === 1 ? '' : 's'}.`
          : 'No captured sessions to purge.'
      );
    } finally {
      setPurging(false);
    }
  }, [purgeSessions]);

  const canRevoke = keyState === 'present' && !revoking;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusIndicator tone={KEY_STATUS_TONE[keyState]} label={KEY_STATUS_LABEL[keyState]} />
          <Badge tone={keyState === 'present' ? 'success' : 'neutral'}>
            provider: {account}
          </Badge>
        </div>

        <p className="text-caption text-text-muted">
          {keyState === 'unavailable'
            ? 'No OS credential store is available, so the key is never written to disk. Configure a system keychain (Windows Credential Manager, macOS Keychain, or a running Secret Service on Linux) to store keys securely.'
            : 'The key is stored in the OS keychain and is never written to the application database in plaintext.'}
        </p>

        {keyError ? (
          <div role="alert" className="rounded border border-warning/40 bg-warning/5 p-2.5">
            <p className="text-caption font-medium text-warning">
              {keyError.code}: {keyError.message}
            </p>
            <p className="mt-0.5 text-caption text-text-muted">{keyError.suggestedAction}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={!canRevoke}
            onClick={() => void handleRevoke()}
          >
            {revoking ? 'Revoking…' : 'Revoke key'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={keyState === 'checking'}
            onClick={() => void refreshKeyState()}
          >
            Re-check
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-body text-text-primary">Captured sessions</span>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={purging}
            onClick={() => void handlePurge()}
          >
            {purging ? 'Purging…' : 'Purge captured sessions'}
          </Button>
        </div>
        <p className="text-caption text-text-muted">
          Permanently deletes every stored login session (encrypted cookie state) on this device.
          This cannot be undone.
        </p>
        {purgeMessage ? (
          <p role="status" className="text-caption text-text-secondary">
            {purgeMessage}
          </p>
        ) : null}
        {purgeError ? (
          <div role="alert" className="rounded border border-danger/40 bg-danger/5 p-2.5">
            <p className="text-caption font-medium text-danger">
              {purgeError.code}: {purgeError.message}
            </p>
            <p className="mt-0.5 text-caption text-text-muted">{purgeError.suggestedAction}</p>
          </div>
        ) : null}
      </div>

      <p className="text-caption text-text-muted">
        Secrets are never written to logs or exports. API keys live only in the OS keychain, and
        captured session state is stored as AES-256-GCM ciphertext — never as plaintext.
      </p>
    </div>
  );
}
