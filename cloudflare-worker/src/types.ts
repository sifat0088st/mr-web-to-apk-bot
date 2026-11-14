export type LanguageCode = 'bn' | 'en';

export type OrientationOption = 'portrait' | 'landscape' | 'auto';
export type AppThemeOption = 'light' | 'dark' | 'system';
export type ExternalLinksMode = 'in_app' | 'external_browser' | 'whitelist';
export type BuildStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'expired';

export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  BUILD_QUEUE?: Queue<BuildQueueMessage>;
  RATE_LIMITER: DurableObjectNamespace;

  APP_ENV: string;
  BOT_USERNAME: string;
  WORKER_PUBLIC_URL: string;
  GITHUB_REPO?: string;

  // Secrets configured via `wrangler secret put` or Cloudflare Dashboard
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  BUILD_SERVER_URL?: string;
  BUILD_SERVER_SECRET: string;
  GITHUB_BUILD_TOKEN?: string;
  ADMIN_BOOTSTRAP_SECRET: string;
  ADMIN_JWT_SECRET?: string;
  DOWNLOAD_SIGNING_SECRET?: string;
  TOTP_ENCRYPTION_KEY?: string;
}

export interface BuildQueueMessage {
  buildJobId: number;
  jobCode: string;
  userId: number;
  projectId: number;
  uploadedFileId: number;
  enqueuedAt: string;
}

export interface AppFormDraft {
  step:
    | 'app_name'
    | 'package_name'
    | 'version_name'
    | 'version_code'
    | 'app_description'
    | 'app_logo'
    | 'splash_screen'
    | 'orientation'
    | 'status_bar_color'
    | 'nav_bar_color'
    | 'app_theme'
    | 'permissions'
    | 'start_page'
    | 'external_links'
    | 'review'
    | 'awaiting_zip';
  editingSingleField?: string;
  projectId?: number;
  appName?: string;
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  appDescription?: string;
  logoR2Key?: string | null;
  splashR2Key?: string | null;
  orientation?: OrientationOption;
  statusBarColor?: string;
  navBarColor?: string;
  appTheme?: AppThemeOption;
  permissions?: string[];
  startPage?: string;
  externalLinksMode?: ExternalLinksMode;
  externalLinksDomains?: string[];
}

export interface ZipValidationLimits {
  maxZipBytes: number;
  maxExtractedBytes: number;
  maxFileCount: number;
  maxDirectoryDepth: number;
}

export interface ZipEntrySummary {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  extension: string;
}

export interface ZipValidationResult {
  valid: boolean;
  sha256: string;
  fileCount: number;
  extractedSizeBytes: number;
  maxDepth: number;
  rejectionReason?: string;
  rejectionCode?: string;
  files: ZipEntrySummary[];
}

export interface UserRow {
  id: number;
  telegram_user_id: number;
  username: string | null;
  first_name: string;
  last_name: string;
  language_code: LanguageCode;
  is_banned: number;
  ban_reason: string | null;
  referred_by_user_id: number | null;
  referral_qualified: number;
  welcome_bonus_claimed: number;
  created_at: string;
  updated_at: string;
  last_active_at: string;
}

export interface WalletRow {
  user_id: number;
  points_balance: number;
  free_apk_credits: number;
  total_points_earned: number;
  total_points_spent: number;
  total_credits_earned: number;
  total_credits_used: number;
  updated_at: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: {
    id: number;
    type: string;
  };
  date: number;
  text?: string;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface AdminSessionClaims {
  adminId: number;
  username: string;
  role: string;
  permissions: string[];
  exp: number;
  iat: number;
}
