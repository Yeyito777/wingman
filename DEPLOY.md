# Deploying Wingman to a Vultr VPS (with a GoDaddy domain)

One small VPS, Docker, and Caddy for automatic HTTPS. Phones need HTTPS for motion, location and the microphone.
Expect about 20 minutes.

## 1. Create the server (Vultr)

1. Sign up at vultr.com (check the MLH/Hack the Valley sponsor page for credits).
2. **Deploy New Server** → *Cloud Compute (Shared CPU)* → location **Toronto** → image **Ubuntu 24.04 LTS x64** →
   the smallest plan (1 vCPU / 1 GB is plenty) → add your **SSH key** → hostname `wingman` → Deploy.
3. Copy the server's **public IPv4**.

## 2. Point the domain at it (GoDaddy)

1. Claim or buy the domain (MLH's GoDaddy offer).
2. GoDaddy → *My Products* → domain → **DNS** → *Add record*:
   - Type **A**, Name **@**, Value **<VPS IPv4>**, TTL 600
   - (optional) Type **CNAME**, Name **www**, Value **@**
3. Wait for `dig +short yourdomain.com` to return the IP (usually under 10 minutes).

## 3. Install Docker and Caddy on the VPS

```bash
ssh root@<VPS_IP>
apt-get update && apt-get -y upgrade
curl -fsSL https://get.docker.com | sh
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 4. Run Wingman

```bash
git clone https://github.com/<you>/wingman.git /opt/wingman
cd /opt/wingman
cat > .env <<'EOF'
PUBLIC_URL=https://yourdomain.com
GEMINI_API_KEY=...
# OPENAI_API_KEY=...
# TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=+1...
EOF
chmod 600 .env
docker build -t wingman .
docker run -d --name wingman --restart unless-stopped --env-file .env -p 127.0.0.1:3000:3000 wingman
curl -s localhost:3000/api/health      # {"ok":true,"scorer":"gemini (...)",...}
```

## 5. HTTPS reverse proxy (Caddy gets the certificate automatically and proxies WebSockets)

```bash
cat > /etc/caddy/Caddyfile <<'EOF'
yourdomain.com, www.yourdomain.com {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy
```

Open `https://yourdomain.com`. Done.

## Updating

```bash
cd /opt/wingman && git pull && docker build -t wingman . && docker rm -f wingman && \
docker run -d --name wingman --restart unless-stopped --env-file .env -p 127.0.0.1:3000:3000 wingman
```

Sessions are in memory, so redeploying ends any active nights (by design: nothing is persisted).

## Without Docker (alternative)

```bash
curl -fsSL https://bun.sh/install | bash && export PATH="$HOME/.bun/bin:$PATH"
cd /opt/wingman && bun install --production
cat > /etc/systemd/system/wingman.service <<'EOF'
[Unit]
Description=Wingman
After=network.target
[Service]
WorkingDirectory=/opt/wingman
EnvironmentFile=/opt/wingman/.env
Environment=NODE_ENV=production PORT=3000
ExecStart=/root/.bun/bin/bun src/server/index.ts
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now wingman
```

## Notes

- The container was built and smoke-tested locally with podman (health check and page routes OK). The steps above
  haven't been run on a real Vultr box yet.
- Twilio trial accounts can only text **verified** numbers: verify the emergency-contact number in the Twilio console.
- `/api/health` reports which AI engine and notifier are active. It's handy to show judges it's the real thing.
