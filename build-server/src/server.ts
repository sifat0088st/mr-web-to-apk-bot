import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import yauzl from 'yauzl';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT ?? '8443');
const BUILD_SERVER_ID = process.env.BUILD_SERVER_ID ?? os.hostname();
const BUILD_SERVER_SECRET = process.env.BUILD_SERVER_SECRET ?? '';
const WORKER_PUBLIC_URL = (process.env.WORKER_PUBLIC_URL ?? '').replace(/\/$/, '');
const TEMPLATE_DIR = process.env.TEMPLATE_DIR ?? path.resolve(process.cwd(), '../android-webview-template');
const WORKSPACES_DIR = process.env.WORKSPACES_DIR ?? path.resolve(process.cwd(), 'workspaces');
const DOCKER_IMAGE = process.env.DOCKER_IMAGE ?? 'mr-web-to-apk/android-builder:latest';
const APK_KEYSTORE_PATH = process.env.APK_KEYSTORE_PATH ?? '';
const APK_KEYSTORE_ALIAS = process.env.APK_KEYSTORE_ALIAS ?? 'mrwebtoapk';
const APK_KEYSTORE_PASS = process.env.APK_KEYSTORE_PASS ?? '';
const APK_KEY_PASS = process.env.APK_KEY_PASS ?? APK_KEYSTORE_PASS;
const MAX_CONCURRENT_BUILDS = Number(process.env.MAX_CONCURRENT_BUILDS ?? '2');
const DOCKER_CPUS = process.env.DOCKER_CPUS ?? '2';
const DOCKER_MEMORY = process.env.DOCKER_MEMORY ?? '2g';

interface BuildJobRequest {
  buildJobId: number;
  jobCode: string;
  attempt: number;
  maxBuildDurationSec: number;
  signingMode: string;
  zipDownloadUrl: string;
  zipSha256: string;
  logoDownloadUrl: string | null;
  splashDownloadUrl: string | null;
  callbackBaseUrl: string;
  appConfig: {
    appName: string;
    packageName: string;
    versionName: string;
    versionCode: number;
    appDescription: string;
    orientation: string;
    statusBarColor: string;
    navBarColor: string;
    appTheme: string;
    permissions: string[];
    startPage: string;
    externalLinksMode: string;
    externalLinksDomains: string[];
  };
}

const activeJobs = new Map<string, { startedAt: number }>();

function signHmac(bodyOrTag: string): { timestamp: string; signature: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac('sha256', BUILD_SERVER_SECRET)
    .update(`${timestamp}.${bodyOrTag}`)
    .digest('hex');
  return { timestamp, signature };
}

function verifyHmac(payload: string, sigHex: string, tsHeader: string | undefined): boolean {
  if (!BUILD_SERVER_SECRET || !sigHex || !tsHeader) return false;
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
  const expected = crypto
    .createHmac('sha256', BUILD_SERVER_SECRET)
    .update(`${tsHeader}.${payload}`)
    .digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sigHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function reportProgress(
  callbackBaseUrl: string,
  buildJobId: number,
  jobCode: string,
  stage: string,
  progressPercent: number,
  logMessage?: string
): Promise<void> {
  const payload = JSON.stringify({
    buildJobId,
    jobCode,
    stage,
    progressPercent,
    logMessage,
    buildServerId: BUILD_SERVER_ID,
  });
  const { timestamp, signature } = signHmac(payload);
  await fetch(`${callbackBaseUrl}/internal/build/progress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MR-Timestamp': timestamp,
      'X-MR-Signature': signature,
    },
    body: payload,
  }).catch(() => {});
}

async function reportFailure(
  callbackBaseUrl: string,
  buildJobId: number,
  jobCode: string,
  stage: string,
  errorMessage: string
): Promise<void> {
  const payload = JSON.stringify({ buildJobId, jobCode, stage, errorMessage });
  const { timestamp, signature } = signHmac(payload);
  await fetch(`${callbackBaseUrl}/internal/build/fail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MR-Timestamp': timestamp,
      'X-MR-Signature': signature,
    },
    body: payload,
  }).catch(() => {});
}

async function extractZipSafely(zipPath: string, destDir: string, maxExtractedBytes = 65 * 1024 * 1024): Promise<void> {
  await fsp.mkdir(destDir, { recursive: true });
  let totalBytes = 0;

  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('Failed to open ZIP'));

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        const entryPath = entry.fileName;
        if (entryPath.startsWith('/') || entryPath.includes('..') || entryPath.includes('\\') || entryPath.includes('\0')) {
          zipfile.close();
          return reject(new Error(`Path traversal rejected: ${entryPath}`));
        }
        const hostOs = entry.versionMadeBy >>> 8;
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (hostOs === 3 && unixMode === 0xa000) {
          zipfile.close();
          return reject(new Error(`Symlink rejected: ${entryPath}`));
        }

        const resolvedTarget = path.resolve(destDir, entryPath);
        if (!resolvedTarget.startsWith(path.resolve(destDir) + path.sep) && resolvedTarget !== path.resolve(destDir)) {
          zipfile.close();
          return reject(new Error(`Resolved path escaped workspace: ${entryPath}`));
        }

        if (/\/$/.test(entryPath)) {
          fsp.mkdir(resolvedTarget, { recursive: true })
            .then(() => zipfile.readEntry())
            .catch((mkErr) => {
              zipfile.close();
              reject(mkErr);
            });
          return;
        }

        zipfile.openReadStream(entry, async (streamErr, readStream) => {
          if (streamErr || !readStream) {
            zipfile.close();
            return reject(streamErr ?? new Error('Read stream failed'));
          }
          await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
          const writeStream = fs.createWriteStream(resolvedTarget);
          readStream.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > maxExtractedBytes) {
              readStream.destroy(new Error('Extracted size limit exceeded during unpack'));
            }
          });
          readStream.on('error', (rErr) => {
            writeStream.close();
            zipfile.close();
            reject(rErr);
          });
          writeStream.on('finish', () => zipfile.readEntry());
          writeStream.on('error', (wErr) => {
            zipfile.close();
            reject(wErr);
          });
          readStream.pipe(writeStream);
        });
      });

      zipfile.on('end', () => resolve());
      zipfile.on('error', (zErr) => reject(zErr));
    });
  });
}

function runDockerBuild(projectDir: string, timeoutSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      'run',
      '--rm',
      '--network=none',
      `--cpus=${DOCKER_CPUS}`,
      `--memory=${DOCKER_MEMORY}`,
      '--pids-limit=256',
      '--security-opt=no-new-privileges:true',
      '-v', `${projectDir}:/workspace`,
      '-w', '/workspace',
      DOCKER_IMAGE,
      'gradle', 'assembleRelease', '--offline', '--no-daemon',
    ];

    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Docker Gradle build exceeded ${timeoutSec}s timeout`));
    }, timeoutSec * 1000);

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Gradle container exited with code ${code}: ${stderr}`));
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function processBuildJob(job: BuildJobRequest): Promise<void> {
  const workspaceDir = path.join(WORKSPACES_DIR, job.jobCode);
  const projectDir = path.join(workspaceDir, 'project');
  const cbUrl = job.callbackBaseUrl.replace(/\/$/, '');

  try {
    await fsp.mkdir(workspaceDir, { recursive: true });
    await reportProgress(cbUrl, job.buildJobId, job.jobCode, 'Extracting files', 25, 'Downloading validated ZIP from private storage');

    const zipResp = await fetch(job.zipDownloadUrl);
    if (!zipResp.ok) throw new Error(`Failed to fetch ZIP: HTTP ${zipResp.status}`);
    const zipBytes = Buffer.from(await zipResp.arrayBuffer());
    const actualSha = crypto.createHash('sha256').update(zipBytes).digest('hex');
    if (actualSha !== job.zipSha256) {
      throw new Error('ZIP SHA-256 integrity verification failed');
    }

    const zipPath = path.join(workspaceDir, 'website.zip');
    await fsp.writeFile(zipPath, zipBytes);

    await reportProgress(cbUrl, job.buildJobId, job.jobCode, 'Android project creation', 45, 'Preparing Android WebView template workspace');
    await fsp.cp(TEMPLATE_DIR, projectDir, { recursive: true });

    const wwwDir = path.join(projectDir, 'app/src/main/assets/www');
    await extractZipSafely(zipPath, wwwDir);

    await reportProgress(cbUrl, job.buildJobId, job.jobCode, 'WebView configuration', 55, 'Applying app name, package, colors, permissions, logo & splash');

    // Download optional logo & splash
    if (job.logoDownloadUrl) {
      const logoResp = await fetch(job.logoDownloadUrl);
      if (logoResp.ok) {
        const logoBytes = Buffer.from(await logoResp.arrayBuffer());
        const mipmapDir = path.join(projectDir, 'app/src/main/res/mipmap-xxxhdpi');
        await fsp.mkdir(mipmapDir, { recursive: true });
        await fsp.writeFile(path.join(mipmapDir, 'ic_launcher.png'), logoBytes);
      }
    }

    let hasSplash = false;
    if (job.splashDownloadUrl) {
      const splashResp = await fetch(job.splashDownloadUrl);
      if (splashResp.ok) {
        const splashBytes = Buffer.from(await splashResp.arrayBuffer());
        const drawableDir = path.join(projectDir, 'app/src/main/res/drawable-nodpi');
        await fsp.mkdir(drawableDir, { recursive: true });
        await fsp.writeFile(path.join(drawableDir, 'splash_screen.png'), splashBytes);
        hasSplash = true;
      }
    }

    // Write parameterized build config
    const sanitizeProp = (v: string) => String(v).replace(/[\r\n\\"]/g, ' ').trim();
    const props = [
      `applicationId=${sanitizeProp(job.appConfig.packageName)}`,
      `versionCode=${job.appConfig.versionCode}`,
      `versionName=${sanitizeProp(job.appConfig.versionName)}`,
      `appName=${sanitizeProp(job.appConfig.appName)}`,
      `startPage=${sanitizeProp(job.appConfig.startPage)}`,
      `statusBarColor=${sanitizeProp(job.appConfig.statusBarColor)}`,
      `navBarColor=${sanitizeProp(job.appConfig.navBarColor)}`,
      `appTheme=${sanitizeProp(job.appConfig.appTheme)}`,
      `orientation=${sanitizeProp(job.appConfig.orientation)}`,
      `externalLinksMode=${sanitizeProp(job.appConfig.externalLinksMode)}`,
      `externalLinksDomains=${sanitizeProp(job.appConfig.externalLinksDomains.join(','))}`,
      `hasSplash=${hasSplash}`,
    ].join('\n');
    await fsp.writeFile(path.join(projectDir, 'app/app_build_config.properties'), props, 'utf8');

    // Inject approved Android permissions into AndroidManifest.xml
    const manifestPath = path.join(projectDir, 'app/src/main/AndroidManifest.xml');
    let manifestXml = await fsp.readFile(manifestPath, 'utf8');
    const extraPerms = job.appConfig.permissions
      .filter((p) => p !== 'INTERNET' && p !== 'ACCESS_NETWORK_STATE')
      .map((p) => `    <uses-permission android:name="android.permission.${p}" />`)
      .join('\n');
    manifestXml = manifestXml.replace('<!-- ADDITIONAL_PERMISSIONS_PLACEHOLDER -->', extraPerms);
    await fsp.writeFile(manifestPath, manifestXml, 'utf8');

    await reportProgress(cbUrl, job.buildJobId, job.jobCode, 'Gradle build', 75, 'Compiling Android APK inside isolated Docker container');
    await runDockerBuild(projectDir, job.maxBuildDurationSec || 300);

    const unsignedApk = path.join(projectDir, 'app/build/outputs/apk/release/app-release-unsigned.apk');
    const alignedApk = path.join(workspaceDir, 'aligned.apk');
    const signedApk = path.join(workspaceDir, 'signed.apk');

    await reportProgress(cbUrl, job.buildJobId, job.jobCode, 'APK signing', 85, 'Aligning and signing APK with release keystore');
    await execFileAsync('zipalign', ['-p', '-f', '4', unsignedApk, alignedApk]);

    if (!APK_KEYSTORE_PATH || !fs.existsSync(APK_KEYSTORE_PATH)) {
      throw new Error('Release APK keystore is not configured at APK_KEYSTORE_PATH');
    }

    await execFileAsync('apksigner', [
      'sign',
      '--ks', APK_KEYSTORE_PATH,
      '--ks-key-alias', APK_KEYSTORE_ALIAS,
      '--ks-pass', `pass:${APK_KEYSTORE_PASS}`,
      '--key-pass', `pass:${APK_KEY_PASS}`,
      '--out', signedApk,
      alignedApk,
    ]);

    await reportProgress(cbUrl, job.buildJobId, job.jobCode, 'APK verification', 95, 'Verifying APK signature and certificate digest');
    const { stdout: verifyOut } = await execFileAsync('apksigner', ['verify', '--verbose', '--print-certs', signedApk]);
    const shaMatch = verifyOut.match(/Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]+)/);
    const certSha256 = shaMatch?.[1] ?? '';

    const apkBuffer = await fsp.readFile(signedApk);
    const apkSha256 = crypto.createHash('sha256').update(apkBuffer).digest('hex');
    const { timestamp, signature } = signHmac(`${job.jobCode}:${apkSha256}`);

    const uploadResp = await fetch(`${cbUrl}/internal/build/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'X-MR-Timestamp': timestamp,
        'X-MR-Signature': signature,
        'X-MR-Job-Numeric-Id': String(job.buildJobId),
        'X-MR-Job-Id': job.jobCode,
        'X-MR-Cert-Sha256': certSha256,
        'X-MR-Signing-Mode': job.signingMode,
        'X-MR-Signature-Verified': 'true',
      },
      body: apkBuffer,
    });

    if (!uploadResp.ok) {
      throw new Error(`Worker upload failed: HTTP ${uploadResp.status}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown build failure';
    await reportFailure(cbUrl, job.buildJobId, job.jobCode, 'Build error', message);
  } finally {
    activeJobs.delete(job.jobCode);
    await fsp.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function sendHeartbeat(): Promise<void> {
  if (!WORKER_PUBLIC_URL || !BUILD_SERVER_SECRET) return;
  let diskFreeGb = 0;
  try {
    const stat = await fsp.statfs(WORKSPACES_DIR);
    diskFreeGb = Number(((stat.bavail * stat.bsize) / (1024 * 1024 * 1024)).toFixed(2));
  } catch {
    diskFreeGb = 0;
  }

  let dockerReady = false;
  try {
    await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}']);
    dockerReady = true;
  } catch {
    dockerReady = false;
  }

  const payload = JSON.stringify({
    status: 'online',
    serverId: BUILD_SERVER_ID,
    activeJobs: activeJobs.size,
    maxConcurrentBuilds: MAX_CONCURRENT_BUILDS,
    cpuLoad1m: Number(os.loadavg()[0]?.toFixed(2) ?? 0),
    ramFreeMb: Math.round(os.freemem() / (1024 * 1024)),
    ramTotalMb: Math.round(os.totalmem() / (1024 * 1024)),
    diskFreeGb,
    dockerReady,
    timestamp: new Date().toISOString(),
  });
  const { timestamp, signature } = signHmac(payload);
  await fetch(`${WORKER_PUBLIC_URL}/internal/build/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MR-Timestamp': timestamp,
      'X-MR-Signature': signature,
    },
    body: payload,
  }).catch(() => {});
}

async function cleanupOrphanWorkspacesOnStartup(): Promise<void> {
  await fsp.mkdir(WORKSPACES_DIR, { recursive: true });
  const entries = await fsp.readdir(WORKSPACES_DIR);
  for (const name of entries) {
    await fsp.rm(path.join(WORKSPACES_DIR, name), { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, serverId: BUILD_SERVER_ID, activeJobs: activeJobs.size }));
    return;
  }

  if (req.url === '/api/v1/jobs' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks).toString('utf8');

    const sig = String(req.headers['x-mr-signature'] ?? '');
    const ts = String(req.headers['x-mr-timestamp'] ?? '');
    if (!verifyHmac(rawBody, sig, ts)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid HMAC signature' }));
      return;
    }

    const job = JSON.parse(rawBody) as BuildJobRequest;
    if (activeJobs.has(job.jobCode)) {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, duplicateIgnored: true }));
      return;
    }
    if (activeJobs.size >= MAX_CONCURRENT_BUILDS) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Build server at capacity; queue should retry' }));
      return;
    }

    activeJobs.set(job.jobCode, { startedAt: Date.now() });
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, accepted: job.jobCode }));

    void processBuildJob(job);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

cleanupOrphanWorkspacesOnStartup().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`MR WEB TO APK Build Agent (${BUILD_SERVER_ID}) listening on port ${PORT}`);
    void sendHeartbeat();
    setInterval(() => void sendHeartbeat(), 30_000);
  });
});
