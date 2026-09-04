import { describe, expect, it } from 'vitest';
import {
  isPublicAddress,
  parsePublicHttpUrl,
  resolvePublicHost,
  UnsafeDestinationError,
} from './network.js';

describe('public destination policy', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('rejects %s', (address) => expect(isPublicAddress(address)).toBe(false));
  it.each(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'])(
    'accepts public address %s',
    (address) => expect(isPublicAddress(address)).toBe(true),
  );
  it('rejects localhost names before DNS', async () => {
    await expect(
      resolvePublicHost('localhost', {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      }),
    ).rejects.toBeInstanceOf(UnsafeDestinationError);
  });
  it('rejects a hostname if any answer is private', async () => {
    await expect(
      resolvePublicHost('rebinding.example', {
        lookup: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
      }),
    ).rejects.toBeInstanceOf(UnsafeDestinationError);
  });
  it.each(['file:///etc/passwd', 'ftp://example.com/x', 'http://user:pass@example.com'])(
    'rejects unsafe URL %s',
    (value) => expect(() => parsePublicHttpUrl(value)).toThrow(UnsafeDestinationError),
  );
});
