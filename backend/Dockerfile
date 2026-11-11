FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.ts ./
USER node
CMD ["node_modules/.bin/tsx", "server.ts"]
