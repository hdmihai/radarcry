# radarcry api-node — Express gateway. Build context: services/api-node
FROM node:26-alpine AS deps
WORKDIR /app/services/api-node
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:26-alpine
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
# REPO_ROOT resolves to /app: mount ./data and ./frontend there (docker-compose.yml does it).
WORKDIR /app/services/api-node
COPY --from=deps /app/services/api-node/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1
CMD ["node", "src/server.js"]
