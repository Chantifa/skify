FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/
COPY packages/web/package.json ./packages/web/

RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_API_URL=http://localhost:8787
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm build

FROM node:20-alpine AS runner

WORKDIR /app
RUN corepack enable pnpm

COPY --from=builder /app/packages/web/dist ./web
COPY --from=builder /app/packages/cli/dist ./cli

RUN npm install -g serve

ENV PORT=3000
EXPOSE 3000

CMD ["serve", "-s", "web", "-l", "3000"]
