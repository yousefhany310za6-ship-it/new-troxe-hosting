#!/usr/bin/env bash
# ============================================================
# Troxe Hosting — One-shot Production Deploy
# ============================================================
# Usage: sudo ./deploy.sh api.troxe.example.com troxe.example.com
#        (run as root on a fresh Ubuntu 22.04/24.04 VPS)
# ============================================================
set -euo pipefail

API_DOMAIN="${1:-}"
ROOT_DOMAIN="${2:-}"
if [[ -z "$API_DOMAIN" || -z "$ROOT_DOMAIN" ]]; then
  echo "Usage: $0 <api-subdomain> <root-domain>"
  echo "Example: $0 api.troxe.dev troxe.dev"
  exit 1
fi

# Derive subdomain for Caddyfile substitution
API_SUB="${API_DOMAIN%%.*}"

echo "🚀 Deploying Troxe Hosting"
echo "   API:     https://$API_DOMAIN"
echo "   Frontend: https://$ROOT_DOMAIN"
echo

# ---------------------------------------------------------
# 0. Pre-flight checks
# ---------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  echo "❌ Must run as root (sudo)."
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "📦 Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version &>/dev/null; then
  echo "📦 Installing Docker Compose plugin..."
  apt-get update && apt-get install -y docker-compose-plugin
fi

# ---------------------------------------------------------
# 1. Clone / update repo
# ---------------------------------------------------------
REPO_DIR="/opt/troxe-hosting"
REPO_URL="https://github.com/yousefhany310za6-ship-it/new-troxe-hosting.git"

if [[ -d "$REPO_DIR/.git" ]]; then
  echo "📥 Updating existing repo..."
  cd "$REPO_DIR"
  git fetch origin
  git reset --hard origin/main
else
  echo "📥 Cloning repo..."
  git clone "$REPO_URL" "$REPO_DIR"
  cd "$REPO_DIR"
fi

# ---------------------------------------------------------
# 2. Prepare .env.prod (generate secrets if missing)
# ---------------------------------------------------------
ENV_FILE="$REPO_DIR/.env.prod"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "🔐 Generating .env.prod with random secrets..."
  cp "$REPO_DIR/.env.prod.template" "$ENV_FILE"

  # Generate secrets
  POSTGRES_PWD=$(openssl rand -base64 32 | tr -d '=\n')
  JWT_ACCESS=$(openssl rand -base64 48 | tr -d '=\n')
  JWT_REFRESH=$(openssl rand -base64 48 | tr -d '=\n')
  ENV_ENC_KEY=$(openssl rand -hex 32)

  # Substitute into .env.prod
  sed -i "s|DOMAIN=.*|DOMAIN=$ROOT_DOMAIN|" "$ENV_FILE"
  sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PWD|" "$ENV_FILE"
  sed -i "s|JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$JWT_ACCESS|" "$ENV_FILE"
  sed -i "s|JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$JWT_REFRESH|" "$ENV_FILE"
  sed -i "s|ENV_ENCRYPTION_KEY=.*|ENV_ENCRYPTION_KEY=$ENV_ENC_KEY|" "$ENV_FILE"

  echo "✅ Secrets generated and saved to $ENV_FILE"
  echo "   (backup this file!)"
else
  echo "📄 Using existing $ENV_FILE"
  # Ensure DOMAIN is correct
  sed -i "s|^DOMAIN=.*|DOMAIN=$ROOT_DOMAIN|" "$ENV_FILE"
fi

# Load env for later steps
set -a
source "$ENV_FILE"
set +a

# ---------------------------------------------------------
# 3. Prepare Caddyfile (substitute domain)
# ---------------------------------------------------------
CADDYFILE="$REPO_DIR/Caddyfile"
sed -i "s/{DOMAIN}/$ROOT_DOMAIN/g" "$CADDYFILE"
sed -i "s/admin@\${DOMAIN}/admin@$ROOT_DOMAIN/g" "$CADDYFILE"

# ---------------------------------------------------------
# 4. Build frontend (static export) for Caddy to serve
# ---------------------------------------------------------
echo "🏗 Building frontend..."
cd "$REPO_DIR"
# Use node:22 to build (matches backend Dockerfile)
docker run --rm -v "$PWD:/app" -w /app node:22-bookworm-slim \
  sh -c "npm ci && npm run build"

# Copy built assets to where Caddy expects them
mkdir -p /var/www/html
rm -rf /var/www/html/*
cp -r dist/* /var/www/html/

# ---------------------------------------------------------
# 5. Get docker socket GID for API user mapping
# ---------------------------------------------------------
SOCK_GID=$(stat -c %g /var/run/docker.sock)
echo "🔧 Docker socket GID: $SOCK_GID"

# ---------------------------------------------------------
# 6. Build API image (multi-stage, non-root)
# ---------------------------------------------------------
echo "🏗 Building API image..."
cd "$REPO_DIR/backend"
docker build -t troxe-api:latest .

# ---------------------------------------------------------
# 7. Start stack with docker compose
# ---------------------------------------------------------
cd "$REPO_DIR"
echo "🚀 Starting containers..."

# Export for compose substitution
export DOMAIN="$ROOT_DOMAIN"
export POSTGRES_PASSWORD
export JWT_ACCESS_SECRET
export JWT_REFRESH_SECRET
export ENV_ENCRYPTION_KEY
export SOCK_GID

docker compose -f docker-compose.prod.yml up -d --remove-orphans

# ---------------------------------------------------------
# 8. Wait for API health
# ---------------------------------------------------------
echo "⏳ Waiting for API to be ready..."
for i in {1..30}; do
  if curl -sf "http://127.0.0.1:3300/api/v1/health/ready" | grep -q '"status":"ok"'; then
    echo "✅ API healthy"
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    echo "❌ API failed to become healthy"
    docker compose -f docker-compose.prod.yml logs api --tail=50
    exit 1
  fi
done

# ---------------------------------------------------------
# 9. Run DB migrations
# ---------------------------------------------------------
echo "🗄 Running database migrations..."
docker compose -f docker-compose.prod.yml exec -T api npx drizzle-kit migrate || true

# ---------------------------------------------------------
# 10. Final status
# ---------------------------------------------------------
echo
echo "🎉 Deployment complete!"
echo "   Frontend: https://$ROOT_DOMAIN"
echo "   API:      https://$API_DOMAIN"
echo "   Health:   https://$API_DOMAIN/api/v1/health/ready"
echo
echo "📋 Useful commands:"
echo "   Logs:     docker compose -f $REPO_DIR/docker-compose.prod.yml logs -f"
echo "   Restart:  docker compose -f $REPO_DIR/docker-compose.prod.yml restart"
echo "   Update:   cd $REPO_DIR && git pull && $0 $API_DOMAIN $ROOT_DOMAIN"
echo "   Backup:   docker run --rm -v troxe-backups:/data -v \$(pwd):/backup alpine tar czf /backup/backup-\$(date +%F).tar.gz /data"
echo
echo "⚠️  Save $ENV_FILE securely — it contains all secrets!"