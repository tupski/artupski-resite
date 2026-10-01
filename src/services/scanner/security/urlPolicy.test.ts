import { describe, expect, it } from 'vitest';
import {
  ALLOWED_PORTS,
  MAX_URL_LENGTH,
  defaultPort,
  evaluateUrlPolicy,
  screenUrlShape,
  type HostResolution
} from './urlPolicy';

const resolveTo = (addresses: string[]) => async (): Promise<HostResolution> => ({ status: 'resolved', addresses });
const resolveFail = async (): Promise<HostResolution> => ({ status: 'failed' });

describe('evaluateUrlPolicy - shape', () => {
  it('allows a valid public HTTPS URL', async () => {
    const decision = await evaluateUrlPolicy('https://example.com/page', {
      resolveHost: resolveTo(['93.184.216.34'])
    });
    expect(decision.allowed).toBe(true);
  });

  it('rejects an unsupported scheme', async () => {
    const decision = await evaluateUrlPolicy('ftp://example.com/file');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('scheme_rejected');
    }
  });

  it('rejects malformed URLs', async () => {
    const decision = await evaluateUrlPolicy('not a url');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('malformed_url');
    }
  });

  it('rejects embedded credentials without echoing them', async () => {
    const decision = await evaluateUrlPolicy('https://user:secret@example.com/', {
      resolveHost: resolveTo(['93.184.216.34'])
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('credentials_in_url');
      expect(JSON.stringify(decision)).not.toContain('secret');
    }
  });

  it('rejects an over-long URL', async () => {
    const longUrl = `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`;
    const decision = await evaluateUrlPolicy(longUrl);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('url_too_long');
    }
  });

  it('rejects a disallowed port', async () => {
    const decision = await evaluateUrlPolicy('https://example.com:9999/', {
      resolveHost: resolveTo(['93.184.216.34'])
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('port_rejected');
    }
  });

  it('allows the standard ports and the fixture port', () => {
    expect(ALLOWED_PORTS).toContain(443);
    expect(ALLOWED_PORTS).toContain(9099);
    expect(defaultPort('https:')).toBe(443);
    expect(defaultPort('http:')).toBe(80);
  });
});

describe('evaluateUrlPolicy - IP and DNS', () => {
  it('blocks a loopback IP literal', async () => {
    const decision = await evaluateUrlPolicy('http://127.0.0.1:9099/');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('prohibited_ip');
      expect(decision.ipReason).toBe('loopback');
    }
  });

  it('blocks the cloud metadata address', async () => {
    const decision = await evaluateUrlPolicy('http://169.254.169.254/latest/meta-data/');
    expect(decision.allowed).toBe(false);
  });

  it('blocks a DNS name that resolves to a private address', async () => {
    const decision = await evaluateUrlPolicy('http://rebind.example.com/', {
      resolveHost: resolveTo(['10.0.0.5'])
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('prohibited_ip');
    }
  });

  it('blocks a DNS name with any prohibited address (rebinding)', async () => {
    const decision = await evaluateUrlPolicy('http://mixed.example.com/', {
      resolveHost: resolveTo(['93.184.216.34', '127.0.0.1'])
    });
    expect(decision.allowed).toBe(false);
  });

  it('rejects a DNS name when no resolver is supplied', async () => {
    const decision = await evaluateUrlPolicy('http://example.com/');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('unresolvable_host');
    }
  });

  it('reports DNS resolution failure distinctly', async () => {
    const decision = await evaluateUrlPolicy('http://nope.invalid/', { resolveHost: resolveFail });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('dns_resolution_failed');
    }
  });
});

describe('evaluateUrlPolicy - trusted seed origin', () => {
  it('allows a user-chosen loopback seed origin', async () => {
    const decision = await evaluateUrlPolicy('http://127.0.0.1:9099/crawler', {
      trustedOrigins: ['http://127.0.0.1:9099']
    });
    expect(decision.allowed).toBe(true);
  });

  it('still blocks a metadata address even for a trusted origin', async () => {
    const decision = await evaluateUrlPolicy('http://169.254.169.254/', {
      trustedOrigins: ['http://169.254.169.254']
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.ipReason).toBe('metadata_service');
    }
  });

  it('blocks a private IP that is not the trusted origin', async () => {
    const decision = await evaluateUrlPolicy('http://10.0.0.5/', {
      trustedOrigins: ['http://127.0.0.1:9099']
    });
    expect(decision.allowed).toBe(false);
  });
});

describe('screenUrlShape', () => {
  it('drops obvious violations without DNS', () => {
    expect(screenUrlShape('mailto:x@example.com').allowed).toBe(false);
    expect(screenUrlShape('http://127.0.0.1/').allowed).toBe(false);
    expect(screenUrlShape('https://example.com/').allowed).toBe(true);
  });
});
