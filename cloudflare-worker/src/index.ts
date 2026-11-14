import { handleAdminApi } from './admin-api.ts';
import {
  handleBuildServerComplete,
  handleBuildServerFail,
  handleBuildServerHeartbeat,
  handleBuildServerProgress,
  handleGetJobSpec,
  processBuildQueueMessage,
} from './build-dispatch.ts';
import { timingSafeEqual, verifySignedDownloadToken } from './crypto.ts';
import { runScheduledMaintenance } from './cron.ts';
import { RateLimiterDO } from './durable-objects/rate-limiter.ts';
import { handleTelegramWebhook } from './telegram.ts';
import type { BuildQueueMessage, Env, TelegramUpdate } from './types.ts';

export { RateLimiterDO };

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    try {
      // Health check endpoint
      if (path === '/health' && request.method === 'GET') {
        await env.DB.prepare('SELECT 1').first();
        return withCors(
          Response.json({
            ok: true,
            service: 'MR WEB TO APK BOT',
            env: env.APP_ENV,
            timestamp: new Date().toISOString(),
          })
        );
      }

      // Telegram Webhook endpoint (strictly verifies X-Telegram-Bot-Api-Secret-Token)
      if (path === '/telegram/webhook' && request.method === 'POST') {
        const providedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
        if (!env.TELEGRAM_WEBHOOK_SECRET || !timingSafeEqual(providedSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
          return Response.json({ error: 'Unauthorized webhook secret' }, { status: 401 });
        }
        const update = (await request.json()) as TelegramUpdate;
        return await handleTelegramWebhook(env, update, ctx);
      }

      // Signed job specification fetch for GitHub Actions / external build runners
      const jobSpecMatch = path.match(/^\/internal\/job\/(\d+)$/);
      if (jobSpecMatch && request.method === 'GET') {
        return await handleGetJobSpec(env, request, Number(jobSpecMatch[1]));
      }

      // Internal signed artifact fetch for external Linux Build Server / GitHub Actions runner
      const artifactMatch = path.match(/^\/internal\/artifact\/(\d+)$/);
      if (artifactMatch && request.method === 'GET') {
        const jobId = Number(artifactMatch[1]);
        const token = url.searchParams.get('token') ?? '';
        const type = url.searchParams.get('type') ?? 'zip';
        const claims = await verifySignedDownloadToken(token, env.BUILD_SERVER_SECRET);
        if (!claims || claims.apkId !== jobId) {
          return Response.json({ error: 'Invalid or expired artifact token' }, { status: 401 });
        }
        const row = await env.DB
          .prepare(
            `SELECT uf.r2_key AS zip_key, p.logo_r2_key, p.splash_r2_key
             FROM build_jobs bj
             JOIN uploaded_files uf ON uf.id = bj.uploaded_file_id
             JOIN projects p ON p.id = bj.project_id
             WHERE bj.id = ?`
          )
          .bind(jobId)
          .first<{ zip_key: string; logo_r2_key: string | null; splash_r2_key: string | null }>();

        if (!row) return Response.json({ error: 'Job not found' }, { status: 404 });
        const r2Key = type === 'logo' ? row.logo_r2_key : type === 'splash' ? row.splash_r2_key : row.zip_key;
        if (!r2Key) return Response.json({ error: 'Artifact not found' }, { status: 404 });

        const obj = await env.STORAGE.get(r2Key);
        if (!obj) return Response.json({ error: 'R2 object missing' }, { status: 404 });

        return new Response(obj.body, {
          headers: {
            'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
          },
        });
      }

      // Internal Build Server Callbacks
      if (path === '/internal/build/progress' && request.method === 'POST') {
        return await handleBuildServerProgress(env, request);
      }
      if (path === '/internal/build/complete' && request.method === 'POST') {
        return await handleBuildServerComplete(env, request);
      }
      if (path === '/internal/build/fail' && request.method === 'POST') {
        return await handleBuildServerFail(env, request);
      }
      if (path === '/internal/build/heartbeat' && request.method === 'POST') {
        return await handleBuildServerHeartbeat(env, request);
      }

      // Short-lived signed APK download endpoint
      const downloadMatch = path.match(/^\/download\/(.+)$/);
      if (downloadMatch && request.method === 'GET') {
        const token = decodeURIComponent(downloadMatch[1]!);
        const secret = env.DOWNLOAD_SIGNING_SECRET ?? env.BUILD_SERVER_SECRET;
        const claims = await verifySignedDownloadToken(token, secret);
        if (!claims) {
          return new Response('Download link expired or invalid.', { status: 403 });
        }
        const apk = await env.DB
          .prepare('SELECT r2_key, package_name, version_name FROM generated_apks WHERE id = ?')
          .bind(claims.apkId)
          .first<{ r2_key: string; package_name: string; version_name: string }>();
        if (!apk) return new Response('APK not found.', { status: 404 });

        const obj = await env.STORAGE.get(apk.r2_key);
        if (!obj) return new Response('APK file expired from storage.', { status: 404 });

        return new Response(obj.body, {
          headers: {
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Disposition': `attachment; filename="${apk.package_name}-v${apk.version_name}.apk"`,
            'Cache-Control': 'private, no-store',
          },
        });
      }

      // Admin REST API
      if (path.startsWith('/api/admin/')) {
        return withCors(await handleAdminApi(env, request, url));
      }

      return withCors(Response.json({ error: 'Not found' }, { status: 404 }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return withCors(Response.json({ error: message }, { status: 500 }));
    }
  },

  async queue(batch: MessageBatch<BuildQueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processBuildQueueMessage(env, message.body);
        message.ack();
      } catch {
        message.retry({ delaySeconds: 30 });
      }
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledMaintenance(env));
  },
};
