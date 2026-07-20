#!/usr/bin/env bash
#
# 儿童考试系统（kaoshi）· 一键部署 / 升级脚本
# ---------------------------------------------------------------
# 前置条件（服务器上只需装好这三项）：
#   - Docker（含 docker compose 子命令，Docker 20.10+）
#   - git
#   - 能访问 GitHub（拉取代码）与 Docker Hub（拉取 busybox 做备份）
#
# 用法：
#   ./deploy.sh init      首次部署：自动生成 .env（随机 JWT 密钥）→ 构建镜像 → 启动
#   ./deploy.sh upgrade   一键升级：备份数据库 → git pull → 重建容器 → 健康检查 → 失败自动回滚
#   ./deploy.sh backup    仅备份数据库卷到 backups/
#   ./deploy.sh rollback  回滚到上一次 upgrade 之前的版本 + 数据库
#   ./deploy.sh status    查看容器 / 镜像 / 卷状态
#   ./deploy.sh logs      跟踪容器日志
#   ./deploy.sh restart   重启容器
#   ./deploy.sh stop      停止容器
#   ./deploy.sh start     启动容器
#
set -euo pipefail

COMPOSE_FILE="docker-compose.yml"
SERVICE="app"            # docker-compose.yml 中 services 的名称
CONTAINER="kaoshi-app"   # container_name
VOLUME_LOGICAL="kaoshi_data"
IMAGE="kaoshi:latest"
BACKUP_DIR="backups"
# 健康检查地址（新版镜像有 /api/health；旧版回退到根路径 200）
HEALTH_URL="${HEALTH_URL:-http://localhost:4000/api/health}"

log()  { echo -e "\033[32m[deploy]\033[0m $*"; }
warn() { echo -e "\033[33m[warn]\033[0m $*"; }
err()  { echo -e "\033[31m[error]\033[0m $*" >&2; }

# ---------- 依赖检查 ----------
require_docker() {
  if ! command -v docker >/dev/null 2>&1; then err "未检测到 docker，请先安装 Docker。"; exit 1; fi
  if ! docker compose version >/dev/null 2>&1; then err "docker compose 子命令不可用，请升级 Docker 到 20.10+。"; exit 1; fi
}
require_git()    { command -v git    >/dev/null 2>&1 || { err "未检测到 git。"; exit 1; }; }
require_openssl(){ command -v openssl >/dev/null 2>&1 || { err "未检测到 openssl（用于生成随机密钥）。"; exit 1; }; }
require_curl()   { command -v curl   >/dev/null 2>&1 || { err "未检测到 curl（用于健康检查）。"; exit 1; }; }

# 解析数据库卷的真实名称（compose 会给卷加项目前缀，且 container_name 固定，故从容器反查最稳）
real_volume() {
  docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/.data"}}{{.Name}}{{end}}{{end}}' "$CONTAINER" 2>/dev/null || true
}

# ---------- 数据库备份 / 恢复 ----------
mk_backup_dir() { mkdir -p "$BACKUP_DIR"; }

backup_volume() {
  mk_backup_dir
  local vol; vol="$(real_volume)"; [ -z "$vol" ] && vol="$VOLUME_LOGICAL"
  local ts; ts="$(date +%Y%m%d-%H%M%S)"
  local file="$BACKUP_DIR/kaoshi-db-$ts.tar.gz"
  log "备份数据库卷 [$vol] -> $file"
  docker run --rm -v "$vol:/data" -v "$PWD/$BACKUP_DIR:/backup" busybox \
    tar czf "/backup/kaoshi-db-$ts.tar.gz" -C /data .
  echo "$file"
}

restore_volume() {
  local file="$1"
  [ -f "$file" ] || { err "备份文件不存在: $file"; exit 1; }
  local vol; vol="$(real_volume)"; [ -z "$vol" ] && vol="$VOLUME_LOGICAL"
  log "从 $file 恢复数据库卷 [$vol]"
  docker run --rm -v "$vol:/data" busybox sh -c "cd /data && rm -rf ./* ./.[!.]*" 2>/dev/null || true
  docker run --rm -v "$vol:/data" -v "$PWD/$BACKUP_DIR:/backup" busybox \
    tar xzf "/backup/$(basename "$file")" -C /data
}

# ---------- 健康检查 ----------
health_check() {
  local i tries=40
  for ((i=1; i<=tries; i++)); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    # 旧版镜像无 /api/health，回退到根路径
    if curl -fsS "${HEALTH_URL%/api/health}/" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

# ---------- .env 处理 ----------
ensure_env() {
  if [ ! -f .env ]; then
    log "未找到 .env，自动生成（JWT_SECRET 随机，CORS_ORIGIN 默认 http://localhost:4000）..."
    cp .env.example .env
    local secret; secret="$(openssl rand -hex 32)"
    sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$secret|" .env && rm -f .env.bak
    log "已写入随机 JWT_SECRET。如需自定义端口 / 跨域来源，请编辑 .env 后执行 ./deploy.sh restart"
  else
    log ".env 已存在，沿用现有配置（如改动需 ./deploy.sh restart 生效）。"
  fi
}

# ---------- 子命令 ----------
cmd_init() {
  require_docker; require_git; require_openssl; require_curl
  log "=== 首次部署 ==="
  ensure_env
  log "构建镜像并启动容器（首次构建需编译 better-sqlite3，约 1-3 分钟）..."
  docker compose -f "$COMPOSE_FILE" up -d --build
  log "等待服务就绪..."
  if health_check; then
    log "✅ 部署成功！浏览器访问： http://localhost:4000"
  else
    err "❌ 服务未通过健康检查，请查看日志： ./deploy.sh logs"
    exit 1
  fi
}

cmd_upgrade() {
  require_docker; require_git; require_openssl; require_curl
  log "=== 一键升级 ==="
  local prev_commit; prev_commit="$(git rev-parse HEAD)"
  echo "$prev_commit" > .upgrade-prev-commit

  ensure_env

  # 1) 备份数据库
  local bf; bf="$(backup_volume)"
  log "升级前数据库已备份： $bf"

  # 2) 拉取最新代码（有本地改动先暂存，结束再尝试恢复）
  local stashed=0
  if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
    git stash push -u -m "deploy-auto-$(date +%s)" && stashed=1
  fi
  if ! git pull --ff-only; then
    err "git pull 失败（可能存在冲突或非快进），已中止升级。"
    [ "$stashed" = 1 ] && git stash pop 2>/dev/null || true
    exit 1
  fi
  [ "$stashed" = 1 ] && git stash pop 2>/dev/null || warn "自动 stash 的本地改动未自动恢复，请手动处理（git stash list）。"

  # 3) 重建并重启
  log "重建镜像并重启容器..."
  if docker compose -f "$COMPOSE_FILE" up -d --build --force-recreate; then
    log "等待服务健康..."
    if health_check; then
      log "✅ 升级成功！当前提交： $(git rev-parse --short HEAD)"
      rm -f .upgrade-prev-commit
      return 0
    fi
  fi

  # 4) 失败回滚
  err "❌ 升级后健康检查失败，开始自动回滚..."
  restore_volume "$bf"
  if [ -f .upgrade-prev-commit ]; then
    local pc; pc="$(cat .upgrade-prev-commit)"
    git checkout "$pc" -- . 2>/dev/null || git reset --hard "$pc"
  fi
  docker compose -f "$COMPOSE_FILE" up -d --build --force-recreate
  err "已回滚到升级前版本（$(cat .upgrade-prev-commit 2>/dev/null || echo '未知')）。请检查日志： ./deploy.sh logs"
  exit 1
}

cmd_backup()   { require_docker; local f; f="$(backup_volume)"; log "备份完成： $f"; }
cmd_rollback() {
  require_docker; require_git
  [ -f .upgrade-prev-commit ] || { err "找不到回滚记录（尚未执行过 upgrade）。"; exit 1; }
  local pc; pc="$(cat .upgrade-prev-commit)"
  local latest; latest="$(ls -t "$BACKUP_DIR"/kaoshi-db-*.tar.gz 2>/dev/null | head -1)"
  [ -n "$latest" ] && restore_volume "$latest"
  git checkout "$pc" -- . 2>/dev/null || git reset --hard "$pc"
  docker compose -f "$COMPOSE_FILE" up -d --build --force-recreate
  log "✅ 已回滚到 $pc"
}
cmd_status() { require_docker; docker compose -f "$COMPOSE_FILE" ps; echo "--- 镜像 ---"; docker images "$IMAGE"; echo "--- 卷 ---"; docker volume ls --filter "name=kaoshi"; }
cmd_logs()   { require_docker; docker compose -f "$COMPOSE_FILE" logs -f --tail=100 "$SERVICE"; }
cmd_restart(){ require_docker; docker compose -f "$COMPOSE_FILE" restart "$SERVICE"; }
cmd_stop()   { require_docker; docker compose -f "$COMPOSE_FILE" stop "$SERVICE"; }
cmd_start()  { require_docker; docker compose -f "$COMPOSE_FILE" start "$SERVICE"; }

case "${1:-}" in
  init)    cmd_init ;;
  upgrade) cmd_upgrade ;;
  backup)  cmd_backup ;;
  rollback)cmd_rollback ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  restart) cmd_restart ;;
  stop)    cmd_stop ;;
  start)   cmd_start ;;
  *) echo "用法: $0 {init|upgrade|backup|rollback|status|logs|restart|stop|start}"; exit 1 ;;
esac
