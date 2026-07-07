# ---------- 构建阶段 ----------
FROM node:20-slim AS builder
WORKDIR /app

# better-sqlite3 是原生模块，需要编译工具链
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000

# 直接复用构建阶段已装好的依赖（含 tsx 与编译好的 better-sqlite3 原生模块）
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig*.json ./

EXPOSE 4000
CMD ["npm", "run", "server"]
