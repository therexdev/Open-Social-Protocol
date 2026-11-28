FROM node:22-bookworm-slim
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund \
    && npm run build -w packages/proto -w packages/sdk -w apps/indexer -w apps/sponsor \
    && mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production
CMD ["node", "--experimental-sqlite", "apps/sponsor/dist/main.js"]
