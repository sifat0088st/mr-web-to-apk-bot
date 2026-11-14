import { enqueueOrDispatchBuild } from './build-dispatch.ts';
import { appendBuildLog, getAppSettings, refundBuildJobOnce, writeAuditLog } from './db.ts';
import { TelegramApiClient } from './telegram.ts';
import type { BuildQueueMessage, Env } from './types.ts';

export async function runScheduledMaintenance(env: Env): Promise<void> {
  const settings = await getAppSettings(env.DB);
  const timeoutSec = Math.max(120, settings.maxBuildDurationSec + 120);

  // 1. Recover timed-out stuck processing jobs (refund once & mark failed)
  const { results: stuckJobs } = await env.DB
    .prepare(
      `SELECT id, job_code, telegram_chat_id
       FROM build_jobs
       WHERE status = 'processing'
         AND updated_at < datetime('now', ?)`
    )
    .bind(`-${timeoutSec} seconds`)
    .all<{ id: number; job_code: string; telegram_chat_id: number }>();

  const tg = env.TELEGRAM_BOT_TOKEN ? new TelegramApiClient(env.TELEGRAM_BOT_TOKEN) : null;

  for (const job of stuckJobs) {
    await env.DB
      .prepare(
        `UPDATE build_jobs
         SET status = 'failed',
             stage = 'Timed out',
             error_message = 'Build server timed out; job recovered by maintenance cron',
             completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND status = 'processing'`
      )
      .bind(job.id)
      .run();

    const refunded = await refundBuildJobOnce(env.DB, job.id, 'Build timeout automatic recovery refund');
    await appendBuildLog(env.DB, job.id, 'error', 'cron_recovery', 'Marked timed-out processing job failed and triggered automatic refund');
    await writeAuditLog(env.DB, {
      actorType: 'system',
      actorId: 'cron-maintenance',
      action: 'stuck_job_recovered',
      targetType: 'build_job',
      targetId: String(job.id),
      reason: 'Exceeded max build timeout',
      after: { refunded },
    });

    if (tg && refunded) {
      await tg
        .sendMessage(
          job.telegram_chat_id,
          `⚠️ বিল্ড জব \`${job.job_code}\` সময়সীমা অতিক্রম করায় বাতিল হয়েছে এবং আপনার পয়েন্ট/ফ্রি ক্রেডিট ফেরত দেওয়া হয়েছে।`
        )
        .catch(() => {});
    }
  }

  // 2. Re-dispatch pending queued jobs (works on both Free D1-queue and Paid Cloudflare Queues)
  const { results: pendingQueued } = await env.DB
    .prepare(
      `SELECT id, job_code, user_id, project_id, uploaded_file_id
       FROM build_jobs
       WHERE status = 'queued'
         AND updated_at < datetime('now', '-2 minutes')
       LIMIT 10`
    )
    .all<{
      id: number;
      job_code: string;
      user_id: number;
      project_id: number;
      uploaded_file_id: number;
    }>();

  for (const qj of pendingQueued) {
    const msg: BuildQueueMessage = {
      buildJobId: qj.id,
      jobCode: qj.job_code,
      userId: qj.user_id,
      projectId: qj.project_id,
      uploadedFileId: qj.uploaded_file_id,
      enqueuedAt: new Date().toISOString(),
    };
    await env.DB
      .prepare(`UPDATE build_jobs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .bind(qj.id)
      .run();
    await enqueueOrDispatchBuild(env, msg);
  }

  // 3. Clean old webhook deduplication rows (> 30 days)
  await env.DB
    .prepare(`DELETE FROM webhook_updates WHERE received_at < datetime('now', '-30 days')`)
    .run();
}
