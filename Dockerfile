# Bock – a single Node process, SQLite file in /app/data (mount a volume there).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/bock.db DEMO_MODE=false
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME /app/data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
