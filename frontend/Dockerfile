ARG IMAGE_PREFIX=docker.m.daocloud.io/library/
FROM ${IMAGE_PREFIX}node:22-alpine AS build
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmmirror.com
COPY frontend/package*.json ./
# npm 仅在构建阶段安装依赖；允许通过 Compose 构建参数改回 npmjs 官方源。
RUN npm install --no-audit --no-fund \
    --registry="${NPM_REGISTRY}" \
    --fetch-retries=5 --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=120000
COPY frontend/ ./
RUN npm run build

FROM ${IMAGE_PREFIX}nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
