# Troubleshooting Guide — MR WEB TO APK BOT

## 1. Build Stuck at 35% ("Waiting in queue")
- **Cause**: External Ubuntu Build Server is offline, restarting, or `BUILD_SERVER_URL` / `BUILD_SERVER_SECRET` mismatch.
- **Resolution**:
  1. Check service status on VPS: `sudo systemctl status mr-web-to-apk-builder`
  2. Inspect logs: `sudo journalctl -u mr-web-to-apk-builder -n 100`
  3. Confirm `BUILD_SERVER_SECRET` matches on both Cloudflare Worker (`wrangler secret put BUILD_SERVER_SECRET`) and `/etc/mr-web-to-apk/builder.env`.
  4. Cloudflare Queue + the 5-minute Cron trigger automatically resume queued builds once the build agent returns online.

## 2. Telegram Webhook Returns 401
- **Cause**: Telegram is not sending the matching `X-Telegram-Bot-Api-Secret-Token`.
- **Resolution**: Re-run `scripts/setup-webhook.sh` or use the **Register Telegram Webhook** button in the Admin Dashboard Settings tab.

## 3. Join & Earn Fails to Verify Membership
- **Cause**: Telegram `getChatMember` requires the bot to be an Administrator inside private/public channels or groups.
- **Resolution**: Add your bot as an Admin inside the target Telegram channel/group, then retry pressing **Verify Membership**.

## 4. Docker Gradle Compilation Fails
- **Cause**: Missing Docker image `mr-web-to-apk/android-builder:latest`, insufficient RAM (< 2 GB), or invalid `package_name`.
- **Resolution**: Rebuild the Docker image (`sudo docker build -t mr-web-to-apk/android-builder:latest -f build-server/Dockerfile .`) and confirm `mrbuilder` user is in the `docker` group.
