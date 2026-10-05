# Rover AI Lab — single container serving UI + API on :3000
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages ./packages
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w @rover/web

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATABASE_URL=file:/data/rover.db
WORKDIR /app
COPY --from=build /app /app
VOLUME ["/data"]
EXPOSE 3000
CMD ["npx", "tsx", "apps/server/src/index.ts"]
