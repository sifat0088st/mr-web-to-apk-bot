-- MR WEB TO APK BOT - Cloudflare D1 Initial Schema Migration
-- Includes all 21 core tables + persistent form state table with strict constraints and indexes.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id INTEGER NOT NULL UNIQUE,
    username TEXT,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    language_code TEXT NOT NULL DEFAULT 'bn' CHECK (language_code IN ('bn', 'en')),
    is_banned INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1)),
    ban_reason TEXT,
    referred_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    referral_qualified INTEGER NOT NULL DEFAULT 0 CHECK (referral_qualified IN (0, 1)),
    welcome_bonus_claimed INTEGER NOT NULL DEFAULT 0 CHECK (welcome_bonus_claimed IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_active_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by_user_id);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at);

CREATE TABLE IF NOT EXISTS user_wallets (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
    free_apk_credits INTEGER NOT NULL DEFAULT 0 CHECK (free_apk_credits >= 0),
    total_points_earned INTEGER NOT NULL DEFAULT 0 CHECK (total_points_earned >= 0),
    total_points_spent INTEGER NOT NULL DEFAULT 0 CHECK (total_points_spent >= 0),
    total_credits_earned INTEGER NOT NULL DEFAULT 0 CHECK (total_credits_earned >= 0),
    total_credits_used INTEGER NOT NULL DEFAULT 0 CHECK (total_credits_used >= 0),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS admin_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS admin_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id INTEGER NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    UNIQUE(role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES admin_roles(id),
    totp_secret_encrypted TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS point_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tx_type TEXT NOT NULL CHECK (tx_type IN (
        'welcome_bonus',
        'build_charge',
        'build_refund',
        'referral_reward',
        'referral_milestone',
        'join_earn',
        'admin_adjustment'
    )),
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
    reference_type TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_by_admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_point_tx_user_created ON point_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_tx_type ON point_transactions(tx_type);

CREATE TABLE IF NOT EXISTS free_apk_credits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
    source_type TEXT NOT NULL CHECK (source_type IN (
        'welcome_bonus',
        'build_charge',
        'build_refund',
        'referral_milestone',
        'admin_adjustment'
    )),
    reference_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    note TEXT NOT NULL DEFAULT '',
    created_by_admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_credits_user_created ON free_apk_credits(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'qualified', 'rejected')),
    qualification_event TEXT NOT NULL DEFAULT 'first_zip_validated',
    qualified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (referrer_user_id != referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_status ON referrals(referrer_user_id, status);

CREATE TABLE IF NOT EXISTS referral_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referral_id INTEGER NOT NULL UNIQUE REFERENCES referrals(id) ON DELETE CASCADE,
    referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    points_awarded INTEGER NOT NULL CHECK (points_awarded > 0),
    transaction_id INTEGER NOT NULL REFERENCES point_transactions(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS referral_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    milestone_count INTEGER NOT NULL CHECK (milestone_count >= 10 AND milestone_count % 10 = 0),
    points_awarded INTEGER NOT NULL CHECK (points_awarded >= 0),
    credits_awarded INTEGER NOT NULL CHECK (credits_awarded >= 0),
    transaction_id INTEGER REFERENCES point_transactions(id),
    credit_ledger_id INTEGER REFERENCES free_apk_credits(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, milestone_count)
);

CREATE TABLE IF NOT EXISTS telegram_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT,
    chat_id TEXT NOT NULL UNIQUE,
    invite_url TEXT NOT NULL,
    reward_points INTEGER NOT NULL DEFAULT 500 CHECK (reward_points > 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_by_admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_channels_active ON telegram_channels(is_active);

CREATE TABLE IF NOT EXISTS telegram_membership_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL,
    reward_points INTEGER NOT NULL CHECK (reward_points > 0),
    transaction_id INTEGER NOT NULL REFERENCES point_transactions(id),
    verified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, chat_id)
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL,
    package_name TEXT NOT NULL,
    version_name TEXT NOT NULL DEFAULT '1.0.0',
    version_code INTEGER NOT NULL DEFAULT 1 CHECK (version_code >= 1),
    app_description TEXT NOT NULL DEFAULT '',
    logo_r2_key TEXT,
    splash_r2_key TEXT,
    orientation TEXT NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait', 'landscape', 'auto')),
    status_bar_color TEXT NOT NULL DEFAULT '#10B981',
    nav_bar_color TEXT NOT NULL DEFAULT '#111827',
    app_theme TEXT NOT NULL DEFAULT 'system' CHECK (app_theme IN ('light', 'dark', 'system')),
    permissions_json TEXT NOT NULL DEFAULT '["INTERNET","ACCESS_NETWORK_STATE"]',
    start_page TEXT NOT NULL DEFAULT 'index.html',
    external_links_mode TEXT NOT NULL DEFAULT 'in_app' CHECK (external_links_mode IN ('in_app', 'external_browser', 'whitelist')),
    external_links_domains_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'building', 'completed', 'failed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_package ON projects(package_name);

CREATE TABLE IF NOT EXISTS uploaded_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    file_type TEXT NOT NULL CHECK (file_type IN ('website_zip', 'logo', 'splash')),
    r2_key TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL,
    validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'passed', 'rejected')),
    rejection_reason TEXT,
    file_count INTEGER NOT NULL DEFAULT 0,
    extracted_size_bytes INTEGER NOT NULL DEFAULT 0,
    max_depth INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_user ON uploaded_files(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_status ON uploaded_files(validation_status);

CREATE TABLE IF NOT EXISTS build_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_code TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    uploaded_file_id INTEGER NOT NULL REFERENCES uploaded_files(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled', 'expired')),
    stage TEXT NOT NULL DEFAULT 'ZIP received',
    progress_percent INTEGER NOT NULL DEFAULT 5 CHECK (progress_percent >= 0 AND progress_percent <= 100),
    payment_type TEXT NOT NULL CHECK (payment_type IN ('free_credit', 'points')),
    points_charged INTEGER NOT NULL DEFAULT 0 CHECK (points_charged >= 0),
    credits_charged INTEGER NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
    charge_idempotency_key TEXT NOT NULL UNIQUE,
    refunded INTEGER NOT NULL DEFAULT 0 CHECK (refunded IN (0, 1)),
    refund_idempotency_key TEXT UNIQUE,
    telegram_chat_id INTEGER NOT NULL,
    telegram_progress_message_id INTEGER,
    build_server_id TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_build_jobs_user ON build_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_build_jobs_status ON build_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_build_jobs_code ON build_jobs(job_code);

CREATE TABLE IF NOT EXISTS build_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    build_job_id INTEGER NOT NULL REFERENCES build_jobs(id) ON DELETE CASCADE,
    level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
    stage TEXT NOT NULL DEFAULT 'system',
    message TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_build_logs_job ON build_logs(build_job_id, id ASC);

CREATE TABLE IF NOT EXISTS generated_apks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    build_job_id INTEGER NOT NULL UNIQUE REFERENCES build_jobs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL UNIQUE,
    file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
    sha256 TEXT NOT NULL,
    package_name TEXT NOT NULL,
    version_name TEXT NOT NULL,
    version_code INTEGER NOT NULL,
    signing_cert_sha256 TEXT NOT NULL,
    signing_mode TEXT NOT NULL DEFAULT 'platform_managed',
    signature_verified INTEGER NOT NULL DEFAULT 0 CHECK (signature_verified IN (0, 1)),
    telegram_file_id TEXT,
    download_token_hash TEXT UNIQUE,
    download_expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_generated_apks_user ON generated_apks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_limits (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    max_zip_bytes INTEGER NOT NULL DEFAULT 26214400,
    max_extracted_bytes INTEGER NOT NULL DEFAULT 62914560,
    max_file_count INTEGER NOT NULL DEFAULT 500,
    max_depth INTEGER NOT NULL DEFAULT 10,
    max_build_duration_sec INTEGER NOT NULL DEFAULT 300,
    daily_builds_limit INTEGER NOT NULL DEFAULT 15,
    rate_limit_per_min INTEGER NOT NULL DEFAULT 30,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
    description TEXT NOT NULL DEFAULT '',
    updated_by_admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'system', 'user', 'build_server')),
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    before_json TEXT,
    after_json TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_type, actor_id);

CREATE TABLE IF NOT EXISTS webhook_updates (
    update_id INTEGER PRIMARY KEY,
    telegram_user_id INTEGER,
    update_type TEXT NOT NULL,
    processed_status TEXT NOT NULL DEFAULT 'processed',
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_updates_received ON webhook_updates(received_at);

CREATE TABLE IF NOT EXISTS telegram_form_states (
    telegram_user_id INTEGER PRIMARY KEY,
    state_key TEXT NOT NULL DEFAULT 'idle',
    draft_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
