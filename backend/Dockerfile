# Troxe Hosting API — production image.
#
# This service IS host infrastructure: it drives the Docker daemon and owns
# the host's DOCKER-USER/INPUT chains, so it must run with host-network
# visibility and NET_ADMIN. Run exactly ONE replica (reconciler GC,
# in-memory throttle and auto-backups assume single ownership):
#
#   SOCK_GID=$(stat -c %g /var/run/docker.sock)
#   docker run -d --name troxe-api --restart unless-stopped \
#     --network host --cap-add=NET_ADMIN \
#     -v /var/run/docker.sock:/var/run/docker.sock \
#     --user 1000 --group-add "$SOCK_GID" \
#     -v troxe-backups:/app/data/backups \
#     --env-file /root/troxe-api.env \
#     troxe-api:latest
#
# Notes:
#  - --network host: iptables rules must land in the HOST netns
#    (DOCKER-USER/INPUT live there, not in a container netns).
#  - --user 1000 + --group-add: the process itself is unprivileged; only
#    the socket group grants daemon access. Never --privileged.
#  - /app/data/backups must be a persistent volume (archives live there).
#  - NODE_ENV=production in the env file: boot refuses weak secrets.
# Build: docker build -t troxe-api:latest ./backend

# ---------- builder: full toolchain, compiles dist ----------
# Pinned by digest (never a mutable tag): see rotation runbook in backend README.
FROM node@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json nest-cli.json* ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build \
 && npm prune --omit=dev \
 && npm cache clean --force

# ---------- runtime: minimal, non-root ----------
FROM node@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS runtime
ENV NODE_ENV=production
# PORT unified with the code default (3300) and the healthcheck below.
ENV PORT=3300
RUN apt-get update \
 && apt-get install -y --no-install-recommends iptables tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app/data/backups \
 && chown -R 1000:1000 /app
# NOTE: base image already ships a non-root `node` user as 1000:1000 — reuse it.
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
 && npm cache clean --force \
 && node -e "require('bcrypt'); require('drizzle-orm'); console.log('native + orm load ok')"
COPY --from=builder --chown=1000:1000 /app/dist ./dist
COPY --from=builder --chown=1000:1000 /app/drizzle ./drizzle
USER 1000:1000
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3300/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]
