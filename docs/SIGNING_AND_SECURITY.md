# Signing Identity, Security Controls & Troubleshooting

## APK Signing Identity
By default (`signing_mode = platform_managed`), APKs are signed on the Ubuntu Build Server using a dedicated PKCS12 release keystore stored at `/etc/mr-web-to-apk/keys/platform-release.p12` (`chmod 600`, owned by `mrbuilder`, never exposed to Cloudflare Workers or users). Every generated APK is verified via `apksigner verify --verbose --print-certs` and its certificate SHA-256 fingerprint is stored in `generated_apks.signing_cert_sha256`.

If you configure `signing_mode = user_provided`, you can extend `projects` to accept an encrypted user keystore in private storage; never store plaintext keystore passwords in D1.

## Security Guarantees
- **Idempotent Accounting**: Every welcome gift (`welcome_points:<user_id>`), build charge (`build_charge:<job_code>`), refund (`build_refund:<job_code>`), referral reward, milestone, and Join & Earn claim uses unique database constraints and atomic conditional updates.
- **ZIP Security Scanner**: Inspects Central Directory, Unix symlink bits (`0xA000`), path traversal (`..`, `/`, `\`), nested archives, executable/backend extensions (`.php`, `.sql`, `.py`, `.sh`, `.exe`, `.so`, `.wasm`), magic bytes (`\x7fELF`, `PK\x03\x04`, `SQLite format 3`), and streaming decompression byte limits (ZIP bomb protection)—without falsely flagging `"php"` or `"sql"` inside `.js` or `.json` text strings.
- **Container Isolation**: User website files are never executed on the Worker or host OS; Gradle compiles inside `docker run --network=none --cpus=2 --memory=2g --pids-limit=256`.

## Troubleshooting
- **Build stays at 35% ("Waiting for build server")**: Check `sudo systemctl status mr-web-to-apk-builder` and verify `BUILD_SERVER_URL` & `BUILD_SERVER_SECRET` match between Worker and `/etc/mr-web-to-apk/builder.env`. The Cloudflare Queue and 5-minute Cron will automatically resume queued jobs once the build server comes online.
- **Join & Earn verification fails**: Ensure the bot is added as an Admin inside the target Telegram channel/group so `getChatMember` succeeds.
- **Webhook 401 errors**: Re-run `scripts/setup-webhook.sh` so Telegram sends the exact `X-Telegram-Bot-Api-Secret-Token` configured in `TELEGRAM_WEBHOOK_SECRET`.
