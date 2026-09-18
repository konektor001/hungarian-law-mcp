# Auto-generated Dockerfile for Law MCP HTTP transport.
# Built by rollout-http-transport.sh from Ansvar-Architecture-Documentation.

# ── Stage 1: Build ──────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npx tsc scripts/daily-sync.ts --outDir dist/scripts --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop

# ── Stage 2: Production ────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
COPY data/database.db ./data/database.db

# Security: non-root user
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs \
 && chown -R nodejs:nodejs /app/data
USER nodejs

ENV NODE_ENV=production
CMD ["node", "dist/src/http-server.js"]
