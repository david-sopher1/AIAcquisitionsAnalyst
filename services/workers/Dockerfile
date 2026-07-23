# DealEngine workers — build from monorepo root context.
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/workers ./services/workers
RUN npm install --workspaces --include-workspace-root=false || npm install
RUN npm run build --workspaces --if-present

FROM node:20-alpine
WORKDIR /repo
ENV NODE_ENV=production SERVICE_NAME=workers
COPY --from=build /repo ./
CMD ["node", "services/workers/dist/worker.js"]
