#!/usr/bin/env bash
set -euo pipefail

: "${TELEGRAM_BOT_TOKEN:?Set TELEGRAM_BOT_TOKEN}"
: "${TELEGRAM_WEBHOOK_SECRET:?Set TELEGRAM_WEBHOOK_SECRET}"
: "${WORKER_PUBLIC_URL:?Set WORKER_PUBLIC_URL}"

WEBHOOK_URL="${WORKER_PUBLIC_URL%/}/telegram/webhook"

curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WEBHOOK_URL}\",
    \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\", \"callback_query\"],
    \"drop_pending_updates\": false
  }"
echo ""
echo "Webhook registered at: ${WEBHOOK_URL}"
