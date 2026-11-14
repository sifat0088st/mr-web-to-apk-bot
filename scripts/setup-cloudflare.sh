#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../cloudflare-worker"

echo "1. Installing Cloudflare Worker dependencies..."
npm install

echo "2. Creating D1 database, R2 private bucket, and Queues..."
npx wrangler d1 create mr_web_to_apk_db || true
npx wrangler r2 bucket create mr-web-to-apk-private || true
npx wrangler queues create mr-web-to-apk-builds || true
npx wrangler queues create mr-web-to-apk-builds-dlq || true

echo "IMPORTANT: Copy your D1 database_id from above into cloudflare-worker/wrangler.jsonc before applying remote migrations."
echo "Then run:"
echo "  npx wrangler d1 migrations apply mr_web_to_apk_db --remote"
echo "  npx wrangler secret put TELEGRAM_BOT_TOKEN"
echo "  npx wrangler secret put TELEGRAM_WEBHOOK_SECRET"
echo "  npx wrangler secret put BUILD_SERVER_URL"
echo "  npx wrangler secret put BUILD_SERVER_SECRET"
echo "  npx wrangler secret put ADMIN_BOOTSTRAP_SECRET"
echo "  npx wrangler deploy"
