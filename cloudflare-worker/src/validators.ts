import type { AppThemeOption, ExternalLinksMode, OrientationOption } from './types.ts';

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null',
]);

export const APPROVED_ANDROID_PERMISSIONS: Record<string, string> = {
  INTERNET: 'android.permission.INTERNET',
  ACCESS_NETWORK_STATE: 'android.permission.ACCESS_NETWORK_STATE',
  CAMERA: 'android.permission.CAMERA',
  RECORD_AUDIO: 'android.permission.RECORD_AUDIO',
  ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
  ACCESS_COARSE_LOCATION: 'android.permission.ACCESS_COARSE_LOCATION',
  POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS',
  VIBRATE: 'android.permission.VIBRATE',
  WAKE_LOCK: 'android.permission.WAKE_LOCK',
};

export function sanitizeText(input: string, maxLength: number): string {
  return input.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

export function validateAppName(name: string): { valid: boolean; value?: string; error?: string } {
  const clean = sanitizeText(name, 30);
  if (clean.length < 2 || clean.length > 30) {
    return { valid: false, error: 'App name must be between 2 and 30 characters.' };
  }
  return { valid: true, value: clean };
}

export function validatePackageName(pkg: string): { valid: boolean; value?: string; error?: string } {
  const clean = pkg.trim().toLowerCase();
  if (clean.length < 5 || clean.length > 100) {
    return { valid: false, error: 'Package name must be 5–100 characters.' };
  }
  const regex = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
  if (!regex.test(clean)) {
    return {
      valid: false,
      error: 'Package name must have at least two dot-separated lowercase segments (e.g., com.mycompany.myapp).',
    };
  }
  const segments = clean.split('.');
  for (const seg of segments) {
    if (JAVA_KEYWORDS.has(seg)) {
      return { valid: false, error: `Package segment "${seg}" is a reserved Java keyword.` };
    }
  }
  return { valid: true, value: clean };
}

export function validateVersionName(ver: string): { valid: boolean; value?: string; error?: string } {
  const clean = ver.trim();
  if (!/^[0-9]+\.[0-9]+(\.[0-9]+)?(-[a-zA-Z0-9._-]+)?$/.test(clean) || clean.length > 24) {
    return { valid: false, error: 'Version Name must look like 1.0 or 1.0.0' };
  }
  return { valid: true, value: clean };
}

export function validateVersionCode(input: string | number): { valid: boolean; value?: number; error?: string } {
  const num = typeof input === 'number' ? input : Number(String(input).trim());
  if (!Number.isInteger(num) || num < 1 || num > 2100000000) {
    return { valid: false, error: 'Version Code must be a positive integer (1 to 2100000000).' };
  }
  return { valid: true, value: num };
}

export function validateHexColor(input: string): { valid: boolean; value?: string; error?: string } {
  let clean = input.trim().toUpperCase();
  if (!clean.startsWith('#')) clean = `#${clean}`;
  if (!/^#[0-9A-F]{6}$/.test(clean)) {
    return { valid: false, error: 'Color must be a 6-digit hex code like #10B981 or #111827.' };
  }
  return { valid: true, value: clean };
}

export function validateOrientation(input: string): OrientationOption | null {
  const norm = input.trim().toLowerCase();
  if (norm === 'portrait' || norm === 'landscape' || norm === 'auto') return norm;
  return null;
}

export function validateAppTheme(input: string): AppThemeOption | null {
  const norm = input.trim().toLowerCase();
  if (norm === 'light' || norm === 'dark' || norm === 'system') return norm;
  return null;
}

export function validatePermissionsList(raw: string | string[]): { valid: boolean; value: string[]; error?: string } {
  const items = (Array.isArray(raw) ? raw : raw.split(/[\s,]+/))
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (items.length === 0 || items.includes('NONE') || items.includes('DEFAULT')) {
    return { valid: true, value: ['INTERNET', 'ACCESS_NETWORK_STATE'] };
  }

  const invalid = items.filter((p) => !(p in APPROVED_ANDROID_PERMISSIONS));
  if (invalid.length > 0) {
    return {
      valid: false,
      value: [],
      error: `Unsupported or restricted permissions: ${invalid.join(', ')}. Allowed: ${Object.keys(APPROVED_ANDROID_PERMISSIONS).join(', ')}`,
    };
  }

  const unique = Array.from(new Set(['INTERNET', 'ACCESS_NETWORK_STATE', ...items]));
  return { valid: true, value: unique };
}

export function validateStartPage(input: string): { valid: boolean; value?: string; error?: string } {
  const clean = input.trim().replace(/^\/+/, '');
  if (!clean || clean.includes('..') || clean.includes('\\') || clean.startsWith('http')) {
    return { valid: false, error: 'Start page must be a relative HTML path inside your ZIP (e.g., index.html).' };
  }
  if (!/^[a-zA-Z0-9_./-]+\.(html|htm)$/i.test(clean)) {
    return { valid: false, error: 'Start page must end with .html or .htm (e.g., index.html).' };
  }
  return { valid: true, value: clean };
}

export function validateExternalLinksInput(
  mode: ExternalLinksMode,
  domainsRaw?: string
): { valid: boolean; mode: ExternalLinksMode; domains: string[]; error?: string } {
  if (mode !== 'whitelist') {
    return { valid: true, mode, domains: [] };
  }
  const domains = (domainsRaw ?? '')
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);

  if (domains.length === 0) {
    return { valid: false, mode, domains: [], error: 'Provide at least one domain for whitelist mode.' };
  }
  const bad = domains.filter((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
  if (bad.length > 0) {
    return { valid: false, mode, domains: [], error: `Invalid domain(s): ${bad.join(', ')}` };
  }
  return { valid: true, mode, domains: Array.from(new Set(domains)) };
}
