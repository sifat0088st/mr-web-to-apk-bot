import {
  generateBase32Secret,
  hashPassword,
  signAdminToken,
  timingSafeEqual,
  verifyAdminToken,
  verifyPassword,
  verifyTotpCode,
} from './crypto.ts';
import { enqueueOrDispatchBuild } from './build-dispatch.ts';
import { appendBuildLog, refundBuildJobOnce, writeAuditLog } from './db.ts';
import { TelegramApiClient } from './telegram.ts';
import type { AdminSessionClaims, BuildQueueMessage, Env } from './types.ts';

function getJwtSecret(env: Env): string {
  return env.ADMIN_JWT_SECRET ?? env.ADMIN_BOOTSTRAP_SECRET;
}

async function authenticateAdmin(
  env: Env,
  request: Request,
  requiredPermission?: string
): Promise<{ ok: true; claims: AdminSessionClaims } | { ok: false; response: Response }> {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    return { ok: false, response: Response.json({ error: 'Missing Bearer token' }, { status: 401 }) };
  }
  const token = auth.slice(7).trim();
  const claims = await verifyAdminToken(token, getJwtSecret(env));
  if (!claims) {
    return { ok: false, response: Response.json({ error: 'Invalid or expired admin session' }, { status: 401 }) };
  }
  if (requiredPermission && !claims.permissions.includes(requiredPermission) && claims.role !== 'super_admin') {
    return { ok: false, response: Response.json({ error: 'Forbidden: insufficient permissions' }, { status: 403 }) };
  }
  return { ok: true, claims };
}

export async function handleAdminApi(env: Env, request: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

  // 1. Bootstrap initial super_admin (only when no active super_admin exists or authenticated with ADMIN_BOOTSTRAP_SECRET)
  if (path === '/api/admin/auth/bootstrap' && method === 'POST') {
    const body = (await request.json()) as {
      bootstrapSecret: string;
      username: string;
      password: string;
      email?: string;
      enableTotp?: boolean;
    };

    if (!env.ADMIN_BOOTSTRAP_SECRET || !timingSafeEqual(body.bootstrapSecret ?? '', env.ADMIN_BOOTSTRAP_SECRET)) {
      return Response.json({ error: 'Invalid bootstrap secret' }, { status: 403 });
    }
    if (!body.username || !body.password || body.password.length < 10) {
      return Response.json({ error: 'Username and password (min 10 chars) are required' }, { status: 400 });
    }

    const { hashHex, saltHex } = await hashPassword(body.password);
    const totpSecret = body.enableTotp ? generateBase32Secret() : null;

    await env.DB
      .prepare(
        `INSERT INTO admin_users (username, email, password_hash, password_salt, role_id, totp_secret_encrypted, totp_enabled)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .bind(body.username.trim(), body.email ?? null, hashHex, saltHex, totpSecret, totpSecret ? 1 : 0)
      .run();

    await writeAuditLog(env.DB, {
      actorType: 'system',
      actorId: 'bootstrap',
      action: 'admin_created',
      targetType: 'admin_user',
      targetId: body.username.trim(),
      reason: 'Initial super_admin bootstrap',
      ipAddress: ip,
    });

    return Response.json({
      ok: true,
      username: body.username.trim(),
      role: 'super_admin',
      totpSecret: totpSecret ?? undefined,
    });
  }

  // 2. Admin login (password + optional TOTP 2FA)
  if (path === '/api/admin/auth/login' && method === 'POST') {
    const body = (await request.json()) as { username: string; password: string; totpCode?: string };
    const admin = await env.DB
      .prepare(
        `SELECT au.*, ar.name AS role_name
         FROM admin_users au
         JOIN admin_roles ar ON ar.id = au.role_id
         WHERE au.username = ? AND au.is_active = 1`
      )
      .bind((body.username ?? '').trim())
      .first<{
        id: number;
        username: string;
        password_hash: string;
        password_salt: string;
        role_id: number;
        role_name: string;
        totp_secret_encrypted: string | null;
        totp_enabled: number;
      }>();

    if (!admin || !(await verifyPassword(body.password ?? '', admin.password_hash, admin.password_salt))) {
      await writeAuditLog(env.DB, {
        actorType: 'system',
        actorId: body.username ?? 'unknown',
        action: 'admin_login_failed',
        targetType: 'admin_auth',
        targetId: body.username ?? 'unknown',
        reason: 'Invalid username or password',
        ipAddress: ip,
      });
      return Response.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    if (admin.totp_enabled === 1 && admin.totp_secret_encrypted) {
      if (!body.totpCode) {
        return Response.json({ error: 'Two-factor authentication code required', totpRequired: true }, { status: 401 });
      }
      const okTotp = await verifyTotpCode(admin.totp_secret_encrypted, body.totpCode);
      if (!okTotp) {
        return Response.json({ error: 'Invalid 2FA TOTP code', totpRequired: true }, { status: 401 });
      }
    }

    const { results: permRows } = await env.DB
      .prepare('SELECT permission_key FROM admin_permissions WHERE role_id = ?')
      .bind(admin.role_id)
      .all<{ permission_key: string }>();

    const nowSec = Math.floor(Date.now() / 1000);
    const claims: AdminSessionClaims = {
      adminId: admin.id,
      username: admin.username,
      role: admin.role_name,
      permissions: permRows.map((p) => p.permission_key),
      iat: nowSec,
      exp: nowSec + 3600 * 12,
    };
    const token = await signAdminToken(claims, getJwtSecret(env));

    await env.DB
      .prepare(`UPDATE admin_users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .bind(admin.id)
      .run();

    await writeAuditLog(env.DB, {
      actorType: 'admin',
      actorId: String(admin.id),
      action: 'admin_login',
      targetType: 'admin_user',
      targetId: String(admin.id),
      reason: 'Dashboard session started',
      ipAddress: ip,
    });

    return Response.json({ ok: true, token, admin: { id: admin.id, username: admin.username, role: admin.role_name, permissions: claims.permissions } });
  }

  // All routes below require authenticated admin session
  const authResult = await authenticateAdmin(env, request);
  if (!authResult.ok) return authResult.response;
  const admin = authResult.claims;

  // 3. Dashboard Overview Stats
  if (path === '/api/admin/stats' && method === 'GET') {
    const [
      userCounts,
      uploadCounts,
      buildCounts,
      ledgerTotals,
      referralTotals,
      joinEarnTotals,
      serverHealthRow,
      maintenanceRow,
    ] = await Promise.all([
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total_users,
                  SUM(CASE WHEN last_active_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS active_users
           FROM users`
        )
        .first<{ total_users: number; active_users: number | null }>(),
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total_uploads,
                  SUM(CASE WHEN validation_status = 'rejected' THEN 1 ELSE 0 END) AS rejected_uploads
           FROM uploaded_files WHERE file_type = 'website_zip'`
        )
        .first<{ total_uploads: number; rejected_uploads: number | null }>(),
      env.DB
        .prepare(
          `SELECT SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successful_builds,
                  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_builds,
                  SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS queued_builds
           FROM build_jobs`
        )
        .first<{ successful_builds: number | null; failed_builds: number | null; queued_builds: number | null }>(),
      env.DB
        .prepare(
          `SELECT COALESCE(SUM(total_points_earned), 0) AS points_issued,
                  COALESCE(SUM(total_credits_earned), 0) AS credits_issued
           FROM user_wallets`
        )
        .first<{ points_issued: number; credits_issued: number }>(),
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total_referrals,
                  SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) AS qualified_referrals
           FROM referrals`
        )
        .first<{ total_referrals: number; qualified_referrals: number | null }>(),
      env.DB
        .prepare('SELECT COUNT(*) AS membership_rewards, COALESCE(SUM(reward_points), 0) AS membership_points FROM telegram_membership_rewards')
        .first<{ membership_rewards: number; membership_points: number }>(),
      env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'build_server_health_json'`).first<{ value: string }>(),
      env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'maintenance_mode'`).first<{ value: string }>(),
    ]);

    let buildServerHealth: Record<string, unknown> = { status: 'unknown' };
    try {
      buildServerHealth = JSON.parse(serverHealthRow?.value ?? '{}');
    } catch {
      buildServerHealth = { status: 'unknown' };
    }

    return Response.json({
      totalUsers: userCounts?.total_users ?? 0,
      activeUsers: userCounts?.active_users ?? 0,
      totalZipUploads: uploadCounts?.total_uploads ?? 0,
      rejectedZipUploads: uploadCounts?.rejected_uploads ?? 0,
      successfulBuilds: buildCounts?.successful_builds ?? 0,
      failedBuilds: buildCounts?.failed_builds ?? 0,
      currentBuildQueue: buildCounts?.queued_builds ?? 0,
      pointsIssued: ledgerTotals?.points_issued ?? 0,
      freeApkCreditsIssued: ledgerTotals?.credits_issued ?? 0,
      totalReferrals: referralTotals?.total_referrals ?? 0,
      qualifiedReferrals: referralTotals?.qualified_referrals ?? 0,
      telegramMembershipRewards: joinEarnTotals?.membership_rewards ?? 0,
      telegramMembershipPoints: joinEarnTotals?.membership_points ?? 0,
      maintenanceMode: maintenanceRow?.value === 'true',
      buildServerHealth,
    });
  }

  // 4. Users list & profile
  if (path === '/api/admin/users' && method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim();
    const sql = q
      ? `SELECT u.*, w.points_balance, w.free_apk_credits
         FROM users u JOIN user_wallets w ON w.user_id = u.id
         WHERE CAST(u.telegram_user_id AS TEXT) LIKE ? OR LOWER(COALESCE(u.username, '')) LIKE ? OR LOWER(u.first_name) LIKE ?
         ORDER BY u.id DESC LIMIT 100`
      : `SELECT u.*, w.points_balance, w.free_apk_credits
         FROM users u JOIN user_wallets w ON w.user_id = u.id
         ORDER BY u.id DESC LIMIT 100`;

    const stmt = q
      ? env.DB.prepare(sql).bind(`%${q}%`, `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`)
      : env.DB.prepare(sql);
    const { results } = await stmt.all();
    return Response.json({ users: results });
  }

  const userBanMatch = path.match(/^\/api\/admin\/users\/(\d+)\/ban$/);
  if (userBanMatch && method === 'POST') {
    if (!admin.permissions.includes('users.ban') && admin.role !== 'super_admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const userId = Number(userBanMatch[1]);
    const body = (await request.json()) as { isBanned: boolean; reason: string };
    if (!body.reason?.trim()) return Response.json({ error: 'Reason is required' }, { status: 400 });

    const before = await env.DB.prepare('SELECT is_banned, ban_reason FROM users WHERE id = ?').bind(userId).first();
    await env.DB
      .prepare('UPDATE users SET is_banned = ?, ban_reason = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ?')
      .bind(body.isBanned ? 1 : 0, body.isBanned ? body.reason.trim() : null, userId)
      .run();

    await writeAuditLog(env.DB, {
      actorType: 'admin',
      actorId: String(admin.adminId),
      action: body.isBanned ? 'user_banned' : 'user_unbanned',
      targetType: 'user',
      targetId: String(userId),
      reason: body.reason.trim(),
      before,
      after: { is_banned: body.isBanned ? 1 : 0 },
      ipAddress: ip,
    });
    return Response.json({ ok: true });
  }

  const adjustPtsMatch = path.match(/^\/api\/admin\/users\/(\d+)\/adjust-points$/);
  if (adjustPtsMatch && method === 'POST') {
    if (!admin.permissions.includes('users.adjust_balance') && admin.role !== 'super_admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const userId = Number(adjustPtsMatch[1]);
    const body = (await request.json()) as { delta: number; reason: string };
    const delta = Math.trunc(Number(body.delta));
    if (!Number.isFinite(delta) || delta === 0 || !body.reason?.trim()) {
      return Response.json({ error: 'Non-zero integer delta and mandatory reason are required' }, { status: 400 });
    }

    const wallet = await env.DB.prepare('SELECT points_balance FROM user_wallets WHERE user_id = ?').bind(userId).first<{ points_balance: number }>();
    if (!wallet) return Response.json({ error: 'User wallet not found' }, { status: 404 });
    if (wallet.points_balance + delta < 0) {
      return Response.json({ error: 'Resulting balance cannot be negative' }, { status: 400 });
    }

    const idempotencyKey = `admin_pts:${admin.adminId}:${userId}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE user_wallets
           SET points_balance = points_balance + ?,
               total_points_earned = total_points_earned + CASE WHEN ? > 0 THEN ? ELSE 0 END,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE user_id = ? AND points_balance + ? >= 0`
        )
        .bind(delta, delta, delta, userId, delta),
      env.DB
        .prepare(
          `INSERT INTO point_transactions
           (user_id, tx_type, amount, balance_after, reference_type, reference_id, idempotency_key, description, created_by_admin_id)
           VALUES (?, 'admin_adjustment', ?, (SELECT points_balance FROM user_wallets WHERE user_id = ?), 'admin', ?, ?, ?, ?)`
        )
        .bind(userId, delta, userId, String(admin.adminId), idempotencyKey, body.reason.trim(), admin.adminId),
    ]);

    await writeAuditLog(env.DB, {
      actorType: 'admin',
      actorId: String(admin.adminId),
      action: 'admin_adjust_points',
      targetType: 'user',
      targetId: String(userId),
      reason: body.reason.trim(),
      before: { points_balance: wallet.points_balance },
      after: { delta, points_balance: wallet.points_balance + delta },
      ipAddress: ip,
    });

    return Response.json({ ok: true, newBalance: wallet.points_balance + delta });
  }

  const adjustCredMatch = path.match(/^\/api\/admin\/users\/(\d+)\/adjust-credits$/);
  if (adjustCredMatch && method === 'POST') {
    if (!admin.permissions.includes('users.adjust_balance') && admin.role !== 'super_admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const userId = Number(adjustCredMatch[1]);
    const body = (await request.json()) as { delta: number; reason: string };
    const delta = Math.trunc(Number(body.delta));
    if (!Number.isFinite(delta) || delta === 0 || !body.reason?.trim()) {
      return Response.json({ error: 'Non-zero integer delta and mandatory reason are required' }, { status: 400 });
    }

    const wallet = await env.DB.prepare('SELECT free_apk_credits FROM user_wallets WHERE user_id = ?').bind(userId).first<{ free_apk_credits: number }>();
    if (!wallet) return Response.json({ error: 'User wallet not found' }, { status: 404 });
    if (wallet.free_apk_credits + delta < 0) {
      return Response.json({ error: 'Resulting credits cannot be negative' }, { status: 400 });
    }

    const idempotencyKey = `admin_cred:${admin.adminId}:${userId}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE user_wallets
           SET free_apk_credits = free_apk_credits + ?,
               total_credits_earned = total_credits_earned + CASE WHEN ? > 0 THEN ? ELSE 0 END,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE user_id = ? AND free_apk_credits + ? >= 0`
        )
        .bind(delta, delta, delta, userId, delta),
      env.DB
        .prepare(
          `INSERT INTO free_apk_credits
           (user_id, delta, balance_after, source_type, reference_id, idempotency_key, note, created_by_admin_id)
           VALUES (?, ?, (SELECT free_apk_credits FROM user_wallets WHERE user_id = ?), 'admin_adjustment', ?, ?, ?, ?)`
        )
        .bind(userId, delta, userId, String(admin.adminId), idempotencyKey, body.reason.trim(), admin.adminId),
    ]);

    await writeAuditLog(env.DB, {
      actorType: 'admin',
      actorId: String(admin.adminId),
      action: 'admin_adjust_credits',
      targetType: 'user',
      targetId: String(userId),
      reason: body.reason.trim(),
      before: { free_apk_credits: wallet.free_apk_credits },
      after: { delta, free_apk_credits: wallet.free_apk_credits + delta },
      ipAddress: ip,
    });

    return Response.json({ ok: true, newCredits: wallet.free_apk_credits + delta });
  }

  // 5. Builds, Logs, Retry, Cancel
  if (path === '/api/admin/builds' && method === 'GET') {
    const statusFilter = url.searchParams.get('status');
    const sql = statusFilter
      ? `SELECT bj.*, p.app_name, p.package_name, u.telegram_user_id, u.username
         FROM build_jobs bj JOIN projects p ON p.id = bj.project_id JOIN users u ON u.id = bj.user_id
         WHERE bj.status = ? ORDER BY bj.id DESC LIMIT 100`
      : `SELECT bj.*, p.app_name, p.package_name, u.telegram_user_id, u.username
         FROM build_jobs bj JOIN projects p ON p.id = bj.project_id JOIN users u ON u.id = bj.user_id
         ORDER BY bj.id DESC LIMIT 100`;
    const { results } = statusFilter ? await env.DB.prepare(sql).bind(statusFilter).all() : await env.DB.prepare(sql).all();
    return Response.json({ builds: results });
  }

  const buildLogsMatch = path.match(/^\/api\/admin\/builds\/(\d+)\/logs$/);
  if (buildLogsMatch && method === 'GET') {
    const jobId = Number(buildLogsMatch[1]);
    const { results } = await env.DB.prepare('SELECT * FROM build_logs WHERE build_job_id = ? ORDER BY id ASC').bind(jobId).all();
    return Response.json({ logs: results });
  }

  const buildRetryMatch = path.match(/^\/api\/admin\/builds\/(\d+)\/retry$/);
  if (buildRetryMatch && method === 'POST') {
    const jobId = Number(buildRetryMatch[1]);
    const job = await env.DB.prepare('SELECT * FROM build_jobs WHERE id = ?').bind(jobId).first<Record<string, unknown>>();
    if (!job || job.status !== 'failed') {
      return Response.json({ error: 'Only failed jobs can be retried' }, { status: 400 });
    }
    await env.DB
      .prepare(
        `UPDATE build_jobs
         SET status = 'queued', stage = 'Re-queued by admin', progress_percent = 35, error_message = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .bind(jobId)
      .run();
    await appendBuildLog(env.DB, jobId, 'info', 'admin_retry', `Retried by admin #${admin.adminId}`);
    await writeAuditLog(env.DB, {
      actorType: 'admin',
      actorId: String(admin.adminId),
      action: 'build_retried',
      targetType: 'build_job',
      targetId: String(jobId),
      reason: 'Admin retried failed build job',
      ipAddress: ip,
    });
    const queueMsg: BuildQueueMessage = {
      buildJobId: jobId,
      jobCode: String(job.job_code),
      userId: Number(job.user_id),
      projectId: Number(job.project_id),
      uploadedFileId: Number(job.uploaded_file_id),
      enqueuedAt: new Date().toISOString(),
    };
    await enqueueOrDispatchBuild(env, queueMsg);
    return Response.json({ ok: true });
  }

  const buildCancelMatch = path.match(/^\/api\/admin\/builds\/(\d+)\/cancel$/);
  if (buildCancelMatch && method === 'POST') {
    const jobId = Number(buildCancelMatch[1]);
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim() || 'Cancelled by admin';
    const res = await env.DB
      .prepare(
        `UPDATE build_jobs
         SET status = 'cancelled', error_message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND status IN ('queued', 'processing')`
      )
      .bind(reason, jobId)
      .run();
    if ((res.meta.changes ?? 0) === 0) {
      return Response.json({ error: 'Job is not cancellable' }, { status: 400 });
    }
    const refunded = await refundBuildJobOnce(env.DB, jobId, reason);
    await appendBuildLog(env.DB, jobId, 'warn', 'cancelled', reason);
    await writeAuditLog(env.DB, {
      actorType: 'admin',
      actorId: String(admin.adminId),
      action: 'build_cancelled',
      targetType: 'build_job',
      targetId: String(jobId),
      reason,
      after: { refunded },
      ipAddress: ip,
    });
    return Response.json({ ok: true, refunded });
  }

  // 6. Unlimited Telegram Channels / Groups CRUD
  if (path === '/api/admin/channels' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM telegram_channels ORDER BY id DESC').all();
    return Response.json({ channels: results });
  }

  if (path === '/api/admin/channels' && method === 'POST') {
    const body = (await request.json()) as {
      name: string;
      username?: string;
      chatId: string;
      inviteUrl: string;
      rewardPoints?: number;
      isActive?: boolean;
    };
    if (!body.name?.trim() || !body.chatId?.trim() || !body.inviteUrl?.trim()) {
      return Response.json({ error: 'name, chatId, and inviteUrl are required' }, { status: 400 });
    }
    const rewardPoints = Math.max(1, Math.trunc(body.rewardPoints ?? 500));
    const res = await env.DB
      .prepare(
        `INSERT INTO telegram_channels (name, username, chat_id, invite_url, reward_points, is_active, created_by_admin_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        body.name.trim(),
        body.username?.trim() || null,
        body.chatId.trim(),
        body.inviteUrl.trim(),
        rewardPoints,
        body.isActive === false ? 0 : 1,
        admin.adminId
      )
      .run();

    await writeAuditLog(env.DB, {
      actorType: 'admin',
      actorId: String(admin.adminId),
      action: 'channel_created',
      targetType: 'telegram_channel',
      targetId: String(res.meta.last_row_id),
      reason: `Added Join & Earn channel ${body.name.trim()}`,
      after: body,
      ipAddress: ip,
    });
    return Response.json({ ok: true, id: res.meta.last_row_id });
  }

  const chanMatch = path.match(/^\/api\/admin\/channels\/(\d+)$/);
  if (chanMatch && method === 'PATCH') {
    const id = Number(chanMatch[1]);
    const body = (await request.json()) as Partial<{
      name: string;
      username: string;
      inviteUrl: string;
      rewardPoints: number;
      isActive: boolean;
    }>;
    await env.DB
      .prepare(
        `UPDATE telegram_channels
         SET name = COALESCE(?, name),
             username = COALESCE(?, username),
             invite_url = COALESCE(?, invite_url),
             reward_points = COALESCE(?, reward_points),
             is_active = COALESCE(?, is_active),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .bind(
        body.name ?? null,
        body.username ?? null,
        body.inviteUrl ?? null,
        body.rewardPoints ?? null,
        body.isActive === undefined ? null : body.isActive ? 1 : 0,
        id
      )
      .run();
    await writeAuditLog(env.DB, {
      actorType: 'admin',
      actorId: String(admin.adminId),
      action: 'channel_updated',
      targetType: 'telegram_channel',
      targetId: String(id),
      reason: 'Updated channel settings',
      after: body,
      ipAddress: ip,
    });
    return Response.json({ ok: true });
  }

  if (chanMatch && method === 'DELETE') {
    const id = Number(chanMatch[1]);
    await env.DB.prepare('DELETE FROM telegram_channels WHERE id = ?').bind(id).run();
    await writeAuditLog(env.DB, {
      actorType: 'admin',
      actorId: String(admin.adminId),
      action: 'channel_deleted',
      targetType: 'telegram_channel',
      targetId: String(id),
      reason: 'Deleted channel from Join & Earn',
      ipAddress: ip,
    });
    return Response.json({ ok: true });
  }

  // 7. Settings management
  if (path === '/api/admin/settings' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM app_settings ORDER BY key ASC').all();
    return Response.json({ settings: results });
  }

  if (path === '/api/admin/settings' && method === 'PUT') {
    if (admin.role !== 'super_admin') {
      return Response.json({ error: 'Only super_admin can modify global settings' }, { status: 403 });
    }
    const body = (await request.json()) as { updates: Record<string, string>; reason?: string };
    const updates = body.updates ?? {};
    const stmts: D1PreparedStatement[] = [];
    for (const [k, v] of Object.entries(updates)) {
      stmts.push(
        env.DB
          .prepare(
            `UPDATE app_settings SET value = ?, updated_by_admin_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ?`
          )
          .bind(String(v), admin.adminId, k)
      );
    }
    if (stmts.length > 0) await env.DB.batch(stmts);
    await writeAuditLog(env.DB, {
      actorType: 'admin',
      actorId: String(admin.adminId),
      action: 'settings_updated',
      targetType: 'app_settings',
      targetId: Object.keys(updates).join(','),
      reason: body.reason ?? 'Updated system configuration',
      after: updates,
      ipAddress: ip,
    });
    return Response.json({ ok: true });
  }

  // 8. Audit & Security Logs
  if (path === '/api/admin/audit-logs' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 150').all();
    return Response.json({ logs: results });
  }

  // 9. Admin Accounts Management
  if (path === '/api/admin/admins' && method === 'GET') {
    const { results } = await env.DB
      .prepare(
        `SELECT au.id, au.username, au.email, au.totp_enabled, au.is_active, au.last_login_at, au.created_at, ar.name AS role
         FROM admin_users au JOIN admin_roles ar ON ar.id = au.role_id ORDER BY au.id ASC`
      )
      .all();
    return Response.json({ admins: results });
  }

  if (path === '/api/admin/admins' && method === 'POST') {
    if (admin.role !== 'super_admin') {
      return Response.json({ error: 'Only super_admin can create admin accounts' }, { status: 403 });
    }
    const body = (await request.json()) as {
      username: string;
      password: string;
      roleId: number;
      email?: string;
      enableTotp?: boolean;
    };
    if (!body.username || !body.password || body.password.length < 10) {
      return Response.json({ error: 'Username and password (min 10 chars) required' }, { status: 400 });
    }
    const { hashHex, saltHex } = await hashPassword(body.password);
    const totpSecret = body.enableTotp ? generateBase32Secret() : null;
    await env.DB
      .prepare(
        `INSERT INTO admin_users (username, email, password_hash, password_salt, role_id, totp_secret_encrypted, totp_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(body.username.trim(), body.email ?? null, hashHex, saltHex, body.roleId || 2, totpSecret, totpSecret ? 1 : 0)
      .run();

    await writeAuditLog(env.DB, {
      actorType: 'admin',
      actorId: String(admin.adminId),
      action: 'admin_account_created',
      targetType: 'admin_user',
      targetId: body.username.trim(),
      reason: `Created admin role #${body.roleId}`,
      ipAddress: ip,
    });
    return Response.json({ ok: true, totpSecret: totpSecret ?? undefined });
  }

  // 10. Setup Telegram Webhook via Worker
  if (path === '/api/admin/telegram/setup-webhook' && method === 'POST') {
    if (admin.role !== 'super_admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const webhookUrl = `${env.WORKER_PUBLIC_URL.replace(/\/$/, '')}/telegram/webhook`;
    const tg = new TelegramApiClient(env.TELEGRAM_BOT_TOKEN);
    const ok = await tg.setWebhook(webhookUrl, env.TELEGRAM_WEBHOOK_SECRET);
    await writeAuditLog(env.DB, {
      actorType: 'admin',
      actorId: String(admin.adminId),
      action: 'telegram_webhook_configured',
      targetType: 'telegram_bot',
      targetId: webhookUrl,
      reason: 'Registered Telegram webhook',
      ipAddress: ip,
    });
    return Response.json({ ok, webhookUrl });
  }

  return Response.json({ error: 'Admin endpoint not found' }, { status: 404 });
}
