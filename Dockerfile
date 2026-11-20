FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-core \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]
