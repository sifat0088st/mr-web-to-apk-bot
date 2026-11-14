# MR WEB TO APK BOT — 24/7 Cloud Architecture

## High-Level Topology

```
Telegram User
  │
  ▼ (HTTPS Webhook + X-Telegram-Bot-Api-Secret-Token)
Cloudflare Worker (Stateless Edge, 24/7)
  ├── Cloudflare D1 (22 tables: users, wallets, ledgers, projects, build_jobs, audit_logs...)
  ├── Cloudflare Durable Object (RateLimiterDO sliding-window rate limiting)
  ├── Cloudflare R2 Private Bucket (validated ZIPs, logos, splash screens, signed APKs)
  ├── Cloudflare Queue (`mr-web-to-apk-builds` + DLQ)
  └── Cloudflare Cron Trigger (`*/5 * * * *` stuck-job recovery & cleanup)
  │
  ▼ (HMAC-SHA256 Signed HTTP Dispatch)
External Ubuntu 24.04 LTS Build Server
  ├── Node.js Build Agent (`build-server/src/server.ts`)
  ├── Isolated Docker Container (`--network=none`, `--cpus=2`, `--memory=2g`, `--pids-limit=256`)
  ├── JDK 17 + Android SDK 34 + Gradle 8.9 + `android-webview-template`
  └── `zipalign` + `apksigner sign` + `apksigner verify`
  │
  ▼ (Signed APK Upload → Private R2 → Telegram `sendDocument` + 24h Signed Link)
Telegram User Receives Signed APK
```

## Why Cloudflare Workers + External Linux Build Server?
Cloudflare Workers run in V8 isolates with millisecond cold starts and 24/7 global uptime—ideal for Telegram webhooks, D1 transactions, rewards accounting, ZIP security scanning, and Admin APIs. However, Cloudflare Workers cannot execute JDK 17, Android SDK, or Gradle compilation. Offloading compilation to an isolated Docker-backed Ubuntu 24.04 VPS via Cloudflare Queues guarantees:
1. Instant Telegram bot responsiveness regardless of compilation load.
2. Zero lost jobs if the build server restarts or goes offline (Cloudflare Queue retains & retries jobs automatically).
3. Full OS/network isolation around user-uploaded web assets during compilation.
