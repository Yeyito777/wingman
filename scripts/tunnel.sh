#!/usr/bin/env bash
# Public HTTPS URL for the local server (phones need HTTPS for motion, location and microphone).
# Uses a free Cloudflare quick tunnel: no account needed. The URL changes every run.
#   bun run tunnel            # tunnels http://localhost:${PORT:-3000}
# Alternatives: `npx localtunnel --port 3000`, or `ngrok http 3000` (needs an ngrok account).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3000}"
BIN=tools/cloudflared
if [[ ! -x "$BIN" ]]; then
  mkdir -p tools
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) ASSET=cloudflared-linux-amd64 ;;
    Linux-aarch64) ASSET=cloudflared-linux-arm64 ;;
    Darwin-*) echo "On macOS: brew install cloudflared, then: cloudflared tunnel --url http://localhost:$PORT"; exit 1 ;;
    *) echo "Unsupported platform; see https://github.com/cloudflare/cloudflared/releases"; exit 1 ;;
  esac
  echo "Downloading $ASSET into tools/ ..."
  curl -fsSL -o "$BIN.tmp" "https://github.com/cloudflare/cloudflared/releases/latest/download/$ASSET"
  chmod +x "$BIN.tmp" && mv "$BIN.tmp" "$BIN"
fi
echo "Tunnelling http://localhost:$PORT  (look for the https://*.trycloudflare.com URL below)"
exec "$BIN" tunnel --no-autoupdate --url "http://localhost:$PORT"
