import type { AppFormDraft, LanguageCode } from './types.ts';

export function t(lang: LanguageCode, bn: string, en: string): string {
  return lang === 'bn' ? bn : en;
}

export function buildWelcomeNewUserMessage(lang: LanguageCode, firstName: string): string {
  if (lang === 'en') {
    return (
      `👋 *Welcome to MR WEB TO APK BOT, ${escapeMd(firstName)}!*\n\n` +
      `🎁 *One-Time Welcome Gift Credited:*\n` +
      `• *1,000 Points*\n` +
      `• *1 Free APK Build Credit*\n\n` +
      `✨ *What you can do here:*\n` +
      `• 📱 Convert HTML, CSS, JS, JSON & static web assets into a signed Android APK\n` +
      `• ⭐ Earn points via Join & Earn & Refer & Earn\n` +
      `• 👥 Refer friends (250 pts/referral + 2,000 pts & 1 Free Credit every 10 referrals)\n` +
      `• 📢 Join Telegram channels & groups (500 pts per verified channel)\n` +
      `• 🎟️ Build APKs using Free Credits first, or 1,000 points per build\n\n` +
      `ℹ️ _Note: Only static WebView websites run inside the APK. PHP/MySQL backends must be hosted on an external API server._\n\n` +
      `আপনি কি আপনার HTML, CSS, JavaScript এবং JSON ফাইল দিয়ে একটি Android Application তৈরি করতে চান?`
    );
  }

  return (
    `👋 *MR WEB TO APK BOT-এ আপনাকে স্বাগতম, ${escapeMd(firstName)}!*\n\n` +
    `🎁 *স্বাগতম উপহার (শুধুমাত্র নতুন ইউজারদের জন্য):*\n` +
    `• *১,০০০ পয়েন্ট (1,000 Points)*\n` +
    `• *১টি ফ্রি APK বিল্ড ক্রেডিট (1 Free APK Credit)*\n\n` +
    `✨ *আমাদের প্রধান সুবিধাসমূহ:*\n` +
    `• 📱 *Android APK তৈরি করুন:* আপনার HTML, CSS, JavaScript এবং JSON ওয়েবসাইট থেকে সরাসরি Signed Android APK তৈরি করুন।\n` +
    `• ⭐ *পয়েন্ট অর্জন করুন:* সহজ টাস্ক ও রেফারেলের মাধ্যমে পয়েন্ট সংগ্রহ করুন।\n` +
    `• 👥 *বন্ধুদের রেফার করুন:* প্রতিটি সফল রেফারে ২৫০ পয়েন্ট এবং প্রতি ১০ রেফারে ২,০০০ বোনাস পয়েন্ট + ১টি ফ্রি APK ক্রেডিট।\n` +
    `• 📢 *Telegram চ্যানেল ও গ্রুপে জয়েন করুন:* প্রতিটি ভেরিফায়েড চ্যানেল/গ্রুপে জয়েন করে ৫০০ পয়েন্ট আয় করুন।\n` +
    `• 🎟️ *ফ্রি APK ক্রেডিট:* প্রথমে ফ্রি ক্রেডিট দিয়ে, অথবা ১,০০০ পয়েন্ট খরচ করে APK বিল্ড করুন।\n\n` +
    `ℹ️ _গুরুত্বপূর্ণ তথ্য: WebView অ্যাপে শুধুমাত্র স্ট্যাটিক ওয়েবসাইট (HTML/CSS/JS/JSON) চলে। PHP/MySQL ব্যাকএন্ড সরাসরি APK-তে কাজ করবে না—এর জন্য এক্সটার্নাল API সার্ভার ব্যবহার করতে হবে।_\n\n` +
    `❓ *আপনি কি আপনার HTML, CSS, JavaScript এবং JSON ফাইল দিয়ে একটি Android Application তৈরি করতে চান?*`
  );
}

export function buildWelcomeExistingUserMessage(
  lang: LanguageCode,
  firstName: string,
  points: number,
  credits: number
): string {
  if (lang === 'en') {
    return (
      `👋 *Welcome back, ${escapeMd(firstName)}!*\n\n` +
      `💰 *Current Points:* ${points.toLocaleString()}\n` +
      `🎟️ *Free APK Credits:* ${credits}\n\n` +
      `Use the menu below or tap *YES! CREATE MY APP* to start a new Android APK build.`
    );
  }
  return (
    `👋 *আবারও স্বাগতম, ${escapeMd(firstName)}!*\n\n` +
    `💰 *বর্তমান পয়েন্ট:* ${points.toLocaleString()} পয়েন্ট\n` +
    `🎟️ *ফ্রি APK ক্রেডিট:* ${credits} টি\n\n` +
    `নিচের বাটন থেকে নতুন অ্যাপ তৈরি করুন অথবা আপনার অ্যাকাউন্ট পরিচালনা করুন।\n\n` +
    `❓ *আপনি কি আপনার HTML, CSS, JavaScript এবং JSON ফাইল দিয়ে একটি Android Application তৈরি করতে চান?*`
  );
}

export function buildFormPrompt(lang: LanguageCode, step: AppFormDraft['step']): string {
  const prompts: Record<AppFormDraft['step'], { bn: string; en: string }> = {
    app_name: {
      bn: '📱 *ধাপ ১/১৪ — অ্যাপের নাম (App Name):*\nআপনার Android অ্যাপের নাম লিখুন (২–৩০ অক্ষর)। যেমন: `My Shop App`',
      en: '📱 *Step 1/14 — App Name:*\nEnter your Android application name (2–30 characters), e.g., `My Shop App`',
    },
    package_name: {
      bn: '📦 *ধাপ ২/১৪ — প্যাকেজ নাম (Package Name):*\nসঠিক Android প্যাকেজ নাম দিন (ছোট হাতের অক্ষর, অন্তত ২টি ডট-সেপারেটেড অংশ)। যেমন: `com.mycompany.shopapp`',
      en: '📦 *Step 2/14 — Package Name:*\nEnter a valid lowercase Android package name (e.g., `com.mycompany.shopapp`)',
    },
    version_name: {
      bn: '🏷️ *ধাপ ৩/১৪ — ভার্সন নাম (Version Name):*\nঅ্যাপের Version Name লিখুন (যেমন: `1.0.0`)।',
      en: '🏷️ *Step 3/14 — Version Name:*\nEnter the Version Name (e.g., `1.0.0`).',
    },
    version_code: {
      bn: '🔢 *ধাপ ৪/১৪ — ভার্সন কোড (Version Code):*\nএকটি ধনাত্মক পূর্ণসংখ্যা লিখুন (যেমন: `1`)।',
      en: '🔢 *Step 4/14 — Version Code:*\nEnter a positive integer Version Code (e.g., `1`).',
    },
    app_description: {
      bn: '📝 *ধাপ ৫/১৪ — অ্যাপের বিবরণ (App Description):*\nঅ্যাপ সম্পর্কে সংক্ষিপ্ত বিবরণ লিখুন (সর্বোচ্চ ৩০০ অক্ষর)।',
      en: '📝 *Step 5/14 — App Description:*\nEnter a brief description of your app (max 300 chars).',
    },
    app_logo: {
      bn: '🖼️ *ধাপ ৬/১৪ — অ্যাপ লোগো (App Logo):*\nআপনার অ্যাপের লোগো ছবি (PNG, JPG বা WEBP) পাঠান।',
      en: '🖼️ *Step 6/14 — App Logo:*\nSend your App Logo image (PNG, JPG, or WEBP).',
    },
    splash_screen: {
      bn: '✨ *ধাপ ৭/১৪ — স্প্ল্যাশ স্ক্রিন (Optional Splash Screen):*\nচাইলে একটি Splash Screen ছবি পাঠান, অথবা *Skip Splash* বাটনে চাপুন।',
      en: '✨ *Step 7/14 — Optional Splash Screen:*\nSend a Splash Screen image, or tap *Skip Splash*.',
    },
    orientation: {
      bn: '🔄 *ধাপ ৮/১৪ — স্ক্রিন ওরিয়েন্টেশন (Screen Orientation):*\nনিচ থেকে একটি নির্বাচন করুন:',
      en: '🔄 *Step 8/14 — Screen Orientation:*\nChoose one below:',
    },
    status_bar_color: {
      bn: '🎨 *ধাপ ৯/১৪ — স্ট্যাটাস বার কালার (Status Bar Color):*\nHex কালার কোড লিখুন (যেমন: `#10B981`)।',
      en: '🎨 *Step 9/14 — Status Bar Color:*\nEnter a 6-digit hex color code (e.g., `#10B981`).',
    },
    nav_bar_color: {
      bn: '🎨 *ধাপ ১০/১৪ — নেভিগেশন বার কালার (Navigation Bar Color):*\nHex কালার কোড লিখুন (যেমন: `#111827`)।',
      en: '🎨 *Step 10/14 — Navigation Bar Color:*\nEnter a 6-digit hex color code (e.g., `#111827`).',
    },
    app_theme: {
      bn: '🌗 *ধাপ ১১/১৪ — অ্যাপ থিম (App Theme):*\nথিম নির্বাচন করুন:',
      en: '🌗 *Step 11/14 — App Theme:*\nSelect app theme:',
    },
    permissions: {
      bn: '🔐 *ধাপ ১২/১৪ — Android পারমিশন:*\nপ্রয়োজনীয় পারমিশন কমা দিয়ে লিখুন অথবা বাটন চাপুন।\nঅনুমোদিত: `CAMERA`, `RECORD_AUDIO`, `ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS`, `VIBRATE` (অথবা Default: `INTERNET, ACCESS_NETWORK_STATE`)',
      en: '🔐 *Step 12/14 — Android Permissions:*\nReply with comma-separated permissions or use Default (`INTERNET, ACCESS_NETWORK_STATE`).\nAllowed: `CAMERA`, `RECORD_AUDIO`, `ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS`, `VIBRATE`',
    },
    start_page: {
      bn: '🌐 *ধাপ ১৩/১৪ — ওয়েবসাইট স্টার্ট পেজ (Start Page):*\nZIP-এর ভেতরের মূল HTML ফাইলের নাম লিখুন (সাধারণত `index.html`)।',
      en: '🌐 *Step 13/14 — Website Start Page:*\nEnter the entry HTML file inside your ZIP (usually `index.html`).',
    },
    external_links: {
      bn: '🔗 *ধাপ ১৪/১৪ — এক্সটার্নাল লিংক সেটিংস (Optional External Links):*\nবাইরের ওয়েবসাইট লিংক কীভাবে খুলবে তা নির্বাচন করুন:',
      en: '🔗 *Step 14/14 — External Link Settings:*\nChoose how external links behave:',
    },
    review: {
      bn: '📋 *তথ্য যাচাই করুন:*\nসব ঠিক থাকলে *Confirm & Upload ZIP* চাপুন, অথবা যেকোনো অংশ এডিট করুন।',
      en: '📋 *Review Application Details:*\nTap *Confirm & Upload ZIP* if accurate, or edit any field below.',
    },
    awaiting_zip: {
      bn: '📦 *এখন আপনার ওয়েবসাইট ZIP ফাইল আপলোড করুন:*\n\n✅ অনুমোদিত: HTML, CSS, JavaScript, JSON, PNG, JPG, WEBP, SVG, ICO, WOFF/WOFF2, TTF/OTF\n✅ রুট ফোল্ডারে অবশ্যই `index.html` থাকতে হবে।\n❌ নিষিদ্ধ: PHP, SQL, Python, EXE/SH স্ক্রিপ্ট, সিমলিংক, নেস্টেড ZIP বা ZIP বোমা।\nℹ️ _মনে রাখবেন: PHP/MySQL সার্ভার-সাইড কোড স্ট্যাটিক WebView-তে কাজ করবে না—এর জন্য এক্সটার্নাল API ব্যবহার করুন।_',
      en: '📦 *Now upload your Website `.zip` file:*\n\n✅ Allowed: HTML, CSS, JS, JSON, PNG, JPG, WEBP, SVG, ICO, WOFF/WOFF2, TTF/OTF\n✅ Valid `index.html` required at ZIP root.\n❌ Rejected: PHP, SQL, Python, scripts/executables, symlinks, nested archives, ZIP bombs.\nℹ️ _Note: PHP/MySQL backend features will not run inside a static WebView unless connected to an external API._',
    },
  };
  return prompts[step][lang];
}

export function buildDraftSummary(lang: LanguageCode, draft: AppFormDraft): string {
  const perms = (draft.permissions ?? ['INTERNET', 'ACCESS_NETWORK_STATE']).join(', ');
  const extDomains = draft.externalLinksDomains?.length ? ` (${draft.externalLinksDomains.join(', ')})` : '';
  if (lang === 'en') {
    return (
      `📋 *Application Summary*\n\n` +
      `• *App Name:* ${escapeMd(draft.appName ?? '-')}\n` +
      `• *Package Name:* \`${escapeMd(draft.packageName ?? '-')}\`\n` +
      `• *Version:* ${escapeMd(draft.versionName ?? '1.0.0')} (${draft.versionCode ?? 1})\n` +
      `• *Description:* ${escapeMd(draft.appDescription ?? '-')}\n` +
      `• *Logo:* ${draft.logoR2Key ? 'Uploaded ✅' : 'Not uploaded'}\n` +
      `• *Splash Screen:* ${draft.splashR2Key ? 'Uploaded ✅' : 'Skipped'}\n` +
      `• *Orientation:* ${draft.orientation ?? 'portrait'}\n` +
      `• *Status Bar:* \`${draft.statusBarColor ?? '#10B981'}\`\n` +
      `• *Nav Bar:* \`${draft.navBarColor ?? '#111827'}\`\n` +
      `• *Theme:* ${draft.appTheme ?? 'system'}\n` +
      `• *Permissions:* ${escapeMd(perms)}\n` +
      `• *Start Page:* \`${escapeMd(draft.startPage ?? 'index.html')}\`\n` +
      `• *External Links:* ${draft.externalLinksMode ?? 'in_app'}${escapeMd(extDomains)}`
    );
  }

  return (
    `📋 *অ্যাপ্লিকেশন তথ্যের সারাংশ*\n\n` +
    `• *অ্যাপের নাম:* ${escapeMd(draft.appName ?? '-')}\n` +
    `• *প্যাকেজ নাম:* \`${escapeMd(draft.packageName ?? '-')}\`\n` +
    `• *ভার্সন:* ${escapeMd(draft.versionName ?? '1.0.0')} (Code: ${draft.versionCode ?? 1})\n` +
    `• *বিবরণ:* ${escapeMd(draft.appDescription ?? '-')}\n` +
    `• *অ্যাপ লোগো:* ${draft.logoR2Key ? 'আপলোড সম্পন্ন ✅' : 'নেই'}\n` +
    `• *স্প্ল্যাশ স্ক্রিন:* ${draft.splashR2Key ? 'আপলোড সম্পন্ন ✅' : 'স্কিপ করা হয়েছে'}\n` +
    `• *ওরিয়েন্টেশন:* ${draft.orientation ?? 'portrait'}\n` +
    `• *স্ট্যাটাস বার কালার:* \`${draft.statusBarColor ?? '#10B981'}\`\n` +
    `• *নেভিগেশন বার কালার:* \`${draft.navBarColor ?? '#111827'}\`\n` +
    `• *অ্যাপ থিম:* ${draft.appTheme ?? 'system'}\n` +
    `• *পারমিশন:* ${escapeMd(perms)}\n` +
    `• *স্টার্ট পেজ:* \`${escapeMd(draft.startPage ?? 'index.html')}\`\n` +
    `• *এক্সটার্নাল লিংক:* ${draft.externalLinksMode ?? 'in_app'}${escapeMd(extDomains)}`
  );
}

export function renderProgressMessage(
  lang: LanguageCode,
  jobCode: string,
  appName: string,
  stage: string,
  percent: number,
  extraNote?: string
): string {
  const filledBlocks = Math.max(0, Math.min(10, Math.round(percent / 10)));
  const bar = '🟩'.repeat(filledBlocks) + '⬜'.repeat(10 - filledBlocks);

  if (lang === 'en') {
    return (
      `⚙️ *APK Build Progress*\n\n` +
      `📱 *App:* ${escapeMd(appName)}\n` +
      `🆔 *Job ID:* \`${jobCode}\`\n` +
      `📍 *Stage:* ${escapeMd(stage)} (${percent}%)\n` +
      `${bar}\n` +
      (extraNote ? `\nℹ️ ${escapeMd(extraNote)}` : '')
    );
  }
  return (
    `⚙️ *APK বিল্ড লাইভ স্ট্যাটাস*\n\n` +
    `📱 *অ্যাপ:* ${escapeMd(appName)}\n` +
    `🆔 *জব আইডি:* \`${jobCode}\`\n` +
    `📍 *ধাপ:* ${escapeMd(stage)} (${percent}%)\n` +
    `${bar}\n` +
    (extraNote ? `\nℹ️ ${escapeMd(extraNote)}` : '')
  );
}

export function escapeMd(input: string): string {
  return input.replace(/([_*`\[])/g, '\\$1');
}
