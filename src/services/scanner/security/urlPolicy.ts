/**
 * URL & network access policy - Artupski ReSite
 * Source of truth: docs/security/SECURITY.md sections 1 and 6, docs/product/PRD.md,
 * and docs/specs/SCANNER-SPEC.md section 2.2.
 *
 * This module answers one question for every navigation the crawler attempts
 * (the seed, a discovered link, or a redirect target): "may the browser be
 * pointed at this URL?" It is deliberately pure so the TypeScript host and the
 * dedicated Node worker can both enforce the exact same rules.
 *
 * ENFORCEMENT MODEL & DOCUMENTED LIMITATIONS
 * ------------------------------------------
 * A URL policy that only inspects the initial URL is not sufficient, and a
 * hostname string check alone is trivially bypassed. This module therefore:
 *   1. rejects non-HTTP(S) schemes, embedded credentials, malformed URLs,
 *      unusually long URLs, and disallowed ports;
 *   2. classifies the *host* when it is an IP literal (including non-canonical
 *      IPv4 forms such as `2130706433` or `0177.0.0.1`, and IPv6 mappings);
 *   3. when the host is a DNS name, requires the caller to supply the resolved
 *      addresses and rejects the URL if ANY of them is prohibited. The worker
 *      performs this resolution and also pins the browser's DNS lookup to the
 *      already-validated addresses, which closes the DNS-rebinding window
 *      between the check and the actual navigation.
 *
 * Residual limitation: the policy cannot guarantee arbitrary URLs are safe.
 * A compromised DNS resolver, a proxy configured outside the app, or the
 * target site itself issuing requests to third-party hosts from page
 * JavaScript are outside what a URL policy can enforce. The crawler mitigates
 * the latter by restricting the browser context to the validated hosts and by
 * validating every top-level navigation boundary it can observe.
 */
// NOTE: the `.ts` extension is required so the dedicated Node worker (which
// runs these files via Node's native type stripping) can resolve the chain.
import { classifyIpLiteral, type IpBlockReason } from './ipPolicy.ts';

/** Schemes the crawler may ever use. */
export const ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/** Ports the crawler may connect to (80/443 plus a small, common dev range). */
export const ALLOWED_PORTS: readonly number[] = [80, 443, 3000, 3001, 4000, 4173, 5000, 5173, 8000, 8080, 8443, 9099];

/** Hard ceiling on a single URL's length (avoids pathological inputs). */
export const MAX_URL_LENGTH = 2048;

/** Maximum number of redirects before the crawler aborts the chain. */
export const MAX_REDIRECTS = 5;

export type UrlPolicyViolation =
  | 'malformed_url'
  | 'scheme_rejected'
  | 'missing_host'
  | 'credentials_in_url'
  | 'url_too_long'
  | 'port_rejected'
  | 'prohibited_ip'
  | 'unresolvable_host'
  | 'dns_resolution_failed';

export type UrlPolicyDecision =
  | { allowed: true; url: URL }
  | { allowed: false; reason: UrlPolicyViolation; detail?: string; ipReason?: IpBlockReason };

/** Result of resolving a hostname to IP addresses (performed by the worker). */
export type HostResolution =
  | { status: 'resolved'; addresses: string[] }
  | { status: 'failed'; detail?: string };

export interface UrlPolicyOptions {
  allowedProtocols?: readonly string[];
  allowedPorts?: readonly number[];
  maxUrlLength?: number;
  /**
   * Resolve a hostname to its IP literals. The host MUST provide this (the
   * worker wires it to Node's `dns.lookup`) so DNS-based SSRF is rejected; when
   * it is omitted, DNS names are rejected conservatively.
   */
  resolveHost?: (hostname: string) => Promise<HostResolution>;
  /**
   * Origins (`scheme://host:port`) the user explicitly chose as the crawl seed.
   * A seed may legitimately be a loopback/private address (a local dev server
   * the user named on purpose), so a trusted origin is allowed through the
   * private/loopback checks. Cloud metadata and link-local addresses are ALWAYS
   * denied, even for a trusted origin, because they are never a legitimate
   * target. Discovered links and redirects that leave the trusted origin are
   * still subject to the full policy.
   */
  trustedOrigins?: readonly string[];
}

/** Reasons that are never acceptable, even for a user-chosen trusted origin. */
function isNeverTrustable(reason: IpBlockReason | undefined): boolean {
  return reason === 'metadata_service' || reason === 'link_local';
}

function deny(reason: UrlPolicyViolation, detail?: string, ipReason?: IpBlockReason): UrlPolicyDecision {
  const decision: UrlPolicyDecision = { allowed: false, reason };
  if (detail !== undefined) {
    decision.detail = detail;
  }
  if (ipReason !== undefined) {
    decision.ipReason = ipReason;
  }
  return decision;
}

/**
 * Evaluate a URL against the access policy. Every navigation/redirect boundary
 * must call this. Returns a discriminated result (never throws) so callers can
 * surface a precise, non-sensitive reason.
 */
export async function evaluateUrlPolicy(rawUrl: string, options: UrlPolicyOptions = {}): Promise<UrlPolicyDecision> {
  const protocols = options.allowedProtocols ?? ALLOWED_PROTOCOLS;
  const ports = options.allowedPorts ?? ALLOWED_PORTS;
  const maxLength = options.maxUrlLength ?? MAX_URL_LENGTH;

  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return deny('malformed_url', 'Empty URL.');
  }
  if (rawUrl.length > maxLength) {
    return deny('url_too_long', `URL exceeds ${maxLength} characters.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return deny('malformed_url', 'URL could not be parsed.');
  }

  if (!protocols.includes(parsed.protocol)) {
    return deny('scheme_rejected', `Scheme "${parsed.protocol}" is not allowed.`);
  }

  // `URL` exposes credentials separately; reject them without echoing values.
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return deny('credentials_in_url', 'URLs containing credentials are not allowed.');
  }

  const hostname = parsed.hostname;
  if (hostname.length === 0) {
    return deny('missing_host', 'URL has no host.');
  }

  const port = parsed.port.length === 0 ? defaultPort(parsed.protocol) : Number(parsed.port);
  if (!Number.isInteger(port) || !ports.includes(port)) {
    return deny('port_rejected', `Port ${String(port)} is not allowed.`);
  }

  const trustedOrigins = options.trustedOrigins ?? [];
  const trusted = trustedOrigins.includes(parsed.origin);

  // Host is an IP literal: classify directly (catches non-canonical forms).
  const literalClassification = classifyIpLiteral(hostname);
  if (literalClassification) {
    if (literalClassification.allowed) {
      return { allowed: true, url: parsed };
    }
    if (trusted && !isNeverTrustable(literalClassification.reason)) {
      return { allowed: true, url: parsed };
    }
    return deny('prohibited_ip', 'Host resolves to a prohibited address.', literalClassification.reason);
  }

  // Host is a DNS name: require resolution and reject if ANY address is blocked.
  if (!options.resolveHost) {
    return deny('unresolvable_host', 'DNS names cannot be validated without a resolver.');
  }
  const resolution = await options.resolveHost(hostname);
  if (resolution.status === 'failed') {
    return deny('dns_resolution_failed', 'Host could not be resolved.');
  }
  if (resolution.addresses.length === 0) {
    return deny('dns_resolution_failed', 'Host resolved to no addresses.');
  }
  for (const address of resolution.addresses) {
    const classification = classifyIpLiteral(address);
    if (!classification || classification.allowed) {
      continue;
    }
    if (isNeverTrustable(classification.reason) || !trusted) {
      return deny('prohibited_ip', 'Host resolves to a prohibited address.', classification.reason);
    }
  }

  return { allowed: true, url: parsed };
}

/** Default port for a scheme when the URL omits it. */
export function defaultPort(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}

/**
 * Synchronous, host-only screening used to cheaply drop obviously forbidden
 * links during discovery (before spending a DNS lookup). It intentionally does
 * NOT replace `evaluateUrlPolicy` at the navigation boundary.
 */
export function screenUrlShape(rawUrl: string, options: UrlPolicyOptions = {}): UrlPolicyDecision {
  const protocols = options.allowedProtocols ?? ALLOWED_PROTOCOLS;
  const ports = options.allowedPorts ?? ALLOWED_PORTS;
  const maxLength = options.maxUrlLength ?? MAX_URL_LENGTH;

  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return deny('malformed_url', 'Empty URL.');
  }
  if (rawUrl.length > maxLength) {
    return deny('url_too_long', `URL exceeds ${maxLength} characters.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return deny('malformed_url', 'URL could not be parsed.');
  }
  if (!protocols.includes(parsed.protocol)) {
    return deny('scheme_rejected', `Scheme "${parsed.protocol}" is not allowed.`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return deny('credentials_in_url', 'URLs containing credentials are not allowed.');
  }
  if (parsed.hostname.length === 0) {
    return deny('missing_host', 'URL has no host.');
  }
  const port = parsed.port.length === 0 ? defaultPort(parsed.protocol) : Number(parsed.port);
  if (!Number.isInteger(port) || !ports.includes(port)) {
    return deny('port_rejected', `Port ${String(port)} is not allowed.`);
  }
  const literal = classifyIpLiteral(parsed.hostname);
  if (literal && !literal.allowed) {
    const trusted = (options.trustedOrigins ?? []).includes(parsed.origin);
    if (!(trusted && !isNeverTrustable(literal.reason))) {
      return deny('prohibited_ip', 'Host is a prohibited address.', literal.reason);
    }
  }
  return { allowed: true, url: parsed };
}
