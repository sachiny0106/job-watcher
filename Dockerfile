FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY filters.json companies.json profile.json ./

ENV NODE_ENV=production
ENV PERSIST_GITHUB=1

CMD ["npx", "tsx", "src/bot.ts"]
