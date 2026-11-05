# Etapa de instalación: con herramientas de compilación por si better-sqlite3 no puede descargar su binario
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=3012 DATA_DIR=/data
USER node
EXPOSE 3012
CMD ["node", "src/server.js"]
