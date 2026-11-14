import type { AppFormDraft, LanguageCode, UserRow, WalletRow } from './types.ts';

export interface DbSettingsMap {
  maintenanceMode: boolean;
  welcomePoints: number;
  welcomeCredits: number;
  buildCostPoints: number;
  referralRewardPoints: number;
  referralMilestoneInterval: number;
  referralMilestonePoints: number;
  referralMilestoneCredits: number;
  referralQualificationEvent: 'first_zip_validated' | 'first_build_completed' | 'account_created';
  maxZipBytes: number;
  maxExtractedBytes: number;
  maxFileCount: number;
  maxDirectoryDepth: number;
  maxBuildDurationSec: number;
  signingMode: 'platform_managed' | 'user_provided';
  botUsername: string;
  supportContact: string;
}

export async function getAppSettings(db: D1Database): Promise<DbSettingsMap> {
  const { results } = await db.prepare('SELECT key, value FROM app_settings').all<{ key: string; value: string }>();
  const map = new Map<string, string>();
  for (const row of results) {
    map.set(row.key, row.value);
  }
  const num = (k: string, fallback: number) => {
    const v = Number(map.get(k));
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    maintenanceMode: map.get('maintenance_mode') === 'true',
    welcomePoints: num('welcome_points', 1000),
    welcomeCredits: num('welcome_credits', 1),
    buildCostPoints: num('build_cost_points', 1000),
    referralRewardPoints: num('referral_reward_points', 250),
    referralMilestoneInterval: num('referral_milestone_interval', 10),
    referralMilestonePoints: num('referral_milestone_points', 2000),
    referralMilestoneCredits: num('referral_milestone_credits', 1),
    referralQualificationEvent: (map.get('referral_qualification_event') as DbSettingsMap['referralQualificationEvent']) || 'first_zip_validated',
    maxZipBytes: num('max_zip_bytes', 26214400),
    maxExtractedBytes: num('max_extracted_bytes', 62914560),
    maxFileCount: num('max_file_count', 500),
    maxDirectoryDepth: num('max_directory_depth', 10),
    maxBuildDurationSec: num('max_build_duration_sec', 300),
    signingMode: (map.get('signing_mode') as 'platform_managed' | 'user_provided') || 'platform_managed',
    botUsername: map.get('bot_username') || 'MRWebToApkBot',
    supportContact: map.get('support_contact') || '@MRWebToApkSupport',
  };
}

export async function recordWebhookUpdateIdempotent(
  db: D1Database,
  updateId: number,
  telegramUserId: number | null,
  updateType: string
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO webhook_updates (update_id, telegram_user_id, update_type, processed_status)
       VALUES (?, ?, ?, 'processed')`
    )
    .bind(updateId, telegramUserId, updateType)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function upsertUserAndGrantWelcomeOnce(
  db: D1Database,
  params: {
    telegramUserId: number;
    username?: string;
    firstName: string;
    lastName?: string;
    referredByTelegramId?: number | null;
  },
  settings: DbSettingsMap
): Promise<{ user: UserRow; wallet: WalletRow; isNewWelcomeGranted: boolean }> {
  const defaultLang: LanguageCode = 'bn';

  await db
    .prepare(
      `INSERT OR IGNORE INTO users (telegram_user_id, username, first_name, last_name, language_code)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(params.telegramUserId, params.username ?? null, params.firstName, params.lastName ?? '', defaultLang)
    .run();

  await db
    .prepare(
      `UPDATE users
       SET username = COALESCE(?, username),
           first_name = ?,
           last_name = ?,
           last_active_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE telegram_user_id = ?`
    )
    .bind(params.username ?? null, params.firstName, params.lastName ?? '', params.telegramUserId)
    .run();

  const user = await db
    .prepare('SELECT * FROM users WHERE telegram_user_id = ?')
    .bind(params.telegramUserId)
    .first<UserRow>();

  if (!user) {
    throw new Error('Failed to load user after upsert');
  }

  await db
    .prepare('INSERT OR IGNORE INTO user_wallets (user_id, points_balance, free_apk_credits) VALUES (?, 0, 0)')
    .bind(user.id)
    .run();

  await db
    .prepare(
      `INSERT OR IGNORE INTO user_limits (user_id, max_zip_bytes, max_extracted_bytes, max_file_count, max_depth, max_build_duration_sec)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      user.id,
      settings.maxZipBytes,
      settings.maxExtractedBytes,
      settings.maxFileCount,
      settings.maxDirectoryDepth,
      settings.maxBuildDurationSec
    )
    .run();

  // Attach referral only if user has no referrer yet, is not self-referring, and welcome was not previously claimed
  if (
    params.referredByTelegramId &&
    params.referredByTelegramId !== params.telegramUserId &&
    user.referred_by_user_id === null &&
    user.welcome_bonus_claimed === 0
  ) {
    const referrer = await db
      .prepare('SELECT id FROM users WHERE telegram_user_id = ? AND is_banned = 0')
      .bind(params.referredByTelegramId)
      .first<{ id: number }>();

    if (referrer && referrer.id !== user.id) {
      await db
        .prepare('UPDATE users SET referred_by_user_id = ? WHERE id = ? AND referred_by_user_id IS NULL')
        .bind(referrer.id, user.id)
        .run();

      await db
        .prepare(
          `INSERT OR IGNORE INTO referrals (referrer_user_id, referred_user_id, status, qualification_event)
           VALUES (?, ?, 'pending', ?)`
        )
        .bind(referrer.id, user.id, settings.referralQualificationEvent)
        .run();
    }
  }

  // Atomic one-time welcome bonus claim guarded by welcome_bonus_claimed = 0 AND unique idempotency keys
  const claimRes = await db
    .prepare(
      `UPDATE users
       SET welcome_bonus_claimed = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND welcome_bonus_claimed = 0`
    )
    .bind(user.id)
    .run();

  const isNewWelcomeGranted = (claimRes.meta.changes ?? 0) > 0;

  if (isNewWelcomeGranted) {
    const welcomePtsKey = `welcome_points:${user.id}`;
    const welcomeCredKey = `welcome_credit:${user.id}`;

    await db.batch([
      db
        .prepare(
          `UPDATE user_wallets
           SET points_balance = points_balance + ?,
               free_apk_credits = free_apk_credits + ?,
               total_points_earned = total_points_earned + ?,
               total_credits_earned = total_credits_earned + ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE user_id = ?`
        )
        .bind(
          settings.welcomePoints,
          settings.welcomeCredits,
          settings.welcomePoints,
          settings.welcomeCredits,
          user.id
        ),
      db
        .prepare(
          `INSERT OR IGNORE INTO point_transactions
           (user_id, tx_type, amount, balance_after, reference_type, reference_id, idempotency_key, description)
           VALUES (?, 'welcome_bonus', ?, (SELECT points_balance FROM user_wallets WHERE user_id = ?), 'user', ?, ?, 'One-time welcome points gift')`
        )
        .bind(user.id, settings.welcomePoints, user.id, String(user.id), welcomePtsKey),
      db
        .prepare(
          `INSERT OR IGNORE INTO free_apk_credits
           (user_id, delta, balance_after, source_type, reference_id, idempotency_key, note)
           VALUES (?, ?, (SELECT free_apk_credits FROM user_wallets WHERE user_id = ?), 'welcome_bonus', ?, ?, 'One-time welcome free APK credit')`
        )
        .bind(user.id, settings.welcomeCredits, user.id, String(user.id), welcomeCredKey),
    ]);

    if (settings.referralQualificationEvent === 'account_created') {
      await qualifyReferralIfEligible(db, user.id, 'account_created', settings);
    }
  }

  const freshUser = (await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<UserRow>())!;
  const wallet = (await db.prepare('SELECT * FROM user_wallets WHERE user_id = ?').bind(user.id).first<WalletRow>())!;

  return { user: freshUser, wallet, isNewWelcomeGranted };
}

export async function deductBuildCreditAtomically(
  db: D1Database,
  params: {
    userId: number;
    jobCode: string;
    buildCostPoints: number;
  }
): Promise<{ ok: true; paymentType: 'free_credit' | 'points'; pointsCharged: number; creditsCharged: number } | { ok: false; reason: string }> {
  const chargeKey = `build_charge:${params.jobCode}`;

  // 1. Try Free APK Credit first (atomic guard: free_apk_credits >= 1)
  const creditTry = await db
    .prepare(
      `UPDATE user_wallets
       SET free_apk_credits = free_apk_credits - 1,
           total_credits_used = total_credits_used + 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE user_id = ? AND free_apk_credits >= 1`
    )
    .bind(params.userId)
    .run();

  if ((creditTry.meta.changes ?? 0) > 0) {
    await db
      .prepare(
        `INSERT INTO free_apk_credits
         (user_id, delta, balance_after, source_type, reference_id, idempotency_key, note)
         VALUES (?, -1, (SELECT free_apk_credits FROM user_wallets WHERE user_id = ?), 'build_charge', ?, ?, 'Deducted 1 free APK credit for build')`
      )
      .bind(params.userId, params.userId, params.jobCode, chargeKey)
      .run();
    return { ok: true, paymentType: 'free_credit', pointsCharged: 0, creditsCharged: 1 };
  }

  // 2. Fall back to Points (atomic guard: points_balance >= buildCostPoints)
  const pointsTry = await db
    .prepare(
      `UPDATE user_wallets
       SET points_balance = points_balance - ?,
           total_points_spent = total_points_spent + ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE user_id = ? AND points_balance >= ?`
    )
    .bind(params.buildCostPoints, params.buildCostPoints, params.userId, params.buildCostPoints)
    .run();

  if ((pointsTry.meta.changes ?? 0) > 0) {
    await db
      .prepare(
        `INSERT INTO point_transactions
         (user_id, tx_type, amount, balance_after, reference_type, reference_id, idempotency_key, description)
         VALUES (?, 'build_charge', ?, (SELECT points_balance FROM user_wallets WHERE user_id = ?), 'build_job', ?, ?, 'Deducted points for APK build')`
      )
      .bind(params.userId, -params.buildCostPoints, params.userId, params.jobCode, chargeKey)
      .run();
    return { ok: true, paymentType: 'points', pointsCharged: params.buildCostPoints, creditsCharged: 0 };
  }

  return { ok: false, reason: 'INSUFFICIENT_BALANCE' };
}

export async function refundBuildJobOnce(
  db: D1Database,
  buildJobId: number,
  reason: string
): Promise<boolean> {
  const job = await db
    .prepare(
      'SELECT id, job_code, user_id, payment_type, points_charged, credits_charged, refunded FROM build_jobs WHERE id = ?'
    )
    .bind(buildJobId)
    .first<{
      id: number;
      job_code: string;
      user_id: number;
      payment_type: 'free_credit' | 'points';
      points_charged: number;
      credits_charged: number;
      refunded: number;
    }>();

  if (!job || job.refunded === 1) {
    return false;
  }

  const refundKey = `build_refund:${job.job_code}`;

  // Atomic compare-and-set on refunded = 0 guarantees a build job can never be refunded twice
  const markRes = await db
    .prepare(
      `UPDATE build_jobs
       SET refunded = 1,
           refund_idempotency_key = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND refunded = 0`
    )
    .bind(refundKey, job.id)
    .run();

  if ((markRes.meta.changes ?? 0) === 0) {
    return false;
  }

  if (job.payment_type === 'free_credit' && job.credits_charged > 0) {
    await db.batch([
      db
        .prepare(
          `UPDATE user_wallets
           SET free_apk_credits = free_apk_credits + ?,
               total_credits_used = MAX(0, total_credits_used - ?),
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE user_id = ?`
        )
        .bind(job.credits_charged, job.credits_charged, job.user_id),
      db
        .prepare(
          `INSERT OR IGNORE INTO free_apk_credits
           (user_id, delta, balance_after, source_type, reference_id, idempotency_key, note)
           VALUES (?, ?, (SELECT free_apk_credits FROM user_wallets WHERE user_id = ?), 'build_refund', ?, ?, ?)`
        )
        .bind(job.user_id, job.credits_charged, job.user_id, job.job_code, refundKey, `Refund: ${reason}`),
    ]);
    return true;
  }

  if (job.payment_type === 'points' && job.points_charged > 0) {
    await db.batch([
      db
        .prepare(
          `UPDATE user_wallets
           SET points_balance = points_balance + ?,
               total_points_spent = MAX(0, total_points_spent - ?),
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE user_id = ?`
        )
        .bind(job.points_charged, job.points_charged, job.user_id),
      db
        .prepare(
          `INSERT OR IGNORE INTO point_transactions
           (user_id, tx_type, amount, balance_after, reference_type, reference_id, idempotency_key, description)
           VALUES (?, 'build_refund', ?, (SELECT points_balance FROM user_wallets WHERE user_id = ?), 'build_job', ?, ?, ?)`
        )
        .bind(job.user_id, job.points_charged, job.user_id, job.job_code, refundKey, `Refund: ${reason}`),
    ]);
    return true;
  }

  return false;
}

export async function qualifyReferralIfEligible(
  db: D1Database,
  referredUserId: number,
  event: 'first_zip_validated' | 'first_build_completed' | 'account_created',
  settings: DbSettingsMap
): Promise<{ rewarded: boolean; referrerUserId?: number; milestoneAwarded?: number }> {
  if (settings.referralQualificationEvent !== event) {
    return { rewarded: false };
  }

  const ref = await db
    .prepare(
      `SELECT id, referrer_user_id, referred_user_id, status
       FROM referrals
       WHERE referred_user_id = ? AND status = 'pending'`
    )
    .bind(referredUserId)
    .first<{ id: number; referrer_user_id: number; referred_user_id: number; status: string }>();

  if (!ref || ref.referrer_user_id === ref.referred_user_id) {
    return { rewarded: false };
  }

  const qualifyUpdate = await db
    .prepare(
      `UPDATE referrals
       SET status = 'qualified', qualified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND status = 'pending'`
    )
    .bind(ref.id)
    .run();

  if ((qualifyUpdate.meta.changes ?? 0) === 0) {
    return { rewarded: false };
  }

  const refTxKey = `referral_reward:${ref.id}`;
  await db.batch([
    db.prepare('UPDATE users SET referral_qualified = 1 WHERE id = ?').bind(referredUserId),
    db
      .prepare(
        `UPDATE user_wallets
         SET points_balance = points_balance + ?,
             total_points_earned = total_points_earned + ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE user_id = ?`
      )
      .bind(settings.referralRewardPoints, settings.referralRewardPoints, ref.referrer_user_id),
    db
      .prepare(
        `INSERT OR IGNORE INTO point_transactions
         (user_id, tx_type, amount, balance_after, reference_type, reference_id, idempotency_key, description)
         VALUES (?, 'referral_reward', ?, (SELECT points_balance FROM user_wallets WHERE user_id = ?), 'referral', ?, ?, ?)`
      )
      .bind(
        ref.referrer_user_id,
        settings.referralRewardPoints,
        ref.referrer_user_id,
        String(ref.id),
        refTxKey,
        `Referral reward for user #${referredUserId}`
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO referral_rewards
         (referral_id, referrer_user_id, referred_user_id, points_awarded, transaction_id)
         VALUES (?, ?, ?, ?, (SELECT id FROM point_transactions WHERE idempotency_key = ?))`
      )
      .bind(ref.id, ref.referrer_user_id, referredUserId, settings.referralRewardPoints, refTxKey),
  ]);

  // Check referral milestones: 10, 20, 30, 40, ... unlimited future milestones
  const countRow = await db
    .prepare(`SELECT COUNT(*) as total FROM referrals WHERE referrer_user_id = ? AND status = 'qualified'`)
    .bind(ref.referrer_user_id)
    .first<{ total: number }>();

  const qualifiedTotal = countRow?.total ?? 0;
  const interval = Math.max(10, settings.referralMilestoneInterval);
  let milestoneAwarded: number | undefined;

  for (let m = interval; m <= qualifiedTotal; m += interval) {
    const existing = await db
      .prepare('SELECT id FROM referral_milestones WHERE user_id = ? AND milestone_count = ?')
      .bind(ref.referrer_user_id, m)
      .first<{ id: number }>();

    if (!existing) {
      const mPtsKey = `referral_milestone_pts:${ref.referrer_user_id}:${m}`;
      const mCredKey = `referral_milestone_cred:${ref.referrer_user_id}:${m}`;

      const insertM = await db
        .prepare(
          `INSERT OR IGNORE INTO referral_milestones (user_id, milestone_count, points_awarded, credits_awarded)
           VALUES (?, ?, ?, ?)`
        )
        .bind(ref.referrer_user_id, m, settings.referralMilestonePoints, settings.referralMilestoneCredits)
        .run();

      if ((insertM.meta.changes ?? 0) > 0) {
        await db.batch([
          db
            .prepare(
              `UPDATE user_wallets
               SET points_balance = points_balance + ?,
                   free_apk_credits = free_apk_credits + ?,
                   total_points_earned = total_points_earned + ?,
                   total_credits_earned = total_credits_earned + ?,
                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE user_id = ?`
            )
            .bind(
              settings.referralMilestonePoints,
              settings.referralMilestoneCredits,
              settings.referralMilestonePoints,
              settings.referralMilestoneCredits,
              ref.referrer_user_id
            ),
          db
            .prepare(
              `INSERT OR IGNORE INTO point_transactions
               (user_id, tx_type, amount, balance_after, reference_type, reference_id, idempotency_key, description)
               VALUES (?, 'referral_milestone', ?, (SELECT points_balance FROM user_wallets WHERE user_id = ?), 'milestone', ?, ?, ?)`
            )
            .bind(
              ref.referrer_user_id,
              settings.referralMilestonePoints,
              ref.referrer_user_id,
              String(m),
              mPtsKey,
              `Referral milestone bonus (${m} referrals)`
            ),
          db
            .prepare(
              `INSERT OR IGNORE INTO free_apk_credits
               (user_id, delta, balance_after, source_type, reference_id, idempotency_key, note)
               VALUES (?, ?, (SELECT free_apk_credits FROM user_wallets WHERE user_id = ?), 'referral_milestone', ?, ?, ?)`
            )
            .bind(
              ref.referrer_user_id,
              settings.referralMilestoneCredits,
              ref.referrer_user_id,
              String(m),
              mCredKey,
              `Referral milestone bonus (${m} referrals)`
            ),
          db
            .prepare(
              `UPDATE referral_milestones
               SET transaction_id = (SELECT id FROM point_transactions WHERE idempotency_key = ?),
                   credit_ledger_id = (SELECT id FROM free_apk_credits WHERE idempotency_key = ?)
               WHERE user_id = ? AND milestone_count = ?`
            )
            .bind(mPtsKey, mCredKey, ref.referrer_user_id, m),
        ]);
        milestoneAwarded = m;
      }
    }
  }

  return { rewarded: true, referrerUserId: ref.referrer_user_id, milestoneAwarded };
}

export async function claimJoinEarnRewardOnce(
  db: D1Database,
  params: { userId: number; channelId: number; chatId: string; rewardPoints: number; channelName: string }
): Promise<{ claimed: boolean; newBalance?: number }> {
  const txKey = `join_earn:${params.userId}:${params.chatId}`;

  // First check unique constraint / existing claim
  const already = await db
    .prepare('SELECT id FROM telegram_membership_rewards WHERE user_id = ? AND chat_id = ?')
    .bind(params.userId, params.chatId)
    .first<{ id: number }>();

  if (already) {
    return { claimed: false };
  }

  // Insert point transaction first with unique idempotency key
  const txInsert = await db
    .prepare(
      `INSERT OR IGNORE INTO point_transactions
       (user_id, tx_type, amount, balance_after, reference_type, reference_id, idempotency_key, description)
       VALUES (?, 'join_earn', ?, (SELECT points_balance + ? FROM user_wallets WHERE user_id = ?), 'telegram_channel', ?, ?, ?)`
    )
    .bind(
      params.userId,
      params.rewardPoints,
      params.rewardPoints,
      params.userId,
      params.chatId,
      txKey,
      `Join & Earn verified: ${params.channelName}`
    )
    .run();

  if ((txInsert.meta.changes ?? 0) === 0) {
    return { claimed: false };
  }

  const membershipInsert = await db
    .prepare(
      `INSERT OR IGNORE INTO telegram_membership_rewards
       (user_id, channel_id, chat_id, reward_points, transaction_id)
       VALUES (?, ?, ?, ?, (SELECT id FROM point_transactions WHERE idempotency_key = ?))`
    )
    .bind(params.userId, params.channelId, params.chatId, params.rewardPoints, txKey)
    .run();

  if ((membershipInsert.meta.changes ?? 0) === 0) {
    return { claimed: false };
  }

  await db
    .prepare(
      `UPDATE user_wallets
       SET points_balance = points_balance + ?,
           total_points_earned = total_points_earned + ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE user_id = ?`
    )
    .bind(params.rewardPoints, params.rewardPoints, params.userId)
    .run();

  const wallet = await db
    .prepare('SELECT points_balance FROM user_wallets WHERE user_id = ?')
    .bind(params.userId)
    .first<{ points_balance: number }>();

  return { claimed: true, newBalance: wallet?.points_balance ?? 0 };
}

export async function getFormDraft(db: D1Database, telegramUserId: number): Promise<AppFormDraft | null> {
  const row = await db
    .prepare('SELECT state_key, draft_json FROM telegram_form_states WHERE telegram_user_id = ?')
    .bind(telegramUserId)
    .first<{ state_key: string; draft_json: string }>();

  if (!row || row.state_key === 'idle') return null;
  try {
    return JSON.parse(row.draft_json) as AppFormDraft;
  } catch {
    return null;
  }
}

export async function saveFormDraft(db: D1Database, telegramUserId: number, draft: AppFormDraft): Promise<void> {
  await db
    .prepare(
      `INSERT INTO telegram_form_states (telegram_user_id, state_key, draft_json, updated_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         state_key = excluded.state_key,
         draft_json = excluded.draft_json,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    )
    .bind(telegramUserId, draft.step, JSON.stringify(draft))
    .run();
}

export async function clearFormDraft(db: D1Database, telegramUserId: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO telegram_form_states (telegram_user_id, state_key, draft_json, updated_at)
       VALUES (?, 'idle', '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         state_key = 'idle',
         draft_json = '{}',
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    )
    .bind(telegramUserId)
    .run();
}

export async function appendBuildLog(
  db: D1Database,
  buildJobId: number,
  level: 'info' | 'warn' | 'error',
  stage: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO build_logs (build_job_id, level, stage, message, metadata_json)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(buildJobId, level, stage, message, metadata ? JSON.stringify(metadata) : null)
    .run();
}

export async function writeAuditLog(
  db: D1Database,
  entry: {
    actorType: 'admin' | 'system' | 'user' | 'build_server';
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    before?: unknown;
    after?: unknown;
    ipAddress?: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs
       (actor_type, actor_id, action, target_type, target_id, reason, before_json, after_json, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      entry.actorType,
      entry.actorId,
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.reason,
      entry.before !== undefined ? JSON.stringify(entry.before) : null,
      entry.after !== undefined ? JSON.stringify(entry.after) : null,
      entry.ipAddress ?? null
    )
    .run();
}
