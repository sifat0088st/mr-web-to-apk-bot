import type { AdminSessionClaims } from './types.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < arr.length; i++) {
    out += arr[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  const len = Math.max(bufA.length, bufB.length);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < len; i++) {
    const ba = i < bufA.length ? bufA[i]! : 0;
    const bb = i < bufB.length ? bufB[i]! : 0;
    diff |= ba ^ bb;
  }
  return diff === 0;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes =
    typeof data === 'string'
      ? encoder.encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return toHex(digest);
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(sig);
}

export async function verifyHmacSignature(
  secret: string,
  payload: string,
  providedHex: string,
  timestampHeader?: string | null,
  maxSkewSeconds = 300
): Promise<boolean> {
  if (!secret || !providedHex) return false;
  if (timestampHeader) {
    const ts = Number(timestampHeader);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > maxSkewSeconds) {
      return false;
    }
  }
  const signedBody = timestampHeader ? `${timestampHeader}.${payload}` : payload;
  const expected = await hmacSha256Hex(secret, signedBody);
  return timingSafeEqual(expected, providedHex.toLowerCase());
}

export async function hashPassword(password: string, existingSaltHex?: string): Promise<{ hashHex: string; saltHex: string }> {
  const saltBytes = existingSaltHex ? fromHex(existingSaltHex) : crypto.getRandomValues(new Uint8Array(16));
  const saltHex = toHex(saltBytes);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return { hashHex: toHex(derived), saltHex };
}

export async function verifyPassword(password: string, storedHashHex: string, saltHex: string): Promise<boolean> {
  const { hashHex } = await hashPassword(password, saltHex);
  return timingSafeEqual(hashHex, storedHashHex);
}

export async function signAdminToken(claims: AdminSessionClaims, secret: string): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const sigHex = await hmacSha256Hex(secret, signingInput);
  return `${signingInput}.${base64UrlEncode(fromHex(sigHex))}`;
}

export async function verifyAdminToken(token: string, secret: string): Promise<AdminSessionClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  if (!header || !payload || !sig) return null;
  const expectedHex = await hmacSha256Hex(secret, `${header}.${payload}`);
  const expectedB64 = base64UrlEncode(fromHex(expectedHex));
  if (!timingSafeEqual(expectedB64, sig)) return null;
  try {
    const claims = JSON.parse(decoder.decode(base64UrlDecode(payload))) as AdminSessionClaims;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function createSignedDownloadToken(
  payload: { apkId: number; jobCode: string; exp: number },
  secret: string
): Promise<string> {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = await hmacSha256Hex(secret, encoded);
  return `${encoded}.${sig}`;
}

export async function verifySignedDownloadToken(
  token: string,
  secret: string
): Promise<{ apkId: number; jobCode: string; exp: number } | null> {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expected = await hmacSha256Hex(secret, encoded);
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const parsed = JSON.parse(decoder.decode(base64UrlDecode(encoded))) as {
      apkId: number;
      jobCode: string;
      exp: number;
    };
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Base32 RFC 4648 decode for TOTP secrets
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]!);
    if (idx === -1) throw new Error('Invalid Base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export async function generateTotpCode(base32Secret: string, timeStepOffset = 0): Promise<string> {
  const keyBytes = base32Decode(base32Secret);
  const counter = Math.floor(Date.now() / 1000 / 30) + timeStepOffset;
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);

  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBuf));
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export async function verifyTotpCode(base32Secret: string, code: string): Promise<boolean> {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  for (const offset of [-1, 0, 1]) {
    const expected = await generateTotpCode(base32Secret, offset);
    if (timingSafeEqual(expected, normalized)) return true;
  }
  return false;
}

export function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}
