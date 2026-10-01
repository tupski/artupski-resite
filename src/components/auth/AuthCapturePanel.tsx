import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { StatusIndicator } from '../ui/StatusIndicator';
import { useAuthStore } from '../../stores/authStore';
import { validateTargetUrl } from '../../lib/url';

/**
 * Interactive authentication capture panel - Artupski ReSite
 * Source of truth: docs/specs/AUTH-SCANNING.md section 2.1.
 *
 * Drives the headed, user-in-the-loop capture flow. The user opens a controlled
 * browser window, signs in manually, then captures the resulting session state.
 * This component never accepts or transmits a credential: the browser window is
 * the only place a password is ever entered, and the application never reads it.
 *
 * Honest states only. `awaiting_login` explicitly means "not finished yet"; a
 * success message appears only after the service confirms a persisted session.
 */
export interface AuthCapturePanelProps {
  /** Owning project for the captured session (null disables capture). */
  projectId: string | null;
  /** The scan target, used to prefill the sign-in URL. */
  targetUrl: string;
  /** True while a crawl is running (capture is disabled then). */
  disabled: boolean;
}

const HTTP_PROTOCOLS = /^https?:\/\//i;

export function AuthCapturePanel({ projectId, targetUrl, disabled }: AuthCapturePanelProps) {
  const captureStatus = useAuthStore((state) => state.captureStatus);
  const authError = useAuthStore((state) => state.error);
  const startCapture = useAuthStore((state) => state.startCapture);
  const completeCapture = useAuthStore((state) => state.completeCapture);
  const cancelCapture = useAuthStore((state) => state.cancelCapture);

  const [loginUrl, setLoginUrl] = useState(targetUrl);

  // Prefill from the scan target whenever a capture is not in progress.
  useEffect(() => {
    if (captureStatus === 'idle' || captureStatus === 'saved' || captureStatus === 'error') {
      setLoginUrl(targetUrl);
    }
  }, [targetUrl, captureStatus]);

  const validation = validateTargetUrl(loginUrl);
  const protocolOk = HTTP_PROTOCOLS.test(loginUrl.trim());
  const urlReady = validation.valid && protocolOk;

  const windowOpen = captureStatus === 'awaiting_login' || captureStatus === 'capturing';
  const blocked = disabled || !projectId;

  return (
    <div className="flex flex-col gap-3 rounded border border-border-subtle bg-surface px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body font-medium text-text-primary">Capture a session</p>
          <p className="text-caption text-text-muted">
            Opens a real browser window. You sign in there; ReSite never sees or stores your
            password.
          </p>
        </div>
        {captureStatus === 'awaiting_login' ? (
          <StatusIndicator tone="active" label="Window open" />
        ) : captureStatus === 'capturing' ? (
          <StatusIndicator tone="active" label="Capturing" pulse />
        ) : captureStatus === 'saved' ? (
          <StatusIndicator tone="success" label="Captured" />
        ) : null}
      </div>

      {windowOpen || captureStatus === 'launching' ? (
        <div className="flex flex-col gap-3">
          <div
            role="status"
            aria-live="polite"
            className="rounded border border-brand/40 bg-brand/10 px-3 py-2 text-caption text-text-secondary"
          >
            {captureStatus === 'launching'
              ? 'Opening the login window…'
              : 'Complete sign-in in the browser window, then choose Capture Session.'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={captureStatus === 'launching' || captureStatus === 'capturing'}
              onClick={() => void completeCapture(projectId, loginUrl)}
            >
              {captureStatus === 'capturing' ? 'Capturing…' : 'Capture Session'}
            </Button>
            <Button
              variant="danger"
              disabled={captureStatus === 'capturing'}
              onClick={() => void cancelCapture()}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Input
            label="Sign-in page URL"
            placeholder="https://app.example.com/login"
            value={loginUrl}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            inputClassName="font-mono text-code"
            onChange={(event) => setLoginUrl(event.target.value)}
            disabled={blocked}
            error={
              loginUrl.trim().length > 0 && !urlReady
                ? 'Enter a full http(s) URL of the page you sign in on.'
                : null
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={blocked || !urlReady}
              onClick={() => void startCapture(projectId, loginUrl)}
            >
              Open login window
            </Button>
            {captureStatus === 'saved' ? (
              <span className="text-caption text-success">
                Session captured and encrypted at rest.
              </span>
            ) : null}
            {captureStatus === 'error' && authError ? (
              <span role="alert" className="text-caption text-danger">
                {authError.message}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
