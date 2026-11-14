#!/usr/bin/env bash
set -euo pipefail

KEY_DIR="${1:-/etc/mr-web-to-apk/keys}"
KEYSTORE_FILE="${KEY_DIR}/platform-release.p12"
ALIAS="${APK_KEYSTORE_ALIAS:-mrwebtoapk}"

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

if [ -f "$KEYSTORE_FILE" ]; then
  echo "Keystore already exists at $KEYSTORE_FILE"
  exit 0
fi

read -rsp "Enter strong keystore password: " KS_PASS
echo ""

keytool -genkeypair -v \
  -keystore "$KEYSTORE_FILE" \
  -storetype PKCS12 \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10950 \
  -storepass "$KS_PASS" \
  -keypass "$KS_PASS" \
  -dname "CN=MR WEB TO APK BOT, OU=AppBuilder, O=MRWebToApk, L=Dhaka, C=BD"

chmod 600 "$KEYSTORE_FILE"
echo "Generated PKCS12 release keystore at $KEYSTORE_FILE"
