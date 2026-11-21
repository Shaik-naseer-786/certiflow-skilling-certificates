import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { baseUrlOf } from '../src/http.js';

// No database needed: this only decides which address goes into the QR code.
describe('QR address when the app is opened through localhost', () => {
  const reqFor = (host: string) => ({ protocol: 'http', get: () => host }) as never;
  const original = config.publicUrl;
  afterEach(() => {
    config.publicUrl = original;
  });

  it('uses PUBLIC_URL (the computer\'s LAN address) so a phone can reach it', () => {
    config.publicUrl = 'http://192.168.1.50:8080';
    expect(baseUrlOf(reqFor('localhost:8080'))).toBe('http://192.168.1.50:8080');
    expect(baseUrlOf(reqFor('127.0.0.1:8080'))).toBe('http://192.168.1.50:8080');
  });

  it('keeps localhost when nothing better is configured', () => {
    config.publicUrl = 'http://localhost:8080';
    expect(baseUrlOf(reqFor('localhost:8080'))).toBe('http://localhost:8080');
  });

  it('a real address in the request always wins', () => {
    config.publicUrl = 'http://10.0.0.9:8080';
    expect(baseUrlOf(reqFor('192.168.1.77:8080'))).toBe('http://192.168.1.77:8080');
  });
});
