# ─═╗ OSINT Forum — Production Dockerfile ╔═────────────────────
# Многоэтапная сборка (build → production)

# === STAGE 1: Build ===
FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++ libatomic

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# === STAGE 2: Production ===
FROM node:22-alpine

RUN apk add --no-cache libatomic rclone curl tini

WORKDIR /app

COPY --from=build /app /app

# Create data directory for Railway volume + fix permissions
RUN mkdir -p /data && chmod 777 /data /app

# Use tini as init (reaps zombies, forwards signals)
ENTRYPOINT ["/sbin/tini", "--"]

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
