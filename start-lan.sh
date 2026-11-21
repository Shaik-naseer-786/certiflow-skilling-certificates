#!/usr/bin/env sh
# Starts CertiFlow so a PHONE on the same Wi-Fi can open the QR codes (macOS / Linux).
# Finds this computer's LAN address, saves it as PUBLIC_URL in .env, then starts everything.
ip=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$ip" ] && { echo "No network address found. Connect to Wi-Fi first."; exit 1; }
touch .env
grep -v '^PUBLIC_URL=' .env > .env.tmp; echo "PUBLIC_URL=http://$ip:8080" >> .env.tmp; mv .env.tmp .env
echo "PUBLIC_URL set to http://$ip:8080"
docker compose up -d --build
echo "Open http://$ip:8080 (phone on the same Wi-Fi)"
