#!/bin/bash

# 快速开始脚本
# 自动化完成 Cloudflare D1 博客项目的设置和测试

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                   Cloudflare D1 博客快速开始                    ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# 步骤函数
step() {
    echo -e "\n${BLUE}📍 步骤 $1: $2${NC}"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

# 确认继续
echo -e "${YELLOW}此脚本将自动完成以下操作：${NC}"
echo "1. 验证环境依赖"
echo "2. 检查 Cloudflare 认证"
echo "3. 创建 D1 数据库（如需要）"
echo "4. 初始化本地数据库"
echo "5. 启动本地开发服务器"
echo "6. 运行 API 测试"
echo ""
read -p "继续执行？(y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "操作已取消"
    exit 0
fi

# 步骤 1: 环境验证
step "1" "验证环境"
echo "运行环境验证脚本..."
if ./test-d1-setup.sh; then
    success "环境验证通过"
else
    error "环境验证失败，请检查上述错误信息"
    exit 1
fi

# 步骤 2: 检查数据库ID配置
step "2" "检查数据库配置"
DATABASE_ID=$(grep "database_id" wrangler.toml | cut -d'"' -f2)
if [ "$DATABASE_ID" = "101b9a41-ab0a-4b26-9d92-4ddad54f44b2" ]; then
    warning "检测到示例数据库ID，建议创建新数据库"
    read -p "是否创建新的 D1 数据库？(y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "创建新数据库..."
        OUTPUT=$(npx wrangler d1 create simple-blog-db)
        echo "$OUTPUT"
        
        # 提取数据库ID
        NEW_DB_ID=$(echo "$OUTPUT" | grep "database_id" | cut -d'"' -f2)
        if [ -n "$NEW_DB_ID" ]; then
            # 更新 wrangler.toml
            sed -i.bak "s/database_id = \".*\"/database_id = \"$NEW_DB_ID\"/" wrangler.toml
            success "数据库ID已更新: $NEW_DB_ID"
        else
            warning "无法自动提取数据库ID，请手动更新 wrangler.toml"
        fi
    fi
else
    success "数据库配置已设置: $DATABASE_ID"
fi

# 步骤 3: 初始化本地数据库
step "3" "初始化本地数据库"
echo "执行数据库初始化..."
if npm run db:init:local; then
    success "本地数据库初始化完成"
else
    error "本地数据库初始化失败"
    exit 1
fi

# 步骤 4: 验证数据库内容
step "4" "验证数据库内容"
echo "检查数据库表和数据..."
TABLES=$(npx wrangler d1 execute simple-blog-db --command="SELECT name FROM sqlite_master WHERE type='table';" --local --output json 2>/dev/null | grep -o '"name":"[^"]*"' | wc -l)
POSTS=$(npx wrangler d1 execute simple-blog-db --command="SELECT COUNT(*) as count FROM posts;" --local --output json 2>/dev/null | grep -o '"count":[0-9]*' | cut -d':' -f2)

if [ "$TABLES" -gt 0 ]; then
    success "数据库表创建成功 ($TABLES 个表)"
    success "示例数据插入成功 ($POSTS 篇帖子)"
else
    error "数据库表创建失败"
    exit 1
fi

# 步骤 5: 启动开发服务器
step "5" "启动本地开发服务器"
echo "在后台启动开发服务器..."

# 检查端口是否已被占用
if lsof -Pi :8787 -sTCP:LISTEN -t >/dev/null; then
    warning "端口 8787 已被占用，尝试终止现有进程..."
    pkill -f "wrangler dev" || true
    sleep 2
fi

# 启动开发服务器
echo "启动 Wrangler 开发服务器..."
npm run dev > wrangler.log 2>&1 &
DEV_PID=$!

# 等待服务器启动
echo "等待服务器启动..."
for i in {1..30}; do
    if curl -s http://localhost:8787 >/dev/null 2>&1; then
        success "开发服务器启动成功 (PID: $DEV_PID)"
        break
    fi
    sleep 1
    echo -n "."
done

if ! curl -s http://localhost:8787 >/dev/null 2>&1; then
    error "开发服务器启动失败"
    echo "日志内容："
    cat wrangler.log
    exit 1
fi

# 步骤 6: 运行 API 测试
step "6" "运行 API 测试"
echo "执行完整的 API 测试套件..."
if ./test-api.sh; then
    success "API 测试全部通过"
else
    warning "部分 API 测试失败，但基本功能可用"
fi

# 步骤 7: 生产环境准备（可选）
step "7" "生产环境部署（可选）"
read -p "是否要部署到生产环境？(y/N): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "初始化生产数据库..."
    if npm run db:init:remote; then
        success "生产数据库初始化完成"
        
        echo "部署 Worker..."
        if npm run deploy; then
            success "生产部署完成"
            echo ""
            echo "您的 Worker 已部署，可以通过以下方式测试："
            echo "1. 查看 Wrangler 输出的 URL"
            echo "2. 使用测试脚本：./test-api.sh YOUR_WORKER_URL"
        else
            error "生产部署失败"
        fi
    else
        error "生产数据库初始化失败"
    fi
fi

# 完成总结
echo -e "\n${CYAN}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                           设置完成！                            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "${GREEN}🎉 Cloudflare D1 博客项目设置完成！${NC}"
echo ""
echo -e "${BLUE}📚 可用的操作：${NC}"
echo "• 本地开发: 服务器已在 http://localhost:8787 运行"
echo "• 停止服务器: kill $DEV_PID"
echo "• 重新启动: npm run dev"
echo "• 运行测试: ./test-api.sh"
echo "• 查看日志: tail -f wrangler.log"
echo ""
echo -e "${BLUE}📖 文档：${NC}"
echo "• 详细测试指南: D1测试验证指南.md"
echo "• 部署指南: 简化博客部署指南.md"
echo ""
echo -e "${BLUE}🔧 有用的命令：${NC}"
echo "• 查看数据库: npx wrangler d1 execute simple-blog-db --command=\"SELECT * FROM posts;\" --local"
echo "• 部署到生产: npm run deploy"
echo "• 查看生产日志: npx wrangler tail"

# 保存PID以便后续管理
echo $DEV_PID > .dev-server.pid
echo ""
echo -e "${YELLOW}💡 提示：开发服务器PID已保存到 .dev-server.pid${NC}"
