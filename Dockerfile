FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @mediadillo/db build
RUN pnpm --filter @mediadillo/web build
RUN pnpm --filter @mediadillo/api build

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./apps/api/public
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma

EXPOSE 7731
CMD ["sh", "-c", "packages/db/node_modules/.bin/prisma db push --schema=packages/db/prisma/schema.prisma && node apps/api/dist/index.js"]
