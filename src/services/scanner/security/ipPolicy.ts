/**
 * IP address access policy - Artupski ReSite
 * Source of truth: docs/security/SECURITY.md sections 1 and 6, docs/product/PRD.md.
 *
 * The crawler must never be steered at loopback, private, link-local, or
 * cloud metadata-service addresses. Hostname string checks are NOT sufficient
 * (an attacker can use a decimal/octal/hex IPv4 literal, an IPv6 mapping, or a
 * DNS name that resolves to a forbidden address), so this module classifies the
 * resolved IP address itself.
 *
 * This module is intentionally pure and environment-agnostic (it does not
 * import `node:net`) so it can be shared by the TypeScript host and the
 * dedicated Node worker, and tested without a runtime.
 */

export type IpAddressKind = 'ipv4' | 'ipv6';

export type IpBlockReason =
  | 'loopback'
  | 'private'
  | 'link_local'
  | 'unique_local'
  | 'multicast'
  | 'unspecified'
  | 'broadcast'
  | 'reserved'
  | 'metadata_service'
  | 'ipv4_mapped_private';

export interface IpClassification {
  kind: IpAddressKind;
  /** True when the address may be navigated to. */
  allowed: boolean;
  /** Present when `allowed` is false. */
  reason?: IpBlockReason;
}

// ---------------------------------------------------------------------------
// IPv4
// ---------------------------------------------------------------------------

export interface Ipv4Address {
  /** Four octets in the range 0-255. */
  octets: [number, number, number, number];
  /** The original textual form (kept for safe, non-sensitive error details). */
  literal: string;
}

/**
 * Parse an IPv4 literal, including the non-canonical forms a browser accepts:
 * dotted decimal, a single 32-bit integer (decimal/hex/octal), and the mixed
 * `a.b.c.d` / `a.b.c` / `a.b` / `a` shorthand.
 *
 * Returns `null` when the input is not a syntactically valid IPv4 literal.
 */
export function parseIpv4(input: string): Ipv4Address | null {
  const literal = input.trim();
  if (literal.length === 0) {
    return null;
  }

  // Dotted form (2, 3, or 4 parts). Every part may itself be hex/octal.
  if (literal.includes('.')) {
    const parts = literal.split('.');
    if (parts.length < 2 || parts.length > 4) {
      return null;
    }
    const numbers: number[] = [];
    for (const part of parts) {
      const value = parseIpv4Part(part);
      if (value === null) {
        return null;
      }
      numbers.push(value);
    }
    // The final part may carry the remaining octets (e.g. 127.1 == 127.0.0.1).
    const last = numbers[numbers.length - 1]!;
    const maxLast = 2 ** (8 * (5 - numbers.length));
    if (last >= maxLast) {
      return null;
    }
    let value = last;
    for (let i = numbers.length - 2; i >= 0; i -= 1) {
      value += numbers[i]! * 2 ** (8 * (3 - i));
    }
    const octets = toOctets(value);
    return octets ? { octets, literal } : null;
  }

  // Single 32-bit integer form.
  const value = parseIpv4Part(literal);
  if (value === null) {
    return null;
  }
  const octets = toOctets(value);
  return octets ? { octets, literal } : null;
}

/** Parse one IPv4 part: decimal, 0x-prefixed hex, or 0-prefixed octal. */
function parseIpv4Part(part: string): number | null {
  if (part.length === 0) {
    return null;
  }
  let value: number;
  if (/^0x[0-9a-fA-F]+$/.test(part)) {
    value = Number.parseInt(part.slice(2), 16);
  } else if (/^0[0-7]+$/.test(part)) {
    value = Number.parseInt(part.slice(1), 8);
  } else if (/^\d+$/.test(part)) {
    value = Number.parseInt(part, 10);
  } else {
    return null;
  }
  if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) {
    return null;
  }
  return value;
}

function toOctets(value: number): [number, number, number, number] | null {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    return null;
  }
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function ipv4ToNumber(octets: [number, number, number, number]): number {
  return ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
}

function inRange(value: number, base: number, prefixBits: number): boolean {
  const mask = prefixBits === 0 ? 0 : (0xffffffff << (32 - prefixBits)) >>> 0;
  return (value & mask) === (base & mask);
}

/** Classify an IPv4 address against the crawler access policy. */
export function classifyIpv4(address: Ipv4Address): IpClassification {
  const value = ipv4ToNumber(address.octets);

  const block = (reason: IpBlockReason): IpClassification => ({
    kind: 'ipv4',
    allowed: false,
    reason
  });

  // Cloud metadata services (AWS/GCP/Azure/Alibaba, and the 100.100.100.200 alias).
  if (value === ipv4ToNumber([169, 254, 169, 254]) || value === ipv4ToNumber([100, 100, 100, 200])) {
    return block('metadata_service');
  }
  if (inRange(value, ipv4ToNumber([0, 0, 0, 0]), 8)) {
    return block('unspecified');
  }
  if (inRange(value, ipv4ToNumber([127, 0, 0, 0]), 8)) {
    return block('loopback');
  }
  if (inRange(value, ipv4ToNumber([10, 0, 0, 0]), 8)) {
    return block('private');
  }
  if (inRange(value, ipv4ToNumber([172, 16, 0, 0]), 12)) {
    return block('private');
  }
  if (inRange(value, ipv4ToNumber([192, 168, 0, 0]), 16)) {
    return block('private');
  }
  if (inRange(value, ipv4ToNumber([169, 254, 0, 0]), 16)) {
    return block('link_local');
  }
  if (inRange(value, ipv4ToNumber([100, 64, 0, 0]), 10)) {
    return block('private');
  }
  if (inRange(value, ipv4ToNumber([192, 0, 0, 0]), 24)) {
    return block('reserved');
  }
  if (inRange(value, ipv4ToNumber([192, 0, 2, 0]), 24)) {
    return block('reserved');
  }
  if (inRange(value, ipv4ToNumber([198, 18, 0, 0]), 15)) {
    return block('reserved');
  }
  if (inRange(value, ipv4ToNumber([198, 51, 100, 0]), 24)) {
    return block('reserved');
  }
  if (inRange(value, ipv4ToNumber([203, 0, 113, 0]), 24)) {
    return block('reserved');
  }
  if (value === 0xffffffff) {
    return block('broadcast');
  }
  if (inRange(value, ipv4ToNumber([224, 0, 0, 0]), 4)) {
    return block('multicast');
  }
  if (inRange(value, ipv4ToNumber([240, 0, 0, 0]), 4)) {
    return block('reserved');
  }

  return { kind: 'ipv4', allowed: true };
}

// ---------------------------------------------------------------------------
// IPv6
// ---------------------------------------------------------------------------

export interface Ipv6Address {
  /** Eight 16-bit groups, in network order. */
  groups: [number, number, number, number, number, number, number, number];
  literal: string;
}

/**
 * Parse an IPv6 literal, including `::` compression, a trailing embedded IPv4
 * (e.g. `::ffff:127.0.0.1`), and an optional zone id (`fe80::1%eth0`).
 */
export function parseIpv6(input: string): Ipv6Address | null {
  let literal = input.trim();
  const zoneIndex = literal.indexOf('%');
  if (zoneIndex !== -1) {
    literal = literal.slice(0, zoneIndex);
  }
  if (!literal.includes(':')) {
    return null;
  }

  // Rewrite a trailing embedded IPv4 (e.g. `::ffff:127.0.0.1`) as two hex
  // groups so the remainder parses as a pure-hex IPv6 literal.
  const lastColon = literal.lastIndexOf(':');
  const tail = literal.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) {
      return null;
    }
    const value = ipv4ToNumber(v4.octets);
    const high = ((value >>> 16) & 0xffff).toString(16);
    const low = (value & 0xffff).toString(16);
    literal = `${literal.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const doubleColon = literal.indexOf('::');
  let headParts: string[];
  let tailParts: string[];
  if (doubleColon === -1) {
    headParts = literal.split(':');
    tailParts = [];
  } else {
    const head = literal.slice(0, doubleColon);
    const tailStr = literal.slice(doubleColon + 2);
    headParts = head.length === 0 ? [] : head.split(':');
    tailParts = tailStr.length === 0 ? [] : tailStr.split(':');
  }

  const head = parseIpv6Groups(headParts);
  const tailGroups = parseIpv6Groups(tailParts);
  if (!head || !tailGroups) {
    return null;
  }

  const total = head.length + tailGroups.length;
  const hasCompression = doubleColon !== -1;
  if (hasCompression ? total > 8 : total !== 8) {
    return null;
  }

  const groups: number[] = [...head];
  if (hasCompression) {
    const fill = 8 - total;
    for (let i = 0; i < fill; i += 1) {
      groups.push(0);
    }
  }
  groups.push(...tailGroups);

  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) {
    return null;
  }
  return { groups: groups as Ipv6Address['groups'], literal: input.trim() };
}

function parseIpv6Groups(parts: string[]): number[] | null {
  const groups: number[] = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > 4 || !/^[0-9a-fA-F]+$/.test(part)) {
      return null;
    }
    groups.push(Number.parseInt(part, 16));
  }
  return groups;
}

function ipv6Equals(groups: number[], expected: number[]): boolean {
  return groups.every((group, index) => group === expected[index]);
}

function ipv6InRange(groups: number[], prefixHex: string, prefixBits: number): boolean {
  // Compare bit by bit against a 32-hex-char (128-bit) prefix.
  const normalizedPrefix = prefixHex.replace(/:/g, '').padEnd(32, '0');
  let bits = prefixBits;
  for (let i = 0; i < 8 && bits > 0; i += 1) {
    const groupBits = Math.min(16, bits);
    const shift = 16 - groupBits;
    const group = groups[i]!;
    const prefixGroup = Number.parseInt(normalizedPrefix.slice(i * 4, i * 4 + 4) || '0', 16);
    if ((group >> shift) !== (prefixGroup >> shift)) {
      return false;
    }
    bits -= groupBits;
  }
  return true;
}

/** Classify an IPv6 address against the crawler access policy. */
export function classifyIpv6(address: Ipv6Address): IpClassification {
  const groups = address.groups;
  const allZero = groups.every((group) => group === 0);

  const block = (reason: IpBlockReason): IpClassification => ({
    kind: 'ipv6',
    allowed: false,
    reason
  });

  // Unspecified (::)
  if (allZero) {
    return block('unspecified');
  }

  // Loopback ::1/128
  if (ipv6Equals(groups, [0, 0, 0, 0, 0, 0, 0, 1])) {
    return block('loopback');
  }

  // IPv4-mapped (::ffff:0:0/96): re-classify the embedded IPv4 so 127.x /
  // private mappings are caught. Checked AFTER loopback/unspecified so `::1`
  // and `::` are not misclassified as mapped addresses.
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    const value = ((groups[6]! << 16) + groups[7]!) >>> 0;
    const octets = toOctets(value);
    if (octets) {
      const embedded = classifyIpv4({ octets, literal: address.literal });
      if (!embedded.allowed) {
        return block('ipv4_mapped_private');
      }
    }
  }

  // Cloud metadata service (AWS IMDSv6): fd00:ec2::254
  if (ipv6Equals(groups, [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254])) {
    return block('metadata_service');
  }

  // Unique local fc00::/7
  if (ipv6InRange(groups, 'fc00', 7)) {
    return block('unique_local');
  }

  // Link-local fe80::/10
  if (ipv6InRange(groups, 'fe80', 10)) {
    return block('link_local');
  }

  // Multicast ff00::/8
  if (ipv6InRange(groups, 'ff00', 8)) {
    return block('multicast');
  }

  // Documentation / reserved 2001:db8::/32
  if (ipv6InRange(groups, '20010db8', 32)) {
    return block('reserved');
  }

  return { kind: 'ipv6', allowed: true };
}

// ---------------------------------------------------------------------------
// Unified entrypoint
// ---------------------------------------------------------------------------

/**
 * Classify a bare IP literal (v4 or v6, including bracketed IPv6). Returns
 * `null` when the input is not a recognisable IP literal so callers can treat
 * it as a hostname instead.
 */
export function classifyIpLiteral(input: string): IpClassification | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const unbracketed = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;

  const ipv4 = parseIpv4(unbracketed);
  if (ipv4) {
    return classifyIpv4(ipv4);
  }
  const ipv6 = parseIpv6(unbracketed);
  if (ipv6) {
    return classifyIpv6(ipv6);
  }
  return null;
}

/** True when the hostname is a syntactically valid IP literal (v4 or v6). */
export function isIpLiteral(hostname: string): boolean {
  return classifyIpLiteral(hostname) !== null;
}
