# Deployment & Operations Guide

## 1. Cloudflare Worker & D1 Setup
1. Install dependencies:
   ```bash
   cd cloudflare-worker && npm install
   ```
2. Create Cloudflare resources:
   ```bash
   npx wrangler d1 create mr_web_to_apk_db
   npx wrangler r2 bucket create mr-web-to-apk-private
   npx wrangler queues create mr-web-to-apk-builds
   npx wrangler queues create mr-web-to-apk-builds-dlq
   ```
3. Update `cloudflare-worker/wrangler.jsonc` with your `database_id` and `WORKER_PUBLIC_URL`.
4. Apply D1 migrations:
   ```bash
   npx wrangler d1 migrations apply mr_web_to_apk_db --remote
   ```
5. Set all required Worker secrets (never commit secrets):
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   npx wrangler secret put BUILD_SERVER_URL
   npx wrangler secret put BUILD_SERVER_SECRET
   npx wrangler secret put ADMIN_BOOTSTRAP_SECRET
   npx wrangler secret put ADMIN_JWT_SECRET
   npx wrangler secret put DOWNLOAD_SIGNING_SECRET
   ```
6. Deploy the Worker:
   ```bash
   npx wrangler deploy
   ```

## 2. Telegram Webhook Registration
Run `scripts/setup-webhook.sh` or call `POST /api/admin/telegram/setup-webhook` from the Admin Dashboard.
Remember: for Join & Earn verification (`getChatMember`), add your bot as an administrator in every configured Telegram channel/group.

## 3. Ubuntu 24.04 LTS Build Server Setup
1. Provision an Ubuntu 24.04 VPS (minimum 4 GB RAM, 2 vCPU, 40 GB SSD).
2. Run `sudo bash scripts/setup-build-server-ubuntu.sh`.
3. Generate the release signing keystore: `sudo bash scripts/generate-keystore.sh`.
4. Create `/etc/mr-web-to-apk/builder.env` from `build-server/.env.example`.
5. Start and monitor the systemd service:
   ```bash
   sudo systemctl start mr-web-to-apk-builder
   sudo journalctl -u mr-web-to-apk-builder -f
   ```

## 4. Admin Dashboard Deployment
Host `/admin-dashboard` on Cloudflare Pages (recommended) or any static HTTPS host, then enter your Worker URL and use **First-time Super Admin Setup** with `ADMIN_BOOTSTRAP_SECRET` to create your initial `super_admin` account (with optional TOTP 2FA).
