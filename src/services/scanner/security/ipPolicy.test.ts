import { describe, expect, it } from 'vitest';
import {
  classifyIpLiteral,
  classifyIpv4,
  classifyIpv6,
  isIpLiteral,
  parseIpv4,
  parseIpv6
} from './ipPolicy';

describe('parseIpv4', () => {
  it('parses dotted decimal', () => {
    expect(parseIpv4('127.0.0.1')?.octets).toEqual([127, 0, 0, 1]);
    expect(parseIpv4('8.8.8.8')?.octets).toEqual([8, 8, 8, 8]);
  });

  it('parses non-canonical forms a browser accepts', () => {
    // 2130706433 == 127.0.0.1
    expect(parseIpv4('2130706433')?.octets).toEqual([127, 0, 0, 1]);
    // 0177.0.0.1 (octal 0177 == 127)
    expect(parseIpv4('0177.0.0.1')?.octets).toEqual([127, 0, 0, 1]);
    // 0x7f.0.0.1 (hex 0x7f == 127)
    expect(parseIpv4('0x7f.0.0.1')?.octets).toEqual([127, 0, 0, 1]);
    // 127.1 shorthand == 127.0.0.1
    expect(parseIpv4('127.1')?.octets).toEqual([127, 0, 0, 1]);
  });

  it('rejects malformed input', () => {
    expect(parseIpv4('')).toBeNull();
    expect(parseIpv4('not-an-ip')).toBeNull();
    expect(parseIpv4('256.0.0.1')).toBeNull();
    expect(parseIpv4('1.2.3.4.5')).toBeNull();
  });
});

describe('classifyIpv4', () => {
  const blocked: Array<[string, string]> = [
    ['127.0.0.1', 'loopback'],
    ['10.0.0.5', 'private'],
    ['172.16.0.1', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.1.1', 'link_local'],
    ['169.254.169.254', 'metadata_service'],
    ['100.100.100.200', 'metadata_service'],
    ['0.0.0.0', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast']
  ];

  it.each(blocked)('blocks %s as %s', (address, reason) => {
    const parsed = parseIpv4(address);
    expect(parsed).not.toBeNull();
    const classification = classifyIpv4(parsed!);
    expect(classification.allowed).toBe(false);
    expect(classification.reason).toBe(reason);
  });

  it('allows public addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
      expect(classifyIpv4(parseIpv4(address)!).allowed).toBe(true);
    }
  });

  it('blocks a non-canonical loopback literal', () => {
    expect(classifyIpv4(parseIpv4('2130706433')!).allowed).toBe(false);
    expect(classifyIpv4(parseIpv4('2130706433')!).reason).toBe('loopback');
  });
});

describe('classifyIpv6', () => {
  const blocked: Array<[string, string]> = [
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'unique_local'],
    ['fd12:3456::1', 'unique_local'],
    ['fe80::1', 'link_local'],
    ['ff02::1', 'multicast'],
    ['fd00:ec2::254', 'metadata_service']
  ];

  it.each(blocked)('blocks %s as %s', (address, reason) => {
    const parsed = parseIpv6(address);
    expect(parsed).not.toBeNull();
    const classification = classifyIpv6(parsed!);
    expect(classification.allowed).toBe(false);
    expect(classification.reason).toBe(reason);
  });

  it('blocks an IPv4-mapped loopback', () => {
    const parsed = parseIpv6('::ffff:127.0.0.1');
    expect(parsed).not.toBeNull();
    expect(classifyIpv6(parsed!).allowed).toBe(false);
  });

  it('allows a public IPv6 address', () => {
    const parsed = parseIpv6('2606:4700:4700::1111');
    expect(parsed).not.toBeNull();
    expect(classifyIpv6(parsed!).allowed).toBe(true);
  });

  it('parses an embedded IPv4 with compression', () => {
    expect(parseIpv6('::ffff:8.8.8.8')?.groups).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0808, 0x0808]);
  });
});

describe('classifyIpLiteral', () => {
  it('classifies bracketed IPv6', () => {
    expect(classifyIpLiteral('[::1]')?.allowed).toBe(false);
    expect(classifyIpLiteral('[2606:4700:4700::1111]')?.allowed).toBe(true);
  });

  it('returns null for hostnames', () => {
    expect(classifyIpLiteral('example.com')).toBeNull();
    expect(isIpLiteral('example.com')).toBe(false);
    expect(isIpLiteral('127.0.0.1')).toBe(true);
  });
});
