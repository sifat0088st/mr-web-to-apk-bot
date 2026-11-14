#!/usr/bin/env bash
set -euo pipefail

echo "Installing Docker, Node.js 22 LTS, and OpenJDK 17 on Ubuntu 24.04 LTS..."
sudo apt-get update
sudo apt-get install -y curl ca-certificates gnupg openjdk-17-jdk zipalign

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo useradd -r -m -s /usr/sbin/nologin mrbuilder || true
sudo usermod -aG docker mrbuilder

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Application directories
sudo mkdir -p /opt/mr-web-to-apk /var/lib/mr-web-to-apk/workspaces /etc/mr-web-to-apk/keys
sudo cp -r ../android-webview-template /opt/mr-web-to-apk/
sudo cp -r ../build-server /opt/mr-web-to-apk/

cd /opt/mr-web-to-apk/build-server
sudo npm install
sudo npm run build

# Build isolated Android builder Docker image
sudo docker build -t mr-web-to-apk/android-builder:latest -f Dockerfile /opt/mr-web-to-apk

sudo chown -R mrbuilder:mrbuilder /opt/mr-web-to-apk /var/lib/mr-web-to-apk
sudo cp systemd/mr-web-to-apk-builder.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable mr-web-to-apk-builder

echo "Setup complete! Configure /etc/mr-web-to-apk/builder.env, run scripts/generate-keystore.sh, then start:"
echo "  sudo systemctl start mr-web-to-apk-builder"
