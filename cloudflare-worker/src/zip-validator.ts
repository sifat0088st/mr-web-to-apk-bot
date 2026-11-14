import { sha256Hex } from './crypto.ts';
import type { ZipEntrySummary, ZipValidationLimits, ZipValidationResult } from './types.ts';

const ALLOWED_STATIC_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'webmanifest', 'txt', 'xml', 'svg',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'map', 'mp3', 'wav', 'ogg', 'mp4', 'webm', 'pdf',
]);

const BLOCKED_EXTENSIONS = new Set([
  'php', 'php3', 'php4', 'php5', 'phtml', 'phar',
  'sql', 'sqlite', 'sqlite3', 'db',
  'py', 'pyc', 'pyo', 'pyd',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'vbs',
  'exe', 'dll', 'so', 'dylib', 'elf', 'bin', 'msi', 'com', 'scr',
  'apk', 'aab', 'jar', 'war', 'ear', 'dex', 'class',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'iso',
  'rb', 'pl', 'cgi', 'jsp', 'jspx', 'asp', 'aspx', 'cfm', 'wasm',
]);

const textDecoder = new TextDecoder('utf-8', { fatal: false });

function getExtension(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === base.length - 1) return '';
  return base.slice(dotIdx + 1).toLowerCase();
}

function isUnsafePath(rawPath: string): string | null {
  if (!rawPath || rawPath.includes('\u0000')) {
    return 'Archive contains an empty or null-byte filename.';
  }
  if (rawPath.startsWith('/') || rawPath.startsWith('\\') || /^[a-zA-Z]:/.test(rawPath)) {
    return `Absolute path is not allowed in archive: ${rawPath}`;
  }
  if (rawPath.includes('\\')) {
    return `Backslash path separator is not allowed: ${rawPath}`;
  }
  const segments = rawPath.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s === '.' || s === '..')) {
    return `Path traversal segment is not allowed: ${rawPath}`;
  }
  return null;
}

function hasDisallowedMagicBytes(bytes: Uint8Array, ext: string, path: string): string | null {
  if (bytes.length >= 4) {
    // ELF executable: 7F 45 4C 46
    if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
      return `ELF executable binary detected in "${path}"`;
    }
    // Nested ZIP / JAR / APK: PK\x03\x04
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
      return `Nested archive (ZIP/JAR/APK signature) is not allowed: "${path}"`;
    }
    // Mach-O binaries
    if (
      (bytes[0] === 0xfe && bytes[1] === 0xed && bytes[2] === 0xfa && (bytes[3] === 0xce || bytes[3] === 0xcf)) ||
      (bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe)
    ) {
      return `Native Mach-O executable detected in "${path}"`;
    }
    // PE/DOS MZ executable (do not trigger on text files like JSON/JS/HTML that happen to start with "MZ")
    if (
      bytes[0] === 0x4d &&
      bytes[1] === 0x5a &&
      !['txt', 'html', 'htm', 'js', 'mjs', 'json', 'css', 'svg', 'xml', 'map'].includes(ext)
    ) {
      return `Windows PE/MZ executable binary detected in "${path}"`;
    }
    // WebAssembly binary: \0asm
    if (bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d) {
      return `WebAssembly binary is not permitted: "${path}"`;
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08) {
    return `Nested GZIP archive detected in "${path}"`;
  }
  if (bytes.length >= 16) {
    const headerStr = textDecoder.decode(bytes.subarray(0, 16));
    if (headerStr.startsWith('SQLite format 3\u0000')) {
      return `SQLite database binary detected in "${path}"`;
    }
  }

  // Inspect script/HTML headers without falsely rejecting words like "php" or "sql" inside JS or JSON text!
  if (ext === 'html' || ext === 'htm' || ext === 'svg') {
    const head = textDecoder.decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
    if (/^\s*<\?php\b/i.test(head) || /<\?php\s+[\$@a-zA-Z_]/i.test(head)) {
      return `Server-side PHP tag detected inside "${path}". Static HTML/CSS/JS/JSON only.`;
    }
  }

  // Shebang executable scripts disguised with unknown or text-like extensions
  if (bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) {
    const firstLine = textDecoder.decode(bytes.subarray(0, Math.min(bytes.length, 128)));
    if (/^#!\s*\/(usr\/)?(local\/)?(bin|sbin)\/(sh|bash|zsh|python|perl|ruby|php|node)/i.test(firstLine)) {
      return `Executable shell/script shebang detected in "${path}"`;
    }
  }

  // Validate image/font basic signatures if claiming to be raster images
  if (ext === 'png' && bytes.length >= 8) {
    const isPng =
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
    if (!isPng) return `Invalid PNG signature in "${path}"`;
  }
  if ((ext === 'jpg' || ext === 'jpeg') && bytes.length >= 3) {
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
      return `Invalid JPEG signature in "${path}"`;
    }
  }

  // If JSON file, validate JSON syntax
  if (ext === 'json' || ext === 'webmanifest') {
    try {
      JSON.parse(textDecoder.decode(bytes));
    } catch {
      return `Invalid JSON syntax in "${path}"`;
    }
  }

  return null;
}

async function decompressEntryWithLimit(
  compressed: Uint8Array,
  compressionMethod: number,
  maxAllowedBytes: number
): Promise<{ ok: true; data: Uint8Array } | { ok: false; reason: string }> {
  if (compressionMethod === 0) {
    if (compressed.byteLength > maxAllowedBytes) {
      return { ok: false, reason: 'Entry exceeds maximum extracted size limit.' };
    }
    return { ok: true, data: compressed };
  }

  if (compressionMethod !== 8) {
    return { ok: false, reason: `Unsupported ZIP compression method (${compressionMethod}).` };
  }

  const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxAllowedBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore stream cancel errors
        }
        return { ok: false, reason: 'ZIP bomb protection: decompressed bytes exceeded safe limit.' };
      }
      chunks.push(value);
    }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, data: out };
}

function findEocdOffset(bytes: Uint8Array): number {
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

export async function validateWebsiteZip(
  zipBuffer: ArrayBuffer | Uint8Array,
  limits: ZipValidationLimits,
  requiredStartPage = 'index.html'
): Promise<ZipValidationResult> {
  const bytes = zipBuffer instanceof Uint8Array ? zipBuffer : new Uint8Array(zipBuffer);
  const sha256 = await sha256Hex(bytes);

  const fail = (rejectionCode: string, rejectionReason: string): ZipValidationResult => ({
    valid: false,
    sha256,
    fileCount: 0,
    extractedSizeBytes: 0,
    maxDepth: 0,
    rejectionCode,
    rejectionReason,
    files: [],
  });

  if (bytes.byteLength === 0) {
    return fail('EMPTY_FILE', 'Uploaded ZIP file is empty.');
  }
  if (bytes.byteLength > limits.maxZipBytes) {
    return fail(
      'ZIP_TOO_LARGE',
      `ZIP file size (${bytes.byteLength} bytes) exceeds limit (${limits.maxZipBytes} bytes).`
    );
  }
  if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return fail('INVALID_ZIP_SIGNATURE', 'File is not a valid ZIP archive.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocdOffset(bytes);
  if (eocdOffset < 0) {
    return fail('CORRUPT_ZIP', 'Could not locate ZIP End of Central Directory.');
  }

  const diskNum = view.getUint16(eocdOffset + 4, true);
  const cdDisk = view.getUint16(eocdOffset + 6, true);
  if (diskNum !== 0 || cdDisk !== 0) {
    return fail('MULTI_DISK_UNSUPPORTED', 'Multi-disk ZIP archives are not supported.');
  }

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  if (cdOffset + cdSize > eocdOffset) {
    return fail('CORRUPT_CENTRAL_DIRECTORY', 'ZIP Central Directory bounds are invalid.');
  }

  let cursor = cdOffset;
  let fileCount = 0;
  let totalExtractedBytes = 0;
  let maxDepth = 0;
  let hasStartPage = false;
  const normalizedStart = requiredStartPage.replace(/^\/+/, '');
  const files: ZipEntrySummary[] = [];
  const seenPaths = new Set<string>();

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > cdOffset + cdSize) {
      return fail('CORRUPT_CENTRAL_DIRECTORY', 'Truncated ZIP Central Directory entry.');
    }
    const sig = view.getUint32(cursor, true);
    if (sig !== 0x02014b50) {
      return fail('CORRUPT_CENTRAL_DIRECTORY', 'Invalid Central Directory signature.');
    }

    const versionMadeBy = view.getUint16(cursor + 4, true);
    const flags = view.getUint16(cursor + 8, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const externalAttrs = view.getUint32(cursor + 38, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    if (cursor + 46 + nameLen + extraLen + commentLen > cdOffset + cdSize) {
      return fail('CORRUPT_CENTRAL_DIRECTORY', 'Central Directory entry exceeds directory bounds.');
    }

    const rawName = textDecoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;

    // Symlink check (Unix file mode S_IFLNK = 0120000 = 0xA000)
    const hostOs = versionMadeBy >> 8;
    const unixMode = (externalAttrs >>> 16) & 0xf000;
    if ((hostOs === 3 || hostOs === 19) && unixMode === 0xa000) {
      return fail('SYMLINK_REJECTED', `Symbolic links are not permitted in ZIP archives: "${rawName}"`);
    }

    if ((flags & 0x0001) !== 0) {
      return fail('ENCRYPTED_ARCHIVE', `Password-protected / encrypted entries are not permitted: "${rawName}"`);
    }

    const pathIssue = isUnsafePath(rawName);
    if (pathIssue) {
      return fail('PATH_TRAVERSAL', pathIssue);
    }

    // Skip macOS metadata resource forks cleanly if directory, or reject hidden dangerous files
    if (rawName.endsWith('/')) {
      const depth = rawName.split('/').filter(Boolean).length;
      if (depth > limits.maxDirectoryDepth) {
        return fail('MAX_DEPTH_EXCEEDED', `Directory depth (${depth}) exceeds limit (${limits.maxDirectoryDepth}).`);
      }
      continue;
    }

    if (seenPaths.has(rawName)) {
      return fail('DUPLICATE_ENTRY', `Duplicate ZIP entry path detected: "${rawName}"`);
    }
    seenPaths.add(rawName);

    fileCount += 1;
    if (fileCount > limits.maxFileCount) {
      return fail('MAX_FILES_EXCEEDED', `File count exceeds maximum limit of ${limits.maxFileCount} files.`);
    }

    const segments = rawName.split('/').filter(Boolean);
    const depth = Math.max(0, segments.length - 1);
    if (depth > maxDepth) maxDepth = depth;
    if (depth > limits.maxDirectoryDepth) {
      return fail('MAX_DEPTH_EXCEEDED', `Directory depth (${depth}) for "${rawName}" exceeds limit (${limits.maxDirectoryDepth}).`);
    }

    // ZIP bomb ratio check before decompressing
    if (compressedSize > 0 && uncompressedSize > 1_048_576 && uncompressedSize / compressedSize > 150) {
      return fail('ZIP_BOMB_RATIO', `Suspicious compression ratio detected for "${rawName}".`);
    }
    if (totalExtractedBytes + uncompressedSize > limits.maxExtractedBytes) {
      return fail(
        'EXTRACTED_SIZE_EXCEEDED',
        `Total extracted size exceeds limit of ${limits.maxExtractedBytes} bytes.`
      );
    }

    const ext = getExtension(rawName);
    if (!ext) {
      return fail('DISALLOWED_EXTENSION', `Files without an extension are not permitted: "${rawName}"`);
    }
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return fail(
        'DISALLOWED_FILE_TYPE',
        `Disallowed backend/executable/archive file "${rawName}" (.${ext}). Only static web assets are supported.`
      );
    }
    if (!ALLOWED_STATIC_EXTENSIONS.has(ext)) {
      return fail('UNAPPROVED_EXTENSION', `Unsupported file extension ".${ext}" in "${rawName}".`);
    }

    // Read Local File Header & payload
    if (localHeaderOffset + 30 > bytes.byteLength) {
      return fail('CORRUPT_LOCAL_HEADER', `Invalid local header offset for "${rawName}".`);
    }
    const localSig = view.getUint32(localHeaderOffset, true);
    if (localSig !== 0x04034b50) {
      return fail('CORRUPT_LOCAL_HEADER', `Invalid local file header signature for "${rawName}".`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.byteLength) {
      return fail('CORRUPT_ENTRY_DATA', `Compressed entry data out of bounds for "${rawName}".`);
    }

    const remainingQuota = limits.maxExtractedBytes - totalExtractedBytes;
    const decompressed = await decompressEntryWithLimit(
      bytes.subarray(dataStart, dataEnd),
      compressionMethod,
      remainingQuota
    );
    if (!decompressed.ok) {
      return fail('DECOMPRESSION_FAILED', `${rawName}: ${decompressed.reason}`);
    }

    // Verify actual uncompressed size matches declared size (catches forged headers / ZIP bombs)
    if (decompressed.data.byteLength !== uncompressedSize) {
      return fail('SIZE_MISMATCH_ZIP_BOMB', `Declared size mismatch detected in "${rawName}".`);
    }

    const magicIssue = hasDisallowedMagicBytes(decompressed.data, ext, rawName);
    if (magicIssue) {
      return fail('MALICIOUS_OR_DISALLOWED_CONTENT', magicIssue);
    }

    totalExtractedBytes += decompressed.data.byteLength;
    if (rawName === normalizedStart || rawName.toLowerCase() === 'index.html' && normalizedStart === 'index.html') {
      if (rawName === normalizedStart) {
        hasStartPage = true;
      }
    }

    files.push({
      path: rawName,
      compressedSize,
      uncompressedSize: decompressed.data.byteLength,
      extension: ext,
    });
  }

  if (!hasStartPage) {
    return fail(
      'MISSING_INDEX_HTML',
      `Required start page "${normalizedStart}" was not found at the root of your ZIP archive.`
    );
  }

  return {
    valid: true,
    sha256,
    fileCount,
    extractedSizeBytes: totalExtractedBytes,
    maxDepth,
    files,
  };
}
