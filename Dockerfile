FROM node:22-alpine
RUN apk add --no-cache docker-cli git
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @clawscale/app db:generate
RUN pnpm run build

ENV NODE_ENV=production

COPY <<'EOF' /app/start.sh
#!/bin/sh
cd /app/packages/app && npx prisma migrate deploy || npx prisma db push --skip-generate
export HOST=0.0.0.0 PORT=4040
exec node dist/api/index.js
EOF
RUN chmod +x /app/start.sh

EXPOSE 4040
CMD ["/app/start.sh"]
