FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++ libatomic

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

FROM node:22-alpine

RUN apk add --no-cache libatomic

WORKDIR /app

COPY --from=build /app /app

RUN mkdir -p /data && chmod 777 /data

EXPOSE 3000

CMD ["node", "server.js"]
