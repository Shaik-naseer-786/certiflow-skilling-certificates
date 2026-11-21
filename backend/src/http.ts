import type { Request } from 'express';
import { config } from './config.js';

// "localhost", 127.x.x.x and ::1 only mean "this same machine". A phone that scans a QR code
// containing one of them would look for the server on ITSELF and fail.
const isLoopbackUrl = (url: string) => {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h.startsWith('127.') || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
};

// The address to put inside QR codes and printed links.
// - Opened through a real address (e.g. http://192.168.1.5:8080): use that address.
// - Opened through localhost: use PUBLIC_URL instead, if it is a real address
//   (start-lan.ps1 / start-lan.sh set it to this computer's Wi-Fi/LAN address).
// - Otherwise nothing better is known, so fall back to what the caller used.
export function baseUrlOf(req: Request) {
  const own = `${req.protocol}://${req.get('host')}`;
  if (isLoopbackUrl(own) && !isLoopbackUrl(config.publicUrl)) return config.publicUrl;
  return own;
}
