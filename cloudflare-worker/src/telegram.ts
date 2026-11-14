import { enqueueOrDispatchBuild } from './build-dispatch.ts';
import { hmacSha256Hex } from './crypto.ts';
import {
  appendBuildLog,
  claimJoinEarnRewardOnce,
  clearFormDraft,
  deductBuildCreditAtomically,
  getAppSettings,
  getFormDraft,
  qualifyReferralIfEligible,
  recordWebhookUpdateIdempotent,
  refundBuildJobOnce,
  saveFormDraft,
  upsertUserAndGrantWelcomeOnce,
  writeAuditLog,
} from './db.ts';
import {
  buildDraftSummary,
  buildFormPrompt,
  buildWelcomeExistingUserMessage,
  buildWelcomeNewUserMessage,
  escapeMd,
  renderProgressMessage,
  t,
} from './i18n.ts';
import type {
  AppFormDraft,
  BuildQueueMessage,
  Env,
  LanguageCode,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
  UserRow,
} from './types.ts';
import {
  validateAppName,
  validateAppTheme,
  validateExternalLinksInput,
  validateHexColor,
  validateOrientation,
  validatePackageName,
  validatePermissionsList,
  validateStartPage,
  validateVersionCode,
  validateVersionName,
} from './validators.ts';
import { validateWebsiteZip } from './zip-validator.ts';

export class TelegramApiClient {
  private readonly botToken: string;
  constructor(botToken: string) {
    this.botToken = botToken;
  }

  private async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) {
      throw new Error(`Telegram API ${method} failed: ${data.description ?? res.statusText}`);
    }
    return data.result as T;
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    replyMarkup?: Record<string, unknown>
  ): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    replyMarkup?: Record<string, unknown>
  ): Promise<void> {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert = false): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text, show_alert: showAlert } : {}),
    });
  }

  async getChatMember(chatId: string | number, userId: number): Promise<{ status: string }> {
    return this.call<{ status: string }>('getChatMember', {
      chat_id: chatId,
      user_id: userId,
    });
  }

  async downloadFile(fileId: string): Promise<{ bytes: Uint8Array; filePath: string }> {
    const fileInfo = await this.call<{ file_path: string; file_size?: number }>('getFile', { file_id: fileId });
    const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${fileInfo.file_path}`;
    const resp = await fetch(fileUrl);
    if (!resp.ok) {
      throw new Error(`Failed to download Telegram file: ${resp.status}`);
    }
    const buf = await resp.arrayBuffer();
    return { bytes: new Uint8Array(buf), filePath: fileInfo.file_path };
  }

  async sendDocumentBytes(
    chatId: number | string,
    filename: string,
    bytes: Uint8Array,
    caption: string
  ): Promise<{ message_id: number; document?: { file_id: string } }> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption);
    form.append('parse_mode', 'Markdown');
    form.append('document', new Blob([bytes as BlobPart], { type: 'application/vnd.android.package-archive' }), filename);

    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const data = (await res.json()) as {
      ok: boolean;
      result?: { message_id: number; document?: { file_id: string } };
      description?: string;
    };
    if (!data.ok || !data.result) {
      throw new Error(`sendDocument failed: ${data.description ?? res.statusText}`);
    }
    return data.result;
  }

  async setWebhook(webhookUrl: string, secretToken: string): Promise<boolean> {
    return this.call<boolean>('setWebhook', {
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
  }
}

function mainReplyKeyboard(lang: LanguageCode): Record<string, unknown> {
  if (lang === 'en') {
    return {
      keyboard: [
        [{ text: '📱 Create APK' }, { text: '📦 My Builds' }],
        [{ text: '👤 My Account' }, { text: '📢 Join & Earn' }],
        [{ text: '👥 Refer & Earn' }, { text: '💰 My Points' }],
        [{ text: '🎟️ Free APK Credits' }, { text: '🆘 Help & Support' }],
      ],
      resize_keyboard: true,
    };
  }
  return {
    keyboard: [
      [{ text: '📱 Create APK' }, { text: '📦 My Builds' }],
      [{ text: '👤 My Account' }, { text: '📢 Join & Earn' }],
      [{ text: '👥 Refer & Earn' }, { text: '💰 My Points' }],
      [{ text: '🎟️ Free APK Credits' }, { text: '🆘 Help & Support' }],
    ],
    resize_keyboard: true,
  };
}

function welcomeInlineKeyboard(lang: LanguageCode): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: '✅ YES! CREATE MY APP', callback_data: 'welcome:yes' }],
      [{ text: '⏳ NO, MAYBE LATER', callback_data: 'welcome:later' }],
      [{ text: lang === 'bn' ? '🌐 Switch to English' : '🌐 বাংলায় দেখুন', callback_data: 'lang:toggle' }],
    ],
  };
}

function reviewInlineKeyboard(lang: LanguageCode): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{ text: lang === 'bn' ? '✅ Confirm & Upload ZIP' : '✅ Confirm & Upload ZIP', callback_data: 'form:confirm' }],
      [
        { text: '✏️ App Name', callback_data: 'form:edit:app_name' },
        { text: '✏️ Package', callback_data: 'form:edit:package_name' },
      ],
      [
        { text: '✏️ Version', callback_data: 'form:edit:version_name' },
        { text: '✏️ Orientation', callback_data: 'form:edit:orientation' },
      ],
      [
        { text: '✏️ Colors', callback_data: 'form:edit:status_bar_color' },
        { text: '✏️ Theme', callback_data: 'form:edit:app_theme' },
      ],
      [
        { text: '✏️ Permissions', callback_data: 'form:edit:permissions' },
        { text: '✏️ Start Page', callback_data: 'form:edit:start_page' },
      ],
      [{ text: '❌ Cancel Form', callback_data: 'form:cancel' }],
    ],
  };
}

async function checkRateLimit(env: Env, telegramUserId: number, maxPerMin = 30): Promise<boolean> {
  try {
    const id = env.RATE_LIMITER.idFromName(`tg:${telegramUserId}`);
    const stub = env.RATE_LIMITER.get(id);
    const resp = await stub.fetch(`https://rate-limiter/check?limit=${maxPerMin}&window=60`);
    return resp.ok;
  } catch {
    return true;
  }
}

export async function handleTelegramWebhook(env: Env, update: TelegramUpdate, ctx?: ExecutionContext): Promise<Response> {
  const tg = new TelegramApiClient(env.TELEGRAM_BOT_TOKEN);
  const fromUser = update.message?.from ?? update.callback_query?.from;
  const telegramUserId = fromUser?.id ?? null;
  const updateType = update.message ? 'message' : update.callback_query ? 'callback_query' : 'other';

  // Idempotent update guard: duplicate Telegram update_id can never execute twice
  const isFirst = await recordWebhookUpdateIdempotent(env.DB, update.update_id, telegramUserId, updateType);
  if (!isFirst) {
    return Response.json({ ok: true, duplicate: true });
  }

  if (!fromUser || fromUser.is_bot) {
    return Response.json({ ok: true, ignored: true });
  }

  const allowed = await checkRateLimit(env, fromUser.id, 40);
  if (!allowed) {
    if (update.message) {
      await tg.sendMessage(update.message.chat.id, '⏳ অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করে আবার চেষ্টা করুন (Rate limit exceeded).');
    }
    return Response.json({ ok: true, rateLimited: true });
  }

  const settings = await getAppSettings(env.DB);
  let startRefId: number | null = null;
  if (update.message?.text?.startsWith('/start ')) {
    const arg = Number(update.message.text.slice(7).trim());
    if (Number.isInteger(arg) && arg > 0) startRefId = arg;
  }

  const { user, wallet, isNewWelcomeGranted } = await upsertUserAndGrantWelcomeOnce(
    env.DB,
    {
      telegramUserId: fromUser.id,
      username: fromUser.username,
      firstName: fromUser.first_name,
      lastName: fromUser.last_name,
      referredByTelegramId: startRefId,
    },
    settings
  );

  if (user.is_banned === 1) {
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) {
      await tg.sendMessage(
        chatId,
        t(
          user.language_code,
          `🚫 আপনার অ্যাকাউন্টটি ব্যান করা হয়েছে।\nকারণ: ${user.ban_reason ?? 'নীতিমালা ভঙ্গ'}`,
          `🚫 Your account is suspended.\nReason: ${user.ban_reason ?? 'Policy violation'}`
        )
      );
    }
    return Response.json({ ok: true, banned: true });
  }

  if (update.callback_query) {
    await handleCallbackQuery(env, tg, user, wallet.points_balance, wallet.free_apk_credits, update.callback_query, settings);
    return Response.json({ ok: true });
  }

  if (update.message) {
    await handleMessage(env, tg, user, wallet.points_balance, wallet.free_apk_credits, update.message, isNewWelcomeGranted, settings, ctx);
  }

  return Response.json({ ok: true });
}

async function handleMessage(
  env: Env,
  tg: TelegramApiClient,
  user: UserRow,
  points: number,
  credits: number,
  msg: TelegramMessage,
  isNewWelcomeGranted: boolean,
  settings: Awaited<ReturnType<typeof getAppSettings>>,
  ctx?: ExecutionContext
): Promise<void> {
  const chatId = msg.chat.id;
  const lang = user.language_code;
  const text = (msg.text ?? '').trim();

  // Commands take priority
  if (text === '/start' || text.startsWith('/start ')) {
    await clearFormDraft(env.DB, user.telegram_user_id);
    const welcomeText = isNewWelcomeGranted
      ? buildWelcomeNewUserMessage(lang, user.first_name)
      : buildWelcomeExistingUserMessage(lang, user.first_name, points, credits);

    await tg.sendMessage(chatId, welcomeText, welcomeInlineKeyboard(lang));
    await tg.sendMessage(
      chatId,
      t(lang, '👇 নিচের মেনু থেকে যেকোনো অপশন বেছে নিন:', '👇 Choose an action from the menu below:'),
      mainReplyKeyboard(lang)
    );
    return;
  }

  if (text === '/cancel') {
    const activeJob = await env.DB
      .prepare(
        `SELECT id, job_code, status FROM build_jobs WHERE user_id = ? AND status IN ('queued', 'processing') ORDER BY id DESC LIMIT 1`
      )
      .bind(user.id)
      .first<{ id: number; job_code: string; status: string }>();

    if (activeJob && activeJob.status === 'queued') {
      await env.DB
        .prepare(
          `UPDATE build_jobs SET status = 'cancelled', error_message = 'Cancelled by user', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND status = 'queued'`
        )
        .bind(activeJob.id)
        .run();
      await refundBuildJobOnce(env.DB, activeJob.id, 'User cancelled queued build');
      await appendBuildLog(env.DB, activeJob.id, 'info', 'cancelled', 'Build cancelled by user via /cancel');
      await tg.sendMessage(
        chatId,
        t(
          lang,
          `✅ বিল্ড জব \`${activeJob.job_code}\` বাতিল করা হয়েছে এবং আপনার পয়েন্ট/ক্রেডিট ফেরত দেওয়া হয়েছে।`,
          `✅ Queued build \`${activeJob.job_code}\` was cancelled and your points/credit were refunded.`
        )
      );
      return;
    }

    await clearFormDraft(env.DB, user.telegram_user_id);
    await tg.sendMessage(chatId, t(lang, '✅ চলমান ফর্ম বাতিল করা হয়েছে।', '✅ Current form cancelled.'), mainReplyKeyboard(lang));
    return;
  }

  if (text === '/convert' || text === '📱 Create APK') {
    await startAppForm(env, tg, chatId, user, settings);
    return;
  }
  if (text === '/history' || text === '📦 My Builds') {
    await sendMyBuilds(env, tg, chatId, user);
    return;
  }
  if (text === '/status') {
    await sendLatestBuildStatus(env, tg, chatId, user);
    return;
  }
  if (text === '/profile' || text === '👤 My Account') {
    await sendMyAccount(env, tg, chatId, user, points, credits);
    return;
  }
  if (text === '📢 Join & Earn') {
    await sendJoinAndEarn(env, tg, chatId, user);
    return;
  }
  if (text === '👥 Refer & Earn') {
    await sendReferAndEarn(env, tg, chatId, user, settings);
    return;
  }
  if (text === '💰 My Points') {
    await sendMyPoints(env, tg, chatId, user, points, settings);
    return;
  }
  if (text === '🎟️ Free APK Credits') {
    await sendFreeCredits(tg, chatId, user, credits, points, settings);
    return;
  }
  if (text === '/help' || text === '🆘 Help & Support') {
    await sendHelp(tg, chatId, user, settings);
    return;
  }

  // Check if user is in active 14-step form or awaiting ZIP
  const draft = await getFormDraft(env.DB, user.telegram_user_id);
  if (draft) {
    await handleFormStepInput(env, tg, chatId, user, points, credits, draft, msg, settings, ctx);
    return;
  }

  await tg.sendMessage(
    chatId,
    t(
      lang,
      'ℹ️ নতুন Android APK তৈরি করতে `📱 Create APK` বা `/convert` ব্যবহার করুন।',
      'ℹ️ Tap `📱 Create APK` or `/convert` to start building your Android APK.'
    ),
    mainReplyKeyboard(lang)
  );
}

async function startAppForm(
  env: Env,
  tg: TelegramApiClient,
  chatId: number,
  user: UserRow,
  settings: Awaited<ReturnType<typeof getAppSettings>>
): Promise<void> {
  if (settings.maintenanceMode) {
    await tg.sendMessage(
      chatId,
      t(
        user.language_code,
        '🛠️ সিস্টেম মেইনটেন্যান্স চলছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।',
        '🛠️ System is currently under maintenance. Please try again shortly.'
      )
    );
    return;
  }

  const draft: AppFormDraft = {
    step: 'app_name',
    versionName: '1.0.0',
    versionCode: 1,
    orientation: 'portrait',
    statusBarColor: '#10B981',
    navBarColor: '#111827',
    appTheme: 'system',
    permissions: ['INTERNET', 'ACCESS_NETWORK_STATE'],
    startPage: 'index.html',
    externalLinksMode: 'in_app',
    externalLinksDomains: [],
  };
  await saveFormDraft(env.DB, user.telegram_user_id, draft);
  await tg.sendMessage(chatId, buildFormPrompt(user.language_code, 'app_name'));
}

async function advanceOrReturnToReview(
  env: Env,
  tg: TelegramApiClient,
  chatId: number,
  user: UserRow,
  draft: AppFormDraft,
  nextStep: AppFormDraft['step']
): Promise<void> {
  if (draft.editingSingleField) {
    draft.editingSingleField = undefined;
    draft.step = 'review';
    await saveFormDraft(env.DB, user.telegram_user_id, draft);
    await tg.sendMessage(
      chatId,
      `${buildDraftSummary(user.language_code, draft)}\n\n${buildFormPrompt(user.language_code, 'review')}`,
      reviewInlineKeyboard(user.language_code)
    );
    return;
  }

  draft.step = nextStep;
  await saveFormDraft(env.DB, user.telegram_user_id, draft);

  if (nextStep === 'splash_screen') {
    await tg.sendMessage(chatId, buildFormPrompt(user.language_code, nextStep), {
      inline_keyboard: [[{ text: '⏭️ Skip Splash', callback_data: 'form:skip_splash' }]],
    });
  } else if (nextStep === 'orientation') {
    await tg.sendMessage(chatId, buildFormPrompt(user.language_code, nextStep), {
      inline_keyboard: [
        [
          { text: '📱 Portrait', callback_data: 'form:orient:portrait' },
          { text: '📺 Landscape', callback_data: 'form:orient:landscape' },
          { text: '🔄 Auto', callback_data: 'form:orient:auto' },
        ],
      ],
    });
  } else if (nextStep === 'app_theme') {
    await tg.sendMessage(chatId, buildFormPrompt(user.language_code, nextStep), {
      inline_keyboard: [
        [
          { text: '☀️ Light', callback_data: 'form:theme:light' },
          { text: '🌙 Dark', callback_data: 'form:theme:dark' },
          { text: '⚙️ System Default', callback_data: 'form:theme:system' },
        ],
      ],
    });
  } else if (nextStep === 'permissions') {
    await tg.sendMessage(chatId, buildFormPrompt(user.language_code, nextStep), {
      inline_keyboard: [
        [{ text: '✅ Default (INTERNET + NETWORK)', callback_data: 'form:perm:default' }],
        [{ text: '📷 + CAMERA', callback_data: 'form:perm:camera' }],
        [{ text: '📍 + LOCATION', callback_data: 'form:perm:location' }],
      ],
    });
  } else if (nextStep === 'external_links') {
    await tg.sendMessage(chatId, buildFormPrompt(user.language_code, nextStep), {
      inline_keyboard: [
        [{ text: '📲 Open in App WebView', callback_data: 'form:ext:in_app' }],
        [{ text: '🌐 Open in External Browser', callback_data: 'form:ext:external_browser' }],
        [{ text: '🛡️ Whitelist Domains (type domains)', callback_data: 'form:ext:whitelist_prompt' }],
      ],
    });
  } else if (nextStep === 'review') {
    await tg.sendMessage(
      chatId,
      `${buildDraftSummary(user.language_code, draft)}\n\n${buildFormPrompt(user.language_code, 'review')}`,
      reviewInlineKeyboard(user.language_code)
    );
  } else {
    await tg.sendMessage(chatId, buildFormPrompt(user.language_code, nextStep));
  }
}

async function handleFormStepInput(
  env: Env,
  tg: TelegramApiClient,
  chatId: number,
  user: UserRow,
  points: number,
  credits: number,
  draft: AppFormDraft,
  msg: TelegramMessage,
  settings: Awaited<ReturnType<typeof getAppSettings>>,
  ctx?: ExecutionContext
): Promise<void> {
  const lang = user.language_code;
  const text = (msg.text ?? '').trim();

  if (draft.step === 'awaiting_zip') {
    if (!msg.document) {
      await tg.sendMessage(
        chatId,
        t(lang, '⚠️ অনুগ্রহ করে একটি `.zip` ফাইল (Document হিসেবে) আপলোড করুন।', '⚠️ Please upload a `.zip` file as a Telegram document.')
      );
      return;
    }
    await processUploadedWebsiteZip(env, tg, chatId, user, points, credits, draft, msg, settings, ctx);
    return;
  }

  switch (draft.step) {
    case 'app_name': {
      const check = validateAppName(text);
      if (!check.valid) {
        await tg.sendMessage(chatId, `❌ ${check.error}`);
        return;
      }
      draft.appName = check.value;
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'package_name');
      return;
    }
    case 'package_name': {
      const check = validatePackageName(text);
      if (!check.valid) {
        await tg.sendMessage(chatId, `❌ ${check.error}`);
        return;
      }
      // Enforce uniqueness for other users' projects
      const existingPkg = await env.DB
        .prepare('SELECT user_id FROM projects WHERE package_name = ? AND user_id != ? LIMIT 1')
        .bind(check.value!, user.id)
        .first<{ user_id: number }>();
      if (existingPkg) {
        await tg.sendMessage(
          chatId,
          t(
            lang,
            `❌ প্যাকেজ নাম \`${check.value}\` ইতোমধ্যেই অন্য একটি অ্যাপে ব্যবহৃত হয়েছে। অনুগ্রহ করে অনন্য প্যাকেজ নাম দিন।`,
            `❌ Package name \`${check.value}\` is already registered by another user. Please choose a unique package name.`
          )
        );
        return;
      }
      draft.packageName = check.value;
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'version_name');
      return;
    }
    case 'version_name': {
      const check = validateVersionName(text);
      if (!check.valid) {
        await tg.sendMessage(chatId, `❌ ${check.error}`);
        return;
      }
      draft.versionName = check.value;
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'version_code');
      return;
    }
    case 'version_code': {
      const check = validateVersionCode(text);
      if (!check.valid) {
        await tg.sendMessage(chatId, `❌ ${check.error}`);
        return;
      }
      draft.versionCode = check.value;
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'app_description');
      return;
    }
    case 'app_description': {
      if (!text || text.length < 3 || text.length > 300) {
        await tg.sendMessage(chatId, '❌ Description must be between 3 and 300 characters.');
        return;
      }
      draft.appDescription = text;
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'app_logo');
      return;
    }
    case 'app_logo':
    case 'splash_screen': {
      const isSplash = draft.step === 'splash_screen';
      const fileId = msg.document?.file_id ?? msg.photo?.[msg.photo.length - 1]?.file_id;
      if (!fileId) {
        await tg.sendMessage(
          chatId,
          t(lang, '❌ অনুগ্রহ করে একটি PNG, JPG বা WEBP ছবি পাঠান।', '❌ Please send a PNG, JPG, or WEBP image.')
        );
        return;
      }
      const downloaded = await tg.downloadFile(fileId);
      if (downloaded.bytes.byteLength > 5 * 1024 * 1024) {
        await tg.sendMessage(chatId, '❌ Image must be smaller than 5 MB.');
        return;
      }
      const r2Key = `assets/${user.telegram_user_id}/${isSplash ? 'splash' : 'logo'}-${Date.now()}.png`;
      await env.STORAGE.put(r2Key, downloaded.bytes, {
        httpMetadata: { contentType: msg.document?.mime_type ?? 'image/png' },
      });
      if (isSplash) {
        draft.splashR2Key = r2Key;
        await advanceOrReturnToReview(env, tg, chatId, user, draft, 'orientation');
      } else {
        draft.logoR2Key = r2Key;
        await advanceOrReturnToReview(env, tg, chatId, user, draft, 'splash_screen');
      }
      return;
    }
    case 'orientation': {
      const orient = validateOrientation(text);
      if (!orient) {
        await tg.sendMessage(chatId, '❌ Choose Portrait, Landscape, or Auto.');
        return;
      }
      draft.orientation = orient;
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'status_bar_color');
      return;
    }
    case 'status_bar_color': {
      const check = validateHexColor(text);
      if (!check.valid) {
        await tg.sendMessage(chatId, `❌ ${check.error}`);
        return;
      }
      draft.statusBarColor = check.value;
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'nav_bar_color');
      return;
    }
    case 'nav_bar_color': {
      const check = validateHexColor(text);
      if (!check.valid) {
        await tg.sendMessage(chatId, `❌ ${check.error}`);
        return;
      }
      draft.navBarColor = check.value;
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'app_theme');
      return;
    }
    case 'app_theme': {
      const theme = validateAppTheme(text);
      if (!theme) {
        await tg.sendMessage(chatId, '❌ Choose Light, Dark, or System.');
        return;
      }
      draft.appTheme = theme;
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'permissions');
      return;
    }
    case 'permissions': {
      const check = validatePermissionsList(text);
      if (!check.valid) {
        await tg.sendMessage(chatId, `❌ ${check.error}`);
        return;
      }
      draft.permissions = check.value;
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'start_page');
      return;
    }
    case 'start_page': {
      const check = validateStartPage(text);
      if (!check.valid) {
        await tg.sendMessage(chatId, `❌ ${check.error}`);
        return;
      }
      draft.startPage = check.value;
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'external_links');
      return;
    }
    case 'external_links': {
      const check = validateExternalLinksInput('whitelist', text);
      if (!check.valid) {
        await tg.sendMessage(chatId, `❌ ${check.error}`);
        return;
      }
      draft.externalLinksMode = 'whitelist';
      draft.externalLinksDomains = check.domains;
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'review');
      return;
    }
    default:
      await tg.sendMessage(chatId, buildFormPrompt(lang, draft.step));
  }
}

async function processUploadedWebsiteZip(
  env: Env,
  tg: TelegramApiClient,
  chatId: number,
  user: UserRow,
  points: number,
  credits: number,
  draft: AppFormDraft,
  msg: TelegramMessage,
  settings: Awaited<ReturnType<typeof getAppSettings>>,
  ctx?: ExecutionContext
): Promise<void> {
  const lang = user.language_code;
  const doc = msg.document!;
  const filename = doc.file_name ?? 'website.zip';

  if (!filename.toLowerCase().endsWith('.zip')) {
    await tg.sendMessage(
      chatId,
      t(lang, '❌ শুধুমাত্র `.zip` ফাইল গ্রহণযোগ্য।', '❌ Only `.zip` archives are accepted.')
    );
    return;
  }

  // Load per-user limits or global settings
  const userLimits = await env.DB
    .prepare('SELECT * FROM user_limits WHERE user_id = ?')
    .bind(user.id)
    .first<{
      max_zip_bytes: number;
      max_extracted_bytes: number;
      max_file_count: number;
      max_depth: number;
    }>();

  const limits = {
    maxZipBytes: userLimits?.max_zip_bytes ?? settings.maxZipBytes,
    maxExtractedBytes: userLimits?.max_extracted_bytes ?? settings.maxExtractedBytes,
    maxFileCount: userLimits?.max_file_count ?? settings.maxFileCount,
    maxDirectoryDepth: userLimits?.max_depth ?? settings.maxDirectoryDepth,
  };

  if (doc.file_size && doc.file_size > limits.maxZipBytes) {
    await tg.sendMessage(
      chatId,
      `❌ ZIP file (${(doc.file_size / 1024 / 1024).toFixed(2)} MB) exceeds max upload limit (${(limits.maxZipBytes / 1024 / 1024).toFixed(1)} MB).`
    );
    return;
  }

  // Check balance BEFORE creating job
  if (credits < 1 && points < settings.buildCostPoints) {
    await tg.sendMessage(
      chatId,
      t(
        lang,
        `❌ অপর্যাপ্ত ব্যালেন্স! ১টি APK বিল্ড করতে ১টি ফ্রি ক্রেডিট অথবা ${settings.buildCostPoints} পয়েন্ট প্রয়োজন।\nআপনার আছে: ${credits} ক্রেডিট ও ${points} পয়েন্ট।\n📢 Join & Earn অথবা 👥 Refer & Earn থেকে পয়েন্ট সংগ্রহ করুন!`,
        `❌ Insufficient balance! Building an APK requires 1 Free Credit or ${settings.buildCostPoints} points.\nYour balance: ${credits} credits, ${points} points.`
      )
    );
    return;
  }

  const progressMsg = await tg.sendMessage(
    chatId,
    renderProgressMessage(lang, 'PENDING', draft.appName ?? 'App', 'ZIP received', 5)
  );

  const downloaded = await tg.downloadFile(doc.file_id);

  await tg.editMessageText(
    chatId,
    progressMsg.message_id,
    renderProgressMessage(lang, 'SCANNING', draft.appName ?? 'App', 'Security scanning', 15)
  );

  const validation = await validateWebsiteZip(downloaded.bytes, limits, draft.startPage ?? 'index.html');

  // Create or update project record
  const projectInsert = await env.DB
    .prepare(
      `INSERT INTO projects
       (user_id, app_name, package_name, version_name, version_code, app_description, logo_r2_key, splash_r2_key,
        orientation, status_bar_color, nav_bar_color, app_theme, permissions_json, start_page,
        external_links_mode, external_links_domains_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      user.id,
      draft.appName ?? 'WebApp',
      draft.packageName ?? `com.mrwebtoapk.u${user.telegram_user_id}.app`,
      draft.versionName ?? '1.0.0',
      draft.versionCode ?? 1,
      draft.appDescription ?? '',
      draft.logoR2Key ?? null,
      draft.splashR2Key ?? null,
      draft.orientation ?? 'portrait',
      draft.statusBarColor ?? '#10B981',
      draft.navBarColor ?? '#111827',
      draft.appTheme ?? 'system',
      JSON.stringify(draft.permissions ?? ['INTERNET', 'ACCESS_NETWORK_STATE']),
      draft.startPage ?? 'index.html',
      draft.externalLinksMode ?? 'in_app',
      JSON.stringify(draft.externalLinksDomains ?? []),
      validation.valid ? 'ready' : 'failed'
    )
    .run();

  const projectId = Number(projectInsert.meta.last_row_id);
  const uploadR2Key = `uploads/${user.telegram_user_id}/${Date.now()}-${validation.sha256.slice(0, 12)}.zip`;

  if (!validation.valid) {
    await env.DB
      .prepare(
        `INSERT INTO uploaded_files
         (user_id, project_id, file_type, r2_key, original_filename, mime_type, size_bytes, sha256, validation_status, rejection_reason)
         VALUES (?, ?, 'website_zip', ?, ?, ?, ?, ?, 'rejected', ?)`
      )
      .bind(
        user.id,
        projectId,
        uploadR2Key,
        filename,
        doc.mime_type ?? 'application/zip',
        downloaded.bytes.byteLength,
        validation.sha256,
        validation.rejectionReason ?? 'Security validation failed'
      )
      .run();

    await writeAuditLog(env.DB, {
      actorType: 'system',
      actorId: 'zip-validator',
      action: 'zip_rejected',
      targetType: 'user',
      targetId: String(user.id),
      reason: validation.rejectionReason ?? 'Rejected ZIP upload',
      after: { code: validation.rejectionCode, filename },
    });

    await tg.editMessageText(
      chatId,
      progressMsg.message_id,
      t(
        lang,
        `❌ *ZIP নিরাপত্তা যাচাই ব্যর্থ হয়েছে!*\n\nকারণ: ${escapeMd(validation.rejectionReason ?? 'অবৈধ ফাইল')}\n\nℹ️ আপনার পয়েন্ট বা ক্রেডিট কাটা হয়নি। সঠিক স্ট্যাটিক HTML/CSS/JS/JSON ZIP আবার আপলোড করুন।`,
        `❌ *ZIP Security Validation Failed!*\n\nReason: ${escapeMd(validation.rejectionReason ?? 'Invalid archive')}\n\nℹ️ No points or credits were deducted. Fix the archive and upload again.`
      )
    );
    return;
  }

  // Upload validated ZIP to private R2 storage
  await env.STORAGE.put(uploadR2Key, downloaded.bytes, {
    httpMetadata: { contentType: 'application/zip' },
    customMetadata: { sha256: validation.sha256, telegramUserId: String(user.telegram_user_id) },
  });

  const fileInsert = await env.DB
    .prepare(
      `INSERT INTO uploaded_files
       (user_id, project_id, file_type, r2_key, original_filename, mime_type, size_bytes, sha256,
        validation_status, file_count, extracted_size_bytes, max_depth)
       VALUES (?, ?, 'website_zip', ?, ?, ?, ?, ?, 'passed', ?, ?, ?)`
    )
    .bind(
      user.id,
      projectId,
      uploadR2Key,
      filename,
      doc.mime_type ?? 'application/zip',
      downloaded.bytes.byteLength,
      validation.sha256,
      validation.fileCount,
      validation.extractedSizeBytes,
      validation.maxDepth
    )
    .run();

  const uploadedFileId = Number(fileInsert.meta.last_row_id);
  const jobCode = `JOB-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  // Atomically deduct 1 free credit OR 1,000 points
  const charge = await deductBuildCreditAtomically(env.DB, {
    userId: user.id,
    jobCode,
    buildCostPoints: settings.buildCostPoints,
  });

  if (!charge.ok) {
    await tg.editMessageText(
      chatId,
      progressMsg.message_id,
      t(lang, '❌ অপর্যাপ্ত ব্যালেন্স! বিল্ড শুরু করা যায়নি।', '❌ Insufficient balance to start build.')
    );
    return;
  }

  const jobInsert = await env.DB
    .prepare(
      `INSERT INTO build_jobs
       (job_code, user_id, project_id, uploaded_file_id, status, stage, progress_percent,
        payment_type, points_charged, credits_charged, charge_idempotency_key,
        telegram_chat_id, telegram_progress_message_id)
       VALUES (?, ?, ?, ?, 'queued', 'Website validation', 35, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      jobCode,
      user.id,
      projectId,
      uploadedFileId,
      charge.paymentType,
      charge.pointsCharged,
      charge.creditsCharged,
      `build_charge:${jobCode}`,
      chatId,
      progressMsg.message_id
    )
    .run();

  const buildJobId = Number(jobInsert.meta.last_row_id);
  await appendBuildLog(env.DB, buildJobId, 'info', 'website_validation', 'ZIP passed security validation and entered build queue', {
    fileCount: validation.fileCount,
    extractedSizeBytes: validation.extractedSizeBytes,
    paymentType: charge.paymentType,
  });

  // Qualify referral if default event is first_zip_validated
  const refResult = await qualifyReferralIfEligible(env.DB, user.id, 'first_zip_validated', settings);
  if (refResult.rewarded && refResult.referrerUserId) {
    const refUser = await env.DB
      .prepare('SELECT telegram_user_id, language_code FROM users WHERE id = ?')
      .bind(refResult.referrerUserId)
      .first<{ telegram_user_id: number; language_code: LanguageCode }>();
    if (refUser) {
      await tg.sendMessage(
        refUser.telegram_user_id,
        t(
          refUser.language_code,
          `🎉 আপনার রেফার করা বন্ধু সফলভাবে প্রথম ZIP ভ্যালিডেশন সম্পন্ন করেছে! আপনি পেয়েছেন +${settings.referralRewardPoints} পয়েন্ট` +
            (refResult.milestoneAwarded
              ? ` এবং ${refResult.milestoneAwarded} রেফারেল মাইলস্টোন বোনাস (+${settings.referralMilestonePoints} পয়েন্ট + ${settings.referralMilestoneCredits} ফ্রি APK ক্রেডিট)!`
              : '!'),
          `🎉 Your referred friend validated their first ZIP! You earned +${settings.referralRewardPoints} points` +
            (refResult.milestoneAwarded
              ? ` plus milestone #${refResult.milestoneAwarded} bonus (+${settings.referralMilestonePoints} pts & +${settings.referralMilestoneCredits} Free APK Credit)!`
              : '!')
        )
      );
    }
  }

  await clearFormDraft(env.DB, user.telegram_user_id);

  await tg.editMessageText(
    chatId,
    progressMsg.message_id,
    renderProgressMessage(
      lang,
      jobCode,
      draft.appName ?? 'WebApp',
      'Website validation',
      35,
      charge.paymentType === 'free_credit'
        ? t(lang, '১টি ফ্রি APK ক্রেডিট ব্যবহৃত হয়েছে। বিল্ড সার্ভারে পাঠানো হচ্ছে...', 'Used 1 Free APK Credit. Queued for Android Build Server...')
        : t(lang, `${settings.buildCostPoints} পয়েন্ট ব্যবহৃত হয়েছে। বিল্ড সার্ভারে পাঠানো হচ্ছে...`, `Used ${settings.buildCostPoints} points. Queued for Android Build Server...`)
    )
  );

  // Enqueue job on Cloudflare Queues (retains safely even if external build server is temporarily offline)
  const queueMsg: BuildQueueMessage = {
    buildJobId,
    jobCode,
    userId: user.id,
    projectId,
    uploadedFileId,
    enqueuedAt: new Date().toISOString(),
  };
  await enqueueOrDispatchBuild(env, queueMsg, ctx);
}

async function handleCallbackQuery(
  env: Env,
  tg: TelegramApiClient,
  user: UserRow,
  points: number,
  credits: number,
  cq: TelegramCallbackQuery,
  settings: Awaited<ReturnType<typeof getAppSettings>>
): Promise<void> {
  const data = cq.data ?? '';
  const chatId = cq.message?.chat.id ?? user.telegram_user_id;
  const lang = user.language_code;

  if (data === 'lang:toggle') {
    const nextLang: LanguageCode = lang === 'bn' ? 'en' : 'bn';
    await env.DB.prepare('UPDATE users SET language_code = ? WHERE id = ?').bind(nextLang, user.id).run();
    await tg.answerCallbackQuery(cq.id, nextLang === 'bn' ? 'বাংলা ভাষা চালু হয়েছে' : 'Switched to English');
    await tg.sendMessage(
      chatId,
      buildWelcomeExistingUserMessage(nextLang, user.first_name, points, credits),
      welcomeInlineKeyboard(nextLang)
    );
    return;
  }

  if (data === 'welcome:yes') {
    await tg.answerCallbackQuery(cq.id);
    await startAppForm(env, tg, chatId, user, settings);
    return;
  }

  if (data === 'welcome:later') {
    await tg.answerCallbackQuery(cq.id);
    await tg.sendMessage(
      chatId,
      t(
        lang,
        '👍 কোনো সমস্যা নেই! যখনই অ্যাপ তৈরি করতে চাইবেন নিচের `📱 Create APK` বাটনে চাপুন।',
        '👍 No problem! Tap `📱 Create APK` anytime you are ready.'
      ),
      mainReplyKeyboard(lang)
    );
    return;
  }

  if (data.startsWith('join_verify:')) {
    const channelId = Number(data.split(':')[1]);
    await verifyChannelMembership(env, tg, cq, user, channelId);
    return;
  }

  // Form callbacks
  const draft = await getFormDraft(env.DB, user.telegram_user_id);
  if (!draft) {
    await tg.answerCallbackQuery(cq.id, 'No active form session. Tap Create APK.', true);
    return;
  }

  if (data === 'form:cancel') {
    await clearFormDraft(env.DB, user.telegram_user_id);
    await tg.answerCallbackQuery(cq.id, 'Cancelled');
    await tg.sendMessage(chatId, t(lang, '❌ ফর্ম বাতিল করা হয়েছে।', '❌ Form cancelled.'), mainReplyKeyboard(lang));
    return;
  }

  if (data === 'form:skip_splash') {
    draft.splashR2Key = null;
    await tg.answerCallbackQuery(cq.id);
    await advanceOrReturnToReview(env, tg, chatId, user, draft, 'orientation');
    return;
  }

  if (data.startsWith('form:orient:')) {
    const orient = validateOrientation(data.split(':')[2] ?? '');
    if (orient) {
      draft.orientation = orient;
      await tg.answerCallbackQuery(cq.id, orient);
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'status_bar_color');
    }
    return;
  }

  if (data.startsWith('form:theme:')) {
    const theme = validateAppTheme(data.split(':')[2] ?? '');
    if (theme) {
      draft.appTheme = theme;
      await tg.answerCallbackQuery(cq.id, theme);
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'permissions');
    }
    return;
  }

  if (data.startsWith('form:perm:')) {
    const kind = data.split(':')[2];
    if (kind === 'default') draft.permissions = ['INTERNET', 'ACCESS_NETWORK_STATE'];
    if (kind === 'camera') draft.permissions = ['INTERNET', 'ACCESS_NETWORK_STATE', 'CAMERA'];
    if (kind === 'location') draft.permissions = ['INTERNET', 'ACCESS_NETWORK_STATE', 'ACCESS_FINE_LOCATION'];
    await tg.answerCallbackQuery(cq.id);
    await advanceOrReturnToReview(env, tg, chatId, user, draft, 'start_page');
    return;
  }

  if (data.startsWith('form:ext:')) {
    const mode = data.split(':')[2];
    if (mode === 'whitelist_prompt') {
      draft.step = 'external_links';
      await saveFormDraft(env.DB, user.telegram_user_id, draft);
      await tg.answerCallbackQuery(cq.id);
      await tg.sendMessage(
        chatId,
        t(lang, '🛡️ অনুমোদিত ডোমেইনগুলো কমা দিয়ে লিখুন (যেমন: `example.com, api.example.com`)', '🛡️ Enter whitelisted domains separated by commas (e.g., `example.com, api.example.com`)')
      );
      return;
    }
    if (mode === 'in_app' || mode === 'external_browser') {
      draft.externalLinksMode = mode;
      draft.externalLinksDomains = [];
      await tg.answerCallbackQuery(cq.id);
      await advanceOrReturnToReview(env, tg, chatId, user, draft, 'review');
    }
    return;
  }

  if (data.startsWith('form:edit:')) {
    const field = data.slice('form:edit:'.length) as AppFormDraft['step'];
    draft.editingSingleField = field;
    draft.step = field;
    await saveFormDraft(env.DB, user.telegram_user_id, draft);
    await tg.answerCallbackQuery(cq.id);
    await tg.sendMessage(chatId, buildFormPrompt(lang, field));
    return;
  }

  if (data === 'form:confirm') {
    draft.step = 'awaiting_zip';
    await saveFormDraft(env.DB, user.telegram_user_id, draft);
    await tg.answerCallbackQuery(cq.id);
    await tg.sendMessage(chatId, buildFormPrompt(lang, 'awaiting_zip'));
  }
}

async function verifyChannelMembership(
  env: Env,
  tg: TelegramApiClient,
  cq: TelegramCallbackQuery,
  user: UserRow,
  channelId: number
): Promise<void> {
  const lang = user.language_code;
  const chatId = cq.message?.chat.id ?? user.telegram_user_id;

  const channel = await env.DB
    .prepare('SELECT * FROM telegram_channels WHERE id = ? AND is_active = 1')
    .bind(channelId)
    .first<{ id: number; name: string; chat_id: string; reward_points: number }>();

  if (!channel) {
    await tg.answerCallbackQuery(cq.id, 'Channel is no longer active.', true);
    return;
  }

  try {
    const member = await tg.getChatMember(channel.chat_id, user.telegram_user_id);
    const eligibleStatuses = new Set(['member', 'administrator', 'creator']);
    if (!eligibleStatuses.has(member.status)) {
      await tg.answerCallbackQuery(
        cq.id,
        t(lang, '❌ আপনি এখনো এই চ্যানেল/গ্রুপে জয়েন করেননি!', '❌ You have not joined this channel/group yet!'),
        true
      );
      return;
    }

    const claim = await claimJoinEarnRewardOnce(env.DB, {
      userId: user.id,
      channelId: channel.id,
      chatId: channel.chat_id,
      rewardPoints: channel.reward_points,
      channelName: channel.name,
    });

    if (!claim.claimed) {
      await tg.answerCallbackQuery(
        cq.id,
        t(lang, 'ℹ️ আপনি ইতোমধ্যেই এই চ্যানেলের বোনাস সংগ্রহ করেছেন।', 'ℹ️ You have already claimed this channel reward.'),
        true
      );
      return;
    }

    await tg.answerCallbackQuery(cq.id, `+${channel.reward_points} Points!`);
    await tg.sendMessage(
      chatId,
      t(
        lang,
        `🎉 *অভিনন্দন!* "${escapeMd(channel.name)}" জয়েন যাচাই সম্পন্ন হয়েছে।\n✅ *+${channel.reward_points} পয়েন্ট* যোগ হয়েছে!\n💰 বর্তমান ব্যালেন্স: *${claim.newBalance?.toLocaleString()} পয়েন্ট*`,
        `🎉 *Verified!* Membership in "${escapeMd(channel.name)}" confirmed.\n✅ *+${channel.reward_points} points* added!\n💰 Current balance: *${claim.newBalance?.toLocaleString()} points*`
      )
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification error';
    await tg.answerCallbackQuery(cq.id, 'Verification failed', true);
    await tg.sendMessage(
      chatId,
      t(
        lang,
        `⚠️ মেম্বারশিপ যাচাই করা যায়নি। বটটি চ্যানেলে এডমিন হিসেবে যুক্ত আছে কিনা নিশ্চিত করুন।\n(${escapeMd(message)})`,
        `⚠️ Could not verify membership. Ensure the bot is an admin in the channel.\n(${escapeMd(message)})`
      )
    );
  }
}

async function sendJoinAndEarn(env: Env, tg: TelegramApiClient, chatId: number, user: UserRow): Promise<void> {
  const lang = user.language_code;
  const { results: channels } = await env.DB
    .prepare(
      `SELECT tc.*,
              CASE WHEN tmr.id IS NOT NULL THEN 1 ELSE 0 END AS claimed
       FROM telegram_channels tc
       LEFT JOIN telegram_membership_rewards tmr
         ON tmr.channel_id = tc.id AND tmr.user_id = ?
       WHERE tc.is_active = 1
       ORDER BY tc.id DESC`
    )
    .bind(user.id)
    .all<{
      id: number;
      name: string;
      invite_url: string;
      reward_points: number;
      claimed: number;
    }>();

  if (channels.length === 0) {
    await tg.sendMessage(
      chatId,
      t(lang, '📢 বর্তমানে কোনো Join & Earn চ্যানেল সক্রিয় নেই।', '📢 No active Join & Earn channels right now.')
    );
    return;
  }

  const lines = channels.map(
    (c, idx) =>
      `${idx + 1}. *${escapeMd(c.name)}* — ${c.reward_points} pts ${c.claimed ? '✅ Claimed' : '🆕 Available'}`
  );
  const inline_keyboard = channels.flatMap((c) =>
    c.claimed
      ? []
      : [
          [
            { text: `📢 Join ${c.name}`, url: c.invite_url },
            { text: `✅ Verify Membership`, callback_data: `join_verify:${c.id}` },
          ],
        ]
  );

  await tg.sendMessage(
    chatId,
    t(
      lang,
      `📢 *Join & Earn — ফ্রি পয়েন্ট আয় করুন!*\n\nপ্রতিটি চ্যানেল/গ্রুপে জয়েন করে *Verify Membership* চাপুন:\n\n${lines.join('\n')}`,
      `📢 *Join & Earn — Earn Free Points!*\n\nJoin any channel/group below and tap *Verify Membership*:\n\n${lines.join('\n')}`
    ),
    inline_keyboard.length ? { inline_keyboard } : undefined
  );
}

async function sendReferAndEarn(
  env: Env,
  tg: TelegramApiClient,
  chatId: number,
  user: UserRow,
  settings: Awaited<ReturnType<typeof getAppSettings>>
): Promise<void> {
  const lang = user.language_code;
  const stats = await env.DB
    .prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) as qualified
       FROM referrals WHERE referrer_user_id = ?`
    )
    .bind(user.id)
    .first<{ total: number; qualified: number | null }>();

  const refLink = `https://t.me/${settings.botUsername}?start=${user.telegram_user_id}`;
  const qualified = stats?.qualified ?? 0;
  const nextMilestone = Math.floor(qualified / settings.referralMilestoneInterval + 1) * settings.referralMilestoneInterval;

  await tg.sendMessage(
    chatId,
    t(
      lang,
      `👥 *Refer & Earn প্রোগ্রাম*\n\n` +
        `🔗 *আপনার রেফারেল লিংক:*\n\`${refLink}\`\n\n` +
        `🎁 *পুরস্কার:*\n` +
        `• প্রতি সফল রেফারে *${settings.referralRewardPoints} পয়েন্ট*\n` +
        `• প্রতি ${settings.referralMilestoneInterval} সফল রেফারে *${settings.referralMilestonePoints} বোনাস পয়েন্ট + ${settings.referralMilestoneCredits}টি ফ্রি APK ক্রেডিট* (১০, ২০, ৩০... আনলিমিটেড!)\n\n` +
        `📊 *আপনার পরিসংখ্যান:*\n` +
        `• মোট রেফার: ${stats?.total ?? 0}\n` +
        `• সফল (Qualified): ${qualified}\n` +
        `• পরবর্তী মাইলস্টোন: ${nextMilestone} জন`,
      `👥 *Refer & Earn Program*\n\n` +
        `🔗 *Your Referral Link:*\n\`${refLink}\`\n\n` +
        `🎁 *Rewards:*\n` +
        `• *${settings.referralRewardPoints} pts* per qualified referral\n` +
        `• Every ${settings.referralMilestoneInterval} referrals: *${settings.referralMilestonePoints} bonus pts + ${settings.referralMilestoneCredits} Free APK Credit* (10, 20, 30... unlimited!)\n\n` +
        `📊 *Your Stats:*\n` +
        `• Total Invited: ${stats?.total ?? 0}\n` +
        `• Qualified: ${qualified}\n` +
        `• Next Milestone: ${nextMilestone}`
    )
  );
}

async function sendMyBuilds(env: Env, tg: TelegramApiClient, chatId: number, user: UserRow): Promise<void> {
  const lang = user.language_code;
  const { results } = await env.DB
    .prepare(
      `SELECT bj.job_code, bj.status, bj.stage, bj.progress_percent, bj.created_at, p.app_name, p.package_name
       FROM build_jobs bj
       JOIN projects p ON p.id = bj.project_id
       WHERE bj.user_id = ?
       ORDER BY bj.id DESC
       LIMIT 10`
    )
    .bind(user.id)
    .all<{
      job_code: string;
      status: string;
      stage: string;
      progress_percent: number;
      created_at: string;
      app_name: string;
      package_name: string;
    }>();

  if (results.length === 0) {
    await tg.sendMessage(
      chatId,
      t(lang, '📦 আপনার এখনো কোনো APK বিল্ড নেই। `📱 Create APK` দিয়ে শুরু করুন!', '📦 You have no APK builds yet. Tap `📱 Create APK` to build one!')
    );
    return;
  }

  const lines = results.map(
    (b) =>
      `• *${escapeMd(b.app_name)}* (\`${b.job_code}\`)\n  Status: *${b.status.toUpperCase()}* — ${escapeMd(b.stage)} (${b.progress_percent}%)`
  );
  await tg.sendMessage(chatId, `📦 *Recent APK Builds:*\n\n${lines.join('\n\n')}`);
}

async function sendLatestBuildStatus(env: Env, tg: TelegramApiClient, chatId: number, user: UserRow): Promise<void> {
  const lang = user.language_code;
  const latest = await env.DB
    .prepare(
      `SELECT bj.job_code, bj.status, bj.stage, bj.progress_percent, bj.error_message, p.app_name
       FROM build_jobs bj JOIN projects p ON p.id = bj.project_id
       WHERE bj.user_id = ? ORDER BY bj.id DESC LIMIT 1`
    )
    .bind(user.id)
    .first<{
      job_code: string;
      status: string;
      stage: string;
      progress_percent: number;
      error_message: string | null;
      app_name: string;
    }>();

  if (!latest) {
    await tg.sendMessage(chatId, t(lang, 'ℹ️ কোনো সাম্প্রতিক বিল্ড পাওয়া যায়নি।', 'ℹ️ No build jobs found.'));
    return;
  }

  await tg.sendMessage(
    chatId,
    renderProgressMessage(lang, latest.job_code, latest.app_name, latest.stage, latest.progress_percent, latest.error_message ?? undefined)
  );
}

async function sendMyAccount(
  env: Env,
  tg: TelegramApiClient,
  chatId: number,
  user: UserRow,
  points: number,
  credits: number
): Promise<void> {
  const lang = user.language_code;
  const counts = await env.DB
    .prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
       FROM build_jobs WHERE user_id = ?`
    )
    .bind(user.id)
    .first<{ total: number; completed: number | null }>();

  await tg.sendMessage(
    chatId,
    t(
      lang,
      `👤 *আমার অ্যাকাউন্ট*\n\n` +
        `• *নাম:* ${escapeMd(user.first_name)}\n` +
        `• *Telegram ID:* \`${user.telegram_user_id}\`\n` +
        `• *ভাষা:* ${lang === 'bn' ? 'বাংলা' : 'English'}\n` +
        `• *পয়েন্ট:* ${points.toLocaleString()}\n` +
        `• *ফ্রি APK ক্রেডিট:* ${credits}\n` +
        `• *মোট বিল্ড:* ${counts?.total ?? 0} (সফল: ${counts?.completed ?? 0})`,
      `👤 *My Account*\n\n` +
        `• *Name:* ${escapeMd(user.first_name)}\n` +
        `• *Telegram ID:* \`${user.telegram_user_id}\`\n` +
        `• *Language:* ${lang.toUpperCase()}\n` +
        `• *Points:* ${points.toLocaleString()}\n` +
        `• *Free APK Credits:* ${credits}\n` +
        `• *Total Builds:* ${counts?.total ?? 0} (Completed: ${counts?.completed ?? 0})`
    ),
    {
      inline_keyboard: [
        [{ text: lang === 'bn' ? '🌐 Switch to English' : '🌐 বাংলায় পরিবর্তন করুন', callback_data: 'lang:toggle' }],
      ],
    }
  );
}

async function sendMyPoints(
  env: Env,
  tg: TelegramApiClient,
  chatId: number,
  user: UserRow,
  points: number,
  settings: Awaited<ReturnType<typeof getAppSettings>>
): Promise<void> {
  const lang = user.language_code;
  const { results: txs } = await env.DB
    .prepare('SELECT tx_type, amount, description, created_at FROM point_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 5')
    .bind(user.id)
    .all<{ tx_type: string; amount: number; description: string; created_at: string }>();

  const historyLines = txs.map((tx) => `• ${tx.amount >= 0 ? '+' : ''}${tx.amount} pts — ${escapeMd(tx.description)}`);

  await tg.sendMessage(
    chatId,
    t(
      lang,
      `💰 *আমার পয়েন্ট:* *${points.toLocaleString()}*\n(১টি APK বিল্ড = ${settings.buildCostPoints} পয়েন্ট)\n\n📜 *সাম্প্রতিক লেনদেন:*\n${historyLines.join('\n') || 'কোনো লেনদেন নেই'}`,
      `💰 *My Points:* *${points.toLocaleString()}*\n(1 APK Build = ${settings.buildCostPoints} pts)\n\n📜 *Recent Ledger:*\n${historyLines.join('\n') || 'No transactions yet'}`
    )
  );
}

async function sendFreeCredits(
  tg: TelegramApiClient,
  chatId: number,
  user: UserRow,
  credits: number,
  points: number,
  settings: Awaited<ReturnType<typeof getAppSettings>>
): Promise<void> {
  const lang = user.language_code;
  await tg.sendMessage(
    chatId,
    t(
      lang,
      `🎟️ *ফ্রি APK ক্রেডিট:* *${credits} টি*\n💰 *পয়েন্ট ব্যালেন্স:* ${points.toLocaleString()}\n\n` +
        `ℹ️ APK তৈরি করার সময় প্রথমে *ফ্রি ক্রেডিট* ব্যবহৃত হয়। ফ্রি ক্রেডিট না থাকলে ${settings.buildCostPoints} পয়েন্ট কাটা হয়। প্রতি ${settings.referralMilestoneInterval}টি সফল রেফারে +${settings.referralMilestoneCredits} ফ্রি ক্রেডিট পাবেন!`,
      `🎟️ *Free APK Credits:* *${credits}*\n💰 *Points:* ${points.toLocaleString()}\n\n` +
        `ℹ️ Free credits are always used first before deducting ${settings.buildCostPoints} points. Earn +${settings.referralMilestoneCredits} free credit every ${settings.referralMilestoneInterval} referrals!`
    )
  );
}

async function sendHelp(
  tg: TelegramApiClient,
  chatId: number,
  user: UserRow,
  settings: Awaited<ReturnType<typeof getAppSettings>>
): Promise<void> {
  const lang = user.language_code;
  await tg.sendMessage(
    chatId,
    t(
      lang,
      `🆘 *সাহায্য ও কমান্ডসমূহ:*\n\n` +
        `• /start — বট শুরু ও ওয়েলকাম গিফট\n` +
        `• /convert — নতুন Android APK তৈরি\n` +
        `• /history — বিল্ড ইতিহাস\n` +
        `• /status — সর্বশেষ বিল্ড স্ট্যাটাস\n` +
        `• /cancel — চলমান ফর্ম/কিউ বিল্ড বাতিল\n` +
        `• /profile — অ্যাকাউন্ট ও ব্যালেন্স\n` +
        `• /help — সহায়তা\n\n` +
        `🔐 *APK সাইনিং:* প্রতিটি APK নিরাপদ ${settings.signingMode === 'platform_managed' ? 'প্ল্যাটফর্ম-ম্যানেজড রিলিজ কী' : 'ইউজার সাইনিং কী'} দিয়ে সাইন করা হয়।\n` +
        `📞 সাপোর্ট: ${escapeMd(settings.supportContact)}`,
      `🆘 *Help & Commands:*\n\n` +
        `• /start — Start & welcome bonus\n` +
        `• /convert — Create a new Android APK\n` +
        `• /history — Build history\n` +
        `• /status — Latest build progress\n` +
        `• /cancel — Cancel form or queued build\n` +
        `• /profile — Account & balance\n` +
        `• /help — Help\n\n` +
        `🔐 *APK Signing:* Built & signed with ${settings.signingMode === 'platform_managed' ? 'platform-managed release key' : 'user-provided signing key'}.\n` +
        `📞 Support: ${escapeMd(settings.supportContact)}`
    )
  );
}

export async function signPayloadForBuildServer(secret: string, body: string): Promise<{ timestamp: string; signature: string }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmacSha256Hex(secret, `${timestamp}.${body}`);
  return { timestamp, signature };
}
