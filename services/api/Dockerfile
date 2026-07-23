# DealEngine API — build from monorepo root context.
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/api ./services/api
RUN npm install --workspaces --include-workspace-root=false || npm install
RUN npm run build --workspaces --if-present

FROM node:20-alpine
WORKDIR /repo
ENV NODE_ENV=production SERVICE_NAME=api
COPY --from=build /repo ./
EXPOSE 4000
CMD ["node", "services/api/dist/server.js"]
