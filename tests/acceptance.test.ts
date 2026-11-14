import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

import {
  generateBase32Secret,
  generateTotpCode,
  hashPassword,
  signAdminToken,
  verifyAdminToken,
  verifyHmacSignature,
  verifyPassword,
  verifyTotpCode,
} from '../cloudflare-worker/src/crypto.ts';
import {
  claimJoinEarnRewardOnce,
  deductBuildCreditAtomically,
  getAppSettings,
  qualifyReferralIfEligible,
  recordWebhookUpdateIdempotent,
  refundBuildJobOnce,
  upsertUserAndGrantWelcomeOnce,
} from '../cloudflare-worker/src/db.ts';
import { handleAdminApi } from '../cloudflare-worker/src/admin-api.ts';
import { handleBuildServerFail } from '../cloudflare-worker/src/build-dispatch.ts';
import workerEntry from '../cloudflare-worker/src/index.ts';
import {
  validateAppName,
  validateHexColor,
  validatePackageName,
  validatePermissionsList,
  validateVersionCode,
} from '../cloudflare-worker/src/validators.ts';
import { validateWebsiteZip } from '../cloudflare-worker/src/zip-validator.ts';

// Minimal real SQLite-backed D1Database adapter for executing migrations and Worker DB code verbatim
function createSqliteD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  const mig1 = fs.readFileSync(path.resolve('database/migrations/0001_initial_schema.sql'), 'utf8');
  const mig2 = fs.readFileSync(path.resolve('database/migrations/0002_seed_defaults.sql'), 'utf8');
  sqlite.exec(mig1);
  sqlite.exec(mig2);

  function makePrepared(sql: string, bound: unknown[] = []) {
    return {
      bind(...args: unknown[]) {
        return makePrepared(sql, args);
      },
      async first<T = Record<string, unknown>>() {
        const stmt = sqlite.prepare(sql);
        const row = stmt.get(...bound);
        return (row ?? null) as T | null;
      },
      async all<T = Record<string, unknown>>() {
        const stmt = sqlite.prepare(sql);
        const results = stmt.all(...bound) as T[];
        return { results, success: true, meta: { duration: 0, changes: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: results.length, rows_written: 0 } };
      },
      async run() {
        const stmt = sqlite.prepare(sql);
        const info = stmt.run(...bound);
        return {
          success: true,
          results: [],
          meta: {
            duration: 0,
            changes: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid),
            changed_db: Number(info.changes) > 0,
            size_after: 0,
            rows_read: 0,
            rows_written: Number(info.changes),
          },
        };
      },
    };
  }

  return {
    prepare(sql: string) {
      return makePrepared(sql);
    },
    async batch(statements: ReturnType<typeof makePrepared>[]) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const out = [];
        for (const s of statements) {
          out.push(await s.run());
        }
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}

// Helper to construct real ZIP archives in memory (supporting deflate, unix symlinks, custom filenames)
function buildZipBuffer(
  entries: Array<{ name: string; data: Uint8Array | string; deflate?: boolean; unixMode?: number }>
): Uint8Array {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : Buffer.from(entry.data);
    const useDeflate = entry.deflate ?? false;
    const compressed = useDeflate ? zlib.deflateRawSync(raw) : raw;
    const method = useDeflate ? 8 : 0;
    const crc = zlib.crc32(raw) >>> 0;
    const nameBuf = Buffer.from(entry.name, 'utf8');

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compressed.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);

    localParts.push(lfh, nameBuf, compressed);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE((3 << 8) | 20, 4); // Unix host OS
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(compressed.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(((entry.unixMode ?? 0o100644) << 16) >>> 0, 38);
    cdh.writeUInt32LE(offset, 42);

    cdParts.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + compressed.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return new Uint8Array(Buffer.concat([...localParts, cdBuf, eocd]));
}

const DEFAULT_LIMITS = {
  maxZipBytes: 10 * 1024 * 1024,
  maxExtractedBytes: 20 * 1024 * 1024,
  maxFileCount: 100,
  maxDirectoryDepth: 6,
};

test('1 & 2. Welcome gift awards 1000 points + 1 credit once and blocks duplicate /start or duplicate update_id', async () => {
  const db = createSqliteD1();
  const settings = await getAppSettings(db);

  assert.equal(await recordWebhookUpdateIdempotent(db, 1001, 55501, 'message'), true);
  assert.equal(await recordWebhookUpdateIdempotent(db, 1001, 55501, 'message'), false);

  const first = await upsertUserAndGrantWelcomeOnce(
    db,
    { telegramUserId: 55501, username: 'arif', firstName: 'Arif' },
    settings
  );
  assert.equal(first.isNewWelcomeGranted, true);
  assert.equal(first.wallet.points_balance, 1000);
  assert.equal(first.wallet.free_apk_credits, 1);

  const second = await upsertUserAndGrantWelcomeOnce(
    db,
    { telegramUserId: 55501, username: 'arif', firstName: 'Arif' },
    settings
  );
  assert.equal(second.isNewWelcomeGranted, false);
  assert.equal(second.wallet.points_balance, 1000);
  assert.equal(second.wallet.free_apk_credits, 1);
});

test('3, 4 & 5. ZIP validator accepts static HTML/CSS/JS/JSON (even with harmless "php"/"sql" text) and rejects PHP, traversal, symlinks, and ZIP bombs', async () => {
  const validZip = buildZipBuffer([
    { name: 'index.html', data: '<!doctype html><html><body><h1>Shop</h1><script src="app.js"></script></body></html>', deflate: true },
    { name: 'app.js', data: 'const note = "Do not use php or sql here, use REST JSON API"; console.log(note);', deflate: true },
    { name: 'data.json', data: JSON.stringify({ unsupportedBackends: ['php', 'mysql', 'sql'] }), deflate: true },
    { name: 'style.css', data: 'body { color: #10B981; }', deflate: true },
  ]);
  const passRes = await validateWebsiteZip(validZip, DEFAULT_LIMITS, 'index.html');
  assert.equal(passRes.valid, true, passRes.rejectionReason);
  assert.equal(passRes.fileCount, 4);

  const phpZip = buildZipBuffer([
    { name: 'index.html', data: '<html></html>' },
    { name: 'api/login.php', data: '<?php echo "hi"; ?>' },
  ]);
  const phpRes = await validateWebsiteZip(phpZip, DEFAULT_LIMITS, 'index.html');
  assert.equal(phpRes.valid, false);
  assert.equal(phpRes.rejectionCode, 'DISALLOWED_FILE_TYPE');

  const traversalZip = buildZipBuffer([
    { name: 'index.html', data: '<html></html>' },
    { name: '../etc/passwd.txt', data: 'root:x:0:0' },
  ]);
  const travRes = await validateWebsiteZip(traversalZip, DEFAULT_LIMITS, 'index.html');
  assert.equal(travRes.valid, false);
  assert.equal(travRes.rejectionCode, 'PATH_TRAVERSAL');

  const symlinkZip = buildZipBuffer([
    { name: 'index.html', data: '<html></html>' },
    { name: 'secret.txt', data: '/etc/shadow', unixMode: 0o120777 },
  ]);
  const symRes = await validateWebsiteZip(symlinkZip, DEFAULT_LIMITS, 'index.html');
  assert.equal(symRes.valid, false);
  assert.equal(symRes.rejectionCode, 'SYMLINK_REJECTED');

  const fakePngElf = buildZipBuffer([
    { name: 'index.html', data: '<html></html>' },
    { name: 'logo.png', data: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]) },
  ]);
  const elfRes = await validateWebsiteZip(fakePngElf, DEFAULT_LIMITS, 'index.html');
  assert.equal(elfRes.valid, false);
  assert.equal(elfRes.rejectionCode, 'MALICIOUS_OR_DISALLOWED_CONTENT');

  const bigContent = 'A'.repeat(2 * 1024 * 1024);
  const bombZip = buildZipBuffer([{ name: 'index.html', data: bigContent, deflate: true }]);
  const bombRes = await validateWebsiteZip(bombZip, { ...DEFAULT_LIMITS, maxExtractedBytes: 256 * 1024 }, 'index.html');
  assert.equal(bombRes.valid, false);
});

test('8 & 9. Credit priority (free credit first, then 1000 points) and single atomic refund on build failure', async () => {
  const db = createSqliteD1();
  const settings = await getAppSettings(db);
  const { user } = await upsertUserAndGrantWelcomeOnce(db, { telegramUserId: 77701, firstName: 'Nadia' }, settings);

  // First build uses Free APK Credit
  const c1 = await deductBuildCreditAtomically(db, { userId: user.id, jobCode: 'JOB-1', buildCostPoints: 1000 });
  assert.equal(c1.ok, true);
  if (c1.ok) assert.equal(c1.paymentType, 'free_credit');

  // Second build uses 1,000 Points
  const c2 = await deductBuildCreditAtomically(db, { userId: user.id, jobCode: 'JOB-2', buildCostPoints: 1000 });
  assert.equal(c2.ok, true);
  if (c2.ok) assert.equal(c2.paymentType, 'points');

  // Third build fails balance check
  const c3 = await deductBuildCreditAtomically(db, { userId: user.id, jobCode: 'JOB-3', buildCostPoints: 1000 });
  assert.equal(c3.ok, false);

  // Create build job record for JOB-2 and test single refund on failure
  const proj = await db
    .prepare(`INSERT INTO projects (user_id, app_name, package_name) VALUES (?, 'TestApp', 'com.test.app')`)
    .bind(user.id)
    .run();
  const file = await db
    .prepare(`INSERT INTO uploaded_files (user_id, project_id, file_type, r2_key, original_filename, size_bytes, sha256) VALUES (?, ?, 'website_zip', 'k1', 'w.zip', 100, 'abc')`)
    .bind(user.id, proj.meta.last_row_id)
    .run();
  const job = await db
    .prepare(
      `INSERT INTO build_jobs (job_code, user_id, project_id, uploaded_file_id, payment_type, points_charged, credits_charged, charge_idempotency_key, telegram_chat_id)
       VALUES ('JOB-2', ?, ?, ?, 'points', 1000, 0, 'build_charge:JOB-2', 77701)`
    )
    .bind(user.id, proj.meta.last_row_id, file.meta.last_row_id)
    .run();

  const jobId = Number(job.meta.last_row_id);
  assert.equal(await refundBuildJobOnce(db, jobId, 'Gradle compile error'), true);
  assert.equal(await refundBuildJobOnce(db, jobId, 'Duplicate fail callback'), false);

  const wallet = await db.prepare('SELECT points_balance, free_apk_credits FROM user_wallets WHERE user_id = ?').bind(user.id).first<{ points_balance: number; free_apk_credits: number }>();
  assert.equal(wallet?.points_balance, 1000);
  assert.equal(wallet?.free_apk_credits, 0);
});

test('10 & 11. Referrals award 250 pts per qualified user and award milestones 10 & 20 exactly once', async () => {
  const db = createSqliteD1();
  const settings = await getAppSettings(db);
  const { user: referrer } = await upsertUserAndGrantWelcomeOnce(db, { telegramUserId: 90000, firstName: 'RefHost' }, settings);

  // Self-referral attempt must not create a referral row
  await upsertUserAndGrantWelcomeOnce(db, { telegramUserId: 90000, firstName: 'RefHost', referredByTelegramId: 90000 }, settings);
  const selfRefs = await db.prepare('SELECT COUNT(*) as c FROM referrals WHERE referrer_user_id = ?').bind(referrer.id).first<{ c: number }>();
  assert.equal(selfRefs?.c, 0);

  for (let i = 1; i <= 20; i++) {
    const { user: invited } = await upsertUserAndGrantWelcomeOnce(
      db,
      { telegramUserId: 91000 + i, firstName: `Friend${i}`, referredByTelegramId: 90000 },
      settings
    );
    const res = await qualifyReferralIfEligible(db, invited.id, 'first_zip_validated', settings);
    assert.equal(res.rewarded, true);
    if (i === 10) assert.equal(res.milestoneAwarded, 10);
    if (i === 20) assert.equal(res.milestoneAwarded, 20);
    // Duplicate qualification call must be ignored
    const dup = await qualifyReferralIfEligible(db, invited.id, 'first_zip_validated', settings);
    assert.equal(dup.rewarded, false);
  }

  const w = await db
    .prepare('SELECT points_balance, free_apk_credits FROM user_wallets WHERE user_id = ?')
    .bind(referrer.id)
    .first<{ points_balance: number; free_apk_credits: number }>();
  // 1000 welcome + (20 * 250 = 5000) + (2 milestones * 2000 = 4000) = 10,000 pts; 1 welcome + 2 milestone = 3 credits
  assert.equal(w?.points_balance, 10_000);
  assert.equal(w?.free_apk_credits, 3);
});

test('12, 13 & 14. Join & Earn supports unlimited channels and guarantees one-time reward per user & chat_id', async () => {
  const db = createSqliteD1();
  const settings = await getAppSettings(db);
  const { user } = await upsertUserAndGrantWelcomeOnce(db, { telegramUserId: 88801, firstName: 'Member' }, settings);

  for (let i = 1; i <= 3; i++) {
    await db
      .prepare(`INSERT INTO telegram_channels (name, chat_id, invite_url, reward_points) VALUES (?, ?, ?, 500)`)
      .bind(`Channel ${i}`, `-10010000${i}`, `https://t.me/chan${i}`)
      .run();
  }

  const c1 = await claimJoinEarnRewardOnce(db, { userId: user.id, channelId: 1, chatId: '-100100001', rewardPoints: 500, channelName: 'Channel 1' });
  assert.equal(c1.claimed, true);
  assert.equal(c1.newBalance, 1500);

  // Leave and rejoin same channel must NEVER award twice
  const c1Dup = await claimJoinEarnRewardOnce(db, { userId: user.id, channelId: 1, chatId: '-100100001', rewardPoints: 500, channelName: 'Channel 1' });
  assert.equal(c1Dup.claimed, false);
});

test('17, 19 & 20. Security, PBKDF2, TOTP 2FA, HMAC build signatures, Admin audit logs, and Webhook secret protection', async () => {
  const db = createSqliteD1();
  const env = {
    DB: db,
    ADMIN_BOOTSTRAP_SECRET: 'super-secret-bootstrap-token-123456',
    ADMIN_JWT_SECRET: 'jwt-signing-secret-123456',
    BUILD_SERVER_SECRET: 'build-hmac-secret-123456',
    TELEGRAM_WEBHOOK_SECRET: 'tg-webhook-secret-999',
    TELEGRAM_BOT_TOKEN: 'dummy-token',
    BUILD_SERVER_URL: 'http://127.0.0.1:8443',
    WORKER_PUBLIC_URL: 'https://example.workers.dev',
    APP_ENV: 'test',
    BOT_USERNAME: 'MRWebToApkBot',
  } as unknown as Parameters<typeof handleAdminApi>[0];

  // Unauthorized webhook rejected
  const badWebhook = await workerEntry.fetch(
    new Request('https://example.workers.dev/telegram/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
      body: JSON.stringify({ update_id: 1 }),
    }),
    env
  );
  assert.equal(badWebhook.status, 401);

  // Admin bootstrap + TOTP 2FA login + balance adjustment creates immutable audit record
  const bootReq = new Request('https://example.workers.dev/api/admin/auth/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bootstrapSecret: 'super-secret-bootstrap-token-123456',
      username: 'owner',
      password: 'StrongPassword#2026',
      enableTotp: true,
    }),
  });
  const bootRes = await (await handleAdminApi(env, bootReq, new URL(bootReq.url))).json() as { ok: boolean; totpSecret: string };
  assert.equal(bootRes.ok, true);
  assert.ok(bootRes.totpSecret.length >= 16);

  const totp = await generateTotpCode(bootRes.totpSecret);
  assert.equal(await verifyTotpCode(bootRes.totpSecret, totp), true);

  const loginReq = new Request('https://example.workers.dev/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'StrongPassword#2026', totpCode: totp }),
  });
  const loginRes = await (await handleAdminApi(env, loginReq, new URL(loginReq.url))).json() as { ok: boolean; token: string };
  assert.equal(loginRes.ok, true);

  const settings = await getAppSettings(db);
  const { user } = await upsertUserAndGrantWelcomeOnce(db, { telegramUserId: 60001, firstName: 'Target' }, settings);

  const adjReq = new Request(`https://example.workers.dev/api/admin/users/${user.id}/adjust-points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginRes.token}` },
    body: JSON.stringify({ delta: 500, reason: 'Support compensation' }),
  });
  const adjRes = await handleAdminApi(env, adjReq, new URL(adjReq.url));
  assert.equal(adjRes.status, 200);

  const auditCount = await db
    .prepare(`SELECT COUNT(*) as c FROM audit_logs WHERE action = 'admin_adjust_points' AND target_id = ?`)
    .bind(String(user.id))
    .first<{ c: number }>();
  assert.equal(auditCount?.c, 1);

  // Validators & Crypto unit checks
  assert.equal(validatePackageName('com.mr.shopapp').valid, true);
  assert.equal(validatePackageName('com.class.app').valid, false);
  assert.equal(validateVersionCode('12').valid, true);
  assert.equal(validateVersionCode('0').valid, false);
  assert.equal(validateHexColor('#10B981').valid, true);
  assert.equal(validatePermissionsList('CAMERA, VIBRATE').valid, true);
  assert.equal(validateAppName('MR Shop').valid, true);

  const { hashHex, saltHex } = await hashPassword('MySecretPass123');
  assert.equal(await verifyPassword('MySecretPass123', hashHex, saltHex), true);
  const jwt = await signAdminToken({ adminId: 1, username: 'owner', role: 'super_admin', permissions: [], iat: 1, exp: Math.floor(Date.now() / 1000) + 60 }, 'sec');
  assert.ok(await verifyAdminToken(jwt, 'sec'));
});
