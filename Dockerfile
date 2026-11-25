FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs question-record.mjs ./
COPY lib ./lib
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATA_DIR=/app/data

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "server.mjs"]
