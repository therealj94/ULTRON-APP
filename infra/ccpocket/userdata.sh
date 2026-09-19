#!/bin/bash
# Bootstrap CC Pocket Bridge. No secrets in this file.
set -euxo pipefail
exec > >(tee /var/log/ccpocket-bootstrap.log) 2>&1

dnf install -y git tar unzip openssl
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
curl -fsSL https://tailscale.com/install.sh | sh
systemctl enable --now tailscaled

npm install -g @anthropic-ai/claude-code @ccpocket/bridge

install -d -o ec2-user -g ec2-user /home/ec2-user/ultron /home/ec2-user/.ccpocket /home/ec2-user/.claude /home/ec2-user/.codex /home/ec2-user/.local/bin
sudo -u ec2-user git clone --depth 1 https://github.com/therealj94/ULTRON-APP.git /home/ec2-user/ultron/ULTRON-APP

sudo -u ec2-user bash -lc 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' || true

KEY=$(openssl rand -hex 24)
umask 077
printf '%s' "$KEY" > /home/ec2-user/.ccpocket/api-key
printf 'BRIDGE_API_KEY=%s\n' "$KEY" > /home/ec2-user/.ccpocket/bridge.env
chown -R ec2-user:ec2-user /home/ec2-user/.ccpocket
chmod 600 /home/ec2-user/.ccpocket/api-key /home/ec2-user/.ccpocket/bridge.env

aws ssm put-parameter \
  --name /ultron/ccpocket/bridge-api-key \
  --type SecureString \
  --value "$KEY" \
  --overwrite \
  --region us-east-1

cat > /home/ec2-user/.claude/settings.json <<'JSON'
{
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_REGION": "us-east-1"
  }
}
JSON
chown ec2-user:ec2-user /home/ec2-user/.claude/settings.json

cat > /home/ec2-user/.codex/config.toml <<'TOML'
model = "openai.gpt-5.6-sol"
model_provider = "amazon-bedrock"

[model_providers.amazon-bedrock]
name = "Amazon Bedrock"

[model_providers.amazon-bedrock.aws]
region = "us-east-1"
TOML
chown ec2-user:ec2-user /home/ec2-user/.codex/config.toml

cat > /etc/systemd/system/ccpocket-bridge.service <<'UNIT'
[Unit]
Description=CC Pocket Bridge (Claude + Codex)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ec2-user
Group=ec2-user
WorkingDirectory=/home/ec2-user/ultron/ULTRON-APP
Environment=HOME=/home/ec2-user
Environment=CLAUDE_CODE_USE_BEDROCK=1
Environment=AWS_REGION=us-east-1
Environment=AWS_DEFAULT_REGION=us-east-1
Environment=BRIDGE_PORT=8765
Environment=BRIDGE_HOST=0.0.0.0
Environment=BRIDGE_DISABLE_MDNS=1
Environment=BRIDGE_ALLOWED_DIRS=/home/ec2-user/ultron
Environment=PATH=/home/ec2-user/.local/bin:/usr/local/bin:/usr/bin
EnvironmentFile=/home/ec2-user/.ccpocket/bridge.env
ExecStart=/usr/bin/npx --yes @ccpocket/bridge@latest
Restart=always
RestartSec=4

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now ccpocket-bridge
echo bootstrap-ok
