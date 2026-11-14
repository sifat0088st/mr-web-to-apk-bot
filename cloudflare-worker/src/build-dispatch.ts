import { createSignedDownloadToken, sha256Hex, verifyHmacSignature } from './crypto.ts';
import { appendBuildLog, getAppSettings, qualifyReferralIfEligible, refundBuildJobOnce } from './db.ts';
import { escapeMd, renderProgressMessage, t } from './i18n.ts';
import { signPayloadForBuildServer, TelegramApiClient } from './telegram.ts';
import type { BuildQueueMessage, Env, LanguageCode } from './types.ts';

export async function enqueueOrDispatchBuild(
  env: Env,
  msg: BuildQueueMessage,
  ctx?: ExecutionContext
): Promise<void> {
  if (env.BUILD_QUEUE) {
    await env.BUILD_QUEUE.send(msg);
    return;
  }
  // Cloudflare Free Plan path: job is already persisted in D1 (`status = 'queued'`);
  // dispatch immediately via waitUntil and rely on Free Cron (`*/5 * * * *`) for retry/recovery.
  const task = processBuildQueueMessage(env, msg).catch(() => {});
  if (ctx) {
    ctx.waitUntil(task);
  } else {
    await task;
  }
}

export async function buildSignedJobPayload(env: Env, buildJobId: number, jobCode: string): Promise<{
  payload: string;
  job: Record<string, unknown>;
} | null> {
  const job = await env.DB
    .prepare(
      `SELECT bj.*, p.app_name, p.package_name, p.version_name, p.version_code, p.app_description,
              p.logo_r2_key, p.splash_r2_key, p.orientation, p.status_bar_color, p.nav_bar_color,
              p.app_theme, p.permissions_json, p.start_page, p.external_links_mode, p.external_links_domains_json,
              uf.r2_key AS zip_r2_key, uf.sha256 AS zip_sha256,
              u.telegram_user_id, u.language_code
       FROM build_jobs bj
       JOIN projects p ON p.id = bj.project_id
       JOIN uploaded_files uf ON uf.id = bj.uploaded_file_id
       JOIN users u ON u.id = bj.user_id
       WHERE bj.id = ?`
    )
    .bind(buildJobId)
    .first<Record<string, unknown>>();

  if (!job) return null;

  const settings = await getAppSettings(env.DB);
  const attempt = Number(job.attempt_count ?? 0) + 1;
  const exp = Math.floor(Date.now() / 1000) + 1800; // 30 minutes
  const artifactToken = await createSignedDownloadToken(
    { apkId: buildJobId, jobCode, exp },
    env.BUILD_SERVER_SECRET
  );

  const payload = JSON.stringify({
    buildJobId,
    jobCode,
    attempt,
    maxBuildDurationSec: settings.maxBuildDurationSec,
    signingMode: settings.signingMode,
    zipDownloadUrl: `${env.WORKER_PUBLIC_URL}/internal/artifact/${buildJobId}?type=zip&token=${encodeURIComponent(artifactToken)}`,
    zipSha256: job.zip_sha256,
    logoDownloadUrl: job.logo_r2_key
      ? `${env.WORKER_PUBLIC_URL}/internal/artifact/${buildJobId}?type=logo&token=${encodeURIComponent(artifactToken)}`
      : null,
    splashDownloadUrl: job.splash_r2_key
      ? `${env.WORKER_PUBLIC_URL}/internal/artifact/${buildJobId}?type=splash&token=${encodeURIComponent(artifactToken)}`
      : null,
    callbackBaseUrl: env.WORKER_PUBLIC_URL,
    appConfig: {
      appName: job.app_name,
      packageName: job.package_name,
      versionName: job.version_name,
      versionCode: job.version_code,
      appDescription: job.app_description,
      orientation: job.orientation,
      statusBarColor: job.status_bar_color,
      navBarColor: job.nav_bar_color,
      appTheme: job.app_theme,
      permissions: JSON.parse(String(job.permissions_json ?? '["INTERNET"]')),
      startPage: job.start_page,
      externalLinksMode: job.external_links_mode,
      externalLinksDomains: JSON.parse(String(job.external_links_domains_json ?? '[]')),
    },
  });

  return { payload, job };
}

export async function handleGetJobSpec(env: Env, request: Request, jobId: number): Promise<Response> {
  const sig = request.headers.get('X-MR-Signature') ?? '';
  const ts = request.headers.get('X-MR-Timestamp');
  if (!(await verifyHmacSignature(env.BUILD_SERVER_SECRET, `job:${jobId}`, sig, ts))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const row = await env.DB.prepare('SELECT job_code FROM build_jobs WHERE id = ?').bind(jobId).first<{ job_code: string }>();
  if (!row) return Response.json({ error: 'Job not found' }, { status: 404 });
  const built = await buildSignedJobPayload(env, jobId, row.job_code);
  if (!built) return Response.json({ error: 'Job not found' }, { status: 404 });
  return new Response(built.payload, { headers: { 'Content-Type': 'application/json' } });
}

export async function processBuildQueueMessage(env: Env, msg: BuildQueueMessage): Promise<void> {
  const built = await buildSignedJobPayload(env, msg.buildJobId, msg.jobCode);
  if (!built) return;
  const { payload: dispatchPayload, job } = built;

  if (job.status !== 'queued') {
    return;
  }

  const tg = new TelegramApiClient(env.TELEGRAM_BOT_TOKEN);
  const lang = (job.language_code as LanguageCode) || 'bn';
  const attempt = Number(job.attempt_count ?? 0) + 1;
  const { timestamp, signature } = await signPayloadForBuildServer(env.BUILD_SERVER_SECRET, dispatchPayload);

  try {
    if (env.BUILD_SERVER_URL) {
      const resp = await fetch(`${env.BUILD_SERVER_URL.replace(/\/$/, '')}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MR-Timestamp': timestamp,
          'X-MR-Signature': signature,
          'X-MR-Job-Id': msg.jobCode,
        },
        body: dispatchPayload,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Build server HTTP ${resp.status}: ${errText}`);
      }
    } else if (env.GITHUB_REPO && env.GITHUB_BUILD_TOKEN) {
      // 100% Free Tier GitHub Actions Ubuntu APK Builder dispatch
      const ghResp = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/build-apk.yml/dispatches`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${env.GITHUB_BUILD_TOKEN}`,
            'User-Agent': 'MR-WEB-TO-APK-Worker',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({
            ref: 'main',
            inputs: {
              build_job_id: String(msg.buildJobId),
              job_code: msg.jobCode,
            },
          }),
        }
      );
      if (!ghResp.ok) {
        const errText = await ghResp.text();
        throw new Error(`GitHub Actions dispatch HTTP ${ghResp.status}: ${errText}`);
      }
    } else {
      throw new Error('Neither BUILD_SERVER_URL nor GITHUB_REPO + GITHUB_BUILD_TOKEN is configured');
    }

    await env.DB
      .prepare(
        `UPDATE build_jobs
         SET status = 'processing',
             attempt_count = ?,
             started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND status = 'queued'`
      )
      .bind(attempt, msg.buildJobId)
      .run();

    await appendBuildLog(env.DB, msg.buildJobId, 'info', 'dispatched', `Dispatched to build runner (attempt ${attempt})`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Build server unreachable';
    await appendBuildLog(env.DB, msg.buildJobId, 'warn', 'queue_retry', `Build server offline/unreachable: ${errMsg}`);

    await env.DB
      .prepare(
        `UPDATE build_jobs
         SET attempt_count = ?,
             error_message = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .bind(attempt, `Waiting for build server: ${errMsg}`, msg.buildJobId)
      .run();

    if (job.telegram_progress_message_id) {
      await tg
        .editMessageText(
          Number(job.telegram_chat_id),
          Number(job.telegram_progress_message_id),
          renderProgressMessage(
            lang,
            msg.jobCode,
            String(job.app_name),
            'Waiting in queue (Build server busy/offline)',
            35,
            t(
              lang,
              '⏳ বিল্ড সার্ভার বর্তমানে ব্যস্ত বা রিস্টার্ট হচ্ছে। আপনার জব নিরাপদে কিউতে সংরক্ষিত আছে—স্বয়ংক্রিয়ভাবে আবার চেষ্টা করা হবে।',
              '⏳ Build server is temporarily offline or busy. Your job is safely queued and will resume automatically.'
            )
          )
        )
        .catch(() => {});
    }

    throw err;
  }
}

export async function handleBuildServerProgress(env: Env, request: Request): Promise<Response> {
  const rawBody = await request.text();
  const sig = request.headers.get('X-MR-Signature') ?? '';
  const ts = request.headers.get('X-MR-Timestamp');

  if (!(await verifyHmacSignature(env.BUILD_SERVER_SECRET, rawBody, sig, ts))) {
    return Response.json({ error: 'Invalid HMAC signature' }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as {
    buildJobId: number;
    jobCode: string;
    stage: string;
    progressPercent: number;
    logMessage?: string;
    buildServerId?: string;
  };

  const job = await env.DB
    .prepare(
      `SELECT bj.*, p.app_name, u.language_code
       FROM build_jobs bj
       JOIN projects p ON p.id = bj.project_id
       JOIN users u ON u.id = bj.user_id
       WHERE bj.id = ? AND bj.job_code = ?`
    )
    .bind(body.buildJobId, body.jobCode)
    .first<Record<string, unknown>>();

  if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });
  if (job.status === 'cancelled' || job.status === 'completed' || job.status === 'failed') {
    return Response.json({ ok: true, ignored: true, status: job.status });
  }

  const clampedPct = Math.max(0, Math.min(99, Math.round(body.progressPercent)));

  await env.DB
    .prepare(
      `UPDATE build_jobs
       SET status = 'processing',
           stage = ?,
           progress_percent = ?,
           build_server_id = COALESCE(?, build_server_id),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    )
    .bind(body.stage, clampedPct, body.buildServerId ?? null, body.buildJobId)
    .run();

  if (body.logMessage) {
    await appendBuildLog(env.DB, body.buildJobId, 'info', body.stage, body.logMessage);
  }

  if (job.telegram_progress_message_id) {
    const tg = new TelegramApiClient(env.TELEGRAM_BOT_TOKEN);
    const lang = (job.language_code as LanguageCode) || 'bn';
    await tg
      .editMessageText(
        Number(job.telegram_chat_id),
        Number(job.telegram_progress_message_id),
        renderProgressMessage(lang, body.jobCode, String(job.app_name), body.stage, clampedPct)
      )
      .catch(() => {});
  }

  return Response.json({ ok: true });
}

export async function handleBuildServerComplete(env: Env, request: Request): Promise<Response> {
  const ts = request.headers.get('X-MR-Timestamp');
  const sig = request.headers.get('X-MR-Signature') ?? '';
  const jobIdHeader = Number(request.headers.get('X-MR-Job-Numeric-Id') ?? '0');
  const jobCode = request.headers.get('X-MR-Job-Id') ?? '';
  const signingCertSha256 = request.headers.get('X-MR-Cert-Sha256') ?? '';
  const signingMode = request.headers.get('X-MR-Signing-Mode') ?? 'platform_managed';
  const signatureVerified = request.headers.get('X-MR-Signature-Verified') === 'true' ? 1 : 0;

  const apkBytes = new Uint8Array(await request.arrayBuffer());
  const apkSha256 = await sha256Hex(apkBytes);

  // Signature over timestamp + "." + jobCode + ":" + apkSha256
  if (!(await verifyHmacSignature(env.BUILD_SERVER_SECRET, `${jobCode}:${apkSha256}`, sig, ts))) {
    return Response.json({ error: 'Invalid build completion signature' }, { status: 401 });
  }

  const job = await env.DB
    .prepare(
      `SELECT bj.*, p.app_name, p.package_name, p.version_name, p.version_code, u.telegram_user_id, u.language_code
       FROM build_jobs bj
       JOIN projects p ON p.id = bj.project_id
       JOIN users u ON u.id = bj.user_id
       WHERE bj.id = ? AND bj.job_code = ?`
    )
    .bind(jobIdHeader, jobCode)
    .first<Record<string, unknown>>();

  if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });
  if (job.status === 'completed') return Response.json({ ok: true, duplicate: true });

  const r2Key = `apks/${job.telegram_user_id}/${jobCode}.apk`;
  await env.STORAGE.put(r2Key, apkBytes, {
    httpMetadata: { contentType: 'application/vnd.android.package-archive' },
    customMetadata: {
      jobCode,
      sha256: apkSha256,
      packageName: String(job.package_name),
    },
  });

  const downloadExp = Math.floor(Date.now() / 1000) + 3600 * 24; // 24h signed link
  const downloadSecret = env.DOWNLOAD_SIGNING_SECRET ?? env.BUILD_SERVER_SECRET;

  const apkInsert = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO generated_apks
       (build_job_id, user_id, project_id, r2_key, file_size_bytes, sha256,
        package_name, version_name, version_code, signing_cert_sha256, signing_mode, signature_verified, download_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      jobIdHeader,
      job.user_id,
      job.project_id,
      r2Key,
      apkBytes.byteLength,
      apkSha256,
      job.package_name,
      job.version_name,
      job.version_code,
      signingCertSha256,
      signingMode,
      signatureVerified,
      new Date(downloadExp * 1000).toISOString()
    )
    .run();

  const apkId = Number(apkInsert.meta.last_row_id);
  const signedDownloadToken = await createSignedDownloadToken({ apkId, jobCode, exp: downloadExp }, downloadSecret);
  const downloadTokenHash = await sha256Hex(signedDownloadToken);

  await env.DB
    .prepare('UPDATE generated_apks SET download_token_hash = ? WHERE id = ?')
    .bind(downloadTokenHash, apkId)
    .run();

  const tg = new TelegramApiClient(env.TELEGRAM_BOT_TOKEN);
  const lang = (job.language_code as LanguageCode) || 'bn';
  const downloadUrl = `${env.WORKER_PUBLIC_URL}/download/${encodeURIComponent(signedDownloadToken)}`;
  const safeFilename = `${String(job.app_name).replace(/[^a-zA-Z0-9_-]/g, '_')}_v${job.version_name}.apk`;

  let telegramFileId: string | null = null;
  // Telegram Bot API limit for direct sendDocument is 50 MB
  if (apkBytes.byteLength <= 48 * 1024 * 1024) {
    try {
      const sent = await tg.sendDocumentBytes(
        Number(job.telegram_chat_id),
        safeFilename,
        apkBytes,
        t(
          lang,
          `✅ *${escapeMd(String(job.app_name))}* APK তৈরি সম্পন্ন!\n📦 Package: \`${job.package_name}\`\n🔐 Signed & Verified (${signingMode})\n🔗 ব্যাকআপ ডাউনলোড লিংক (২৪ ঘণ্টা): ${downloadUrl}`,
          `✅ *${escapeMd(String(job.app_name))}* APK Ready!\n📦 Package: \`${job.package_name}\`\n🔐 Signed & Verified (${signingMode})\n🔗 Backup Download (24h): ${downloadUrl}`
        )
      );
      telegramFileId = sent.document?.file_id ?? null;
    } catch {
      await tg.sendMessage(
        Number(job.telegram_chat_id),
        t(
          lang,
          `✅ *${escapeMd(String(job.app_name))}* APK তৈরি সম্পন্ন!\n🔗 ডাউনলোড করুন (২৪ ঘণ্টার জন্য বৈধ): ${downloadUrl}`,
          `✅ *${escapeMd(String(job.app_name))}* APK Ready!\n🔗 Download APK (valid 24h): ${downloadUrl}`
        )
      );
    }
  } else {
    await tg.sendMessage(
      Number(job.telegram_chat_id),
      t(
        lang,
        `✅ *${escapeMd(String(job.app_name))}* APK তৈরি সম্পন্ন! (ফাইল সাইজ > 48MB)\n🔗 ডাউনলোড লিংক: ${downloadUrl}`,
        `✅ *${escapeMd(String(job.app_name))}* APK Ready!\n🔗 Download link: ${downloadUrl}`
      )
    );
  }

  if (telegramFileId) {
    await env.DB.prepare('UPDATE generated_apks SET telegram_file_id = ? WHERE id = ?').bind(telegramFileId, apkId).run();
  }

  await env.DB
    .prepare(
      `UPDATE build_jobs
       SET status = 'completed',
           stage = 'Delivery complete',
           progress_percent = 100,
           completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    )
    .bind(jobIdHeader)
    .run();

  await env.DB.prepare(`UPDATE projects SET status = 'completed' WHERE id = ?`).bind(job.project_id).run();
  await appendBuildLog(env.DB, jobIdHeader, 'info', 'delivery_complete', 'APK verified, stored in private R2, and delivered to user', {
    apkSha256,
    fileSizeBytes: apkBytes.byteLength,
  });

  if (job.telegram_progress_message_id) {
    await tg
      .editMessageText(
        Number(job.telegram_chat_id),
        Number(job.telegram_progress_message_id),
        renderProgressMessage(lang, jobCode, String(job.app_name), 'Delivery complete', 100)
      )
      .catch(() => {});
  }

  const settings = await getAppSettings(env.DB);
  await qualifyReferralIfEligible(env.DB, Number(job.user_id), 'first_build_completed', settings);

  return Response.json({ ok: true, apkId, apkSha256 });
}

export async function handleBuildServerFail(env: Env, request: Request): Promise<Response> {
  const rawBody = await request.text();
  const sig = request.headers.get('X-MR-Signature') ?? '';
  const ts = request.headers.get('X-MR-Timestamp');

  if (!(await verifyHmacSignature(env.BUILD_SERVER_SECRET, rawBody, sig, ts))) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as { buildJobId: number; jobCode: string; stage: string; errorMessage: string };

  const job = await env.DB
    .prepare(
      `SELECT bj.*, p.app_name, u.language_code
       FROM build_jobs bj
       JOIN projects p ON p.id = bj.project_id
       JOIN users u ON u.id = bj.user_id
       WHERE bj.id = ? AND bj.job_code = ?`
    )
    .bind(body.buildJobId, body.jobCode)
    .first<Record<string, unknown>>();

  if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

  await env.DB
    .prepare(
      `UPDATE build_jobs
       SET status = 'failed',
           stage = ?,
           error_message = ?,
           completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND status NOT IN ('completed', 'cancelled')`
    )
    .bind(body.stage || 'Build failed', body.errorMessage, body.buildJobId)
    .run();

  await env.DB.prepare(`UPDATE projects SET status = 'failed' WHERE id = ?`).bind(job.project_id).run();
  await appendBuildLog(env.DB, body.buildJobId, 'error', body.stage || 'failed', body.errorMessage);

  // Automatic single-execution refund on failure
  const refunded = await refundBuildJobOnce(env.DB, body.buildJobId, body.errorMessage);

  const tg = new TelegramApiClient(env.TELEGRAM_BOT_TOKEN);
  const lang = (job.language_code as LanguageCode) || 'bn';

  if (job.telegram_progress_message_id) {
    await tg
      .editMessageText(
        Number(job.telegram_chat_id),
        Number(job.telegram_progress_message_id),
        t(
          lang,
          `❌ *APK বিল্ড ব্যর্থ হয়েছে!*\n🆔 জব: \`${body.jobCode}\`\nকারণ: ${escapeMd(body.errorMessage)}\n` +
            (refunded ? '💰 আপনার ব্যবহৃত পয়েন্ট/ফ্রি ক্রেডিট স্বয়ংক্রিয়ভাবে ফেরত দেওয়া হয়েছে।' : ''),
          `❌ *APK Build Failed!*\n🆔 Job: \`${body.jobCode}\`\nReason: ${escapeMd(body.errorMessage)}\n` +
            (refunded ? '💰 Your deducted points/credit were automatically refunded.' : '')
        )
      )
      .catch(() => {});
  }

  return Response.json({ ok: true, refunded });
}

export async function handleBuildServerHeartbeat(env: Env, request: Request): Promise<Response> {
  const rawBody = await request.text();
  const sig = request.headers.get('X-MR-Signature') ?? '';
  const ts = request.headers.get('X-MR-Timestamp');

  if (!(await verifyHmacSignature(env.BUILD_SERVER_SECRET, rawBody, sig, ts))) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO app_settings (key, value, value_type, description, updated_at)
         VALUES ('build_server_last_heartbeat', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'string', 'Build server heartbeat', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ),
    env.DB
      .prepare(
        `INSERT INTO app_settings (key, value, value_type, description, updated_at)
         VALUES ('build_server_health_json', ?, 'json', 'Build server metrics', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(rawBody),
  ]);

  return Response.json({ ok: true });
}
