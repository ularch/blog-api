#!/bin/bash

# Cloudflare D1 环境验证脚本
# 用于自动检查和测试 D1 数据库配置

set -e  # 遇到错误时退出

echo "🚀 开始 Cloudflare D1 环境验证..."

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检查函数
check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✅ $1 已安装${NC}"
        return 0
    else
        echo -e "${RED}❌ $1 未找到${NC}"
        return 1
    fi
}

# 检查版本
check_version() {
    local cmd="$1"
    local version_cmd="$2"
    local min_version="$3"
    
    if command -v "$cmd" &> /dev/null; then
        local current_version
        current_version=$($version_cmd 2>/dev/null | head -n1)
        echo -e "${GREEN}✅ $cmd: $current_version${NC}"
    else
        echo -e "${RED}❌ $cmd 未安装${NC}"
        return 1
    fi
}

echo -e "\n${BLUE}📋 第一步：检查前置条件${NC}"

# 检查 Node.js
if check_version "node" "node --version" "18.0.0"; then
    NODE_VERSION=$(node --version | sed 's/v//')
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d. -f1)
    if [ "$MAJOR_VERSION" -ge 18 ]; then
        echo -e "${GREEN}✅ Node.js 版本满足要求 (>= 18.0.0)${NC}"
    else
        echo -e "${RED}❌ Node.js 版本过低，需要 >= 18.0.0${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ 请先安装 Node.js >= 18.0.0${NC}"
    exit 1
fi

# 检查 npm
check_version "npm" "npm --version"

# 检查或安装 Wrangler
echo -e "\n${BLUE}📦 检查 Wrangler CLI${NC}"
if ! command -v wrangler &> /dev/null; then
    echo -e "${YELLOW}⚠️ Wrangler 未安装，正在安装...${NC}"
    npm install -g @cloudflare/wrangler
else
    echo -e "${GREEN}✅ Wrangler 已安装${NC}"
    npx wrangler --version
fi

echo -e "\n${BLUE}🔐 第二步：检查 Cloudflare 认证${NC}"

# 检查登录状态
if npx wrangler whoami &> /dev/null; then
    echo -e "${GREEN}✅ 已登录 Cloudflare${NC}"
    npx wrangler whoami
else
    echo -e "${YELLOW}⚠️ 未登录 Cloudflare，请执行登录...${NC}"
    echo "请在浏览器中完成登录，然后返回终端"
    npx wrangler login
fi

echo -e "\n${BLUE}🗄️ 第三步：检查 D1 权限${NC}"

# 检查 D1 权限
if npx wrangler d1 list &> /dev/null; then
    echo -e "${GREEN}✅ D1 权限正常${NC}"
    echo "当前 D1 数据库列表："
    npx wrangler d1 list
else
    echo -e "${RED}❌ D1 权限检查失败${NC}"
    echo "请确保您的 Cloudflare 账户有 D1 访问权限"
    exit 1
fi

echo -e "\n${BLUE}📁 第四步：检查项目文件${NC}"

# 检查必要文件
required_files=("wrangler.toml" "simple_blog_worker.js" "simple_blog_database.sql" "package.json")

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✅ $file 存在${NC}"
    else
        echo -e "${RED}❌ $file 不存在${NC}"
        exit 1
    fi
done

echo -e "\n${BLUE}🔧 第五步：验证配置文件${NC}"

# 检查 wrangler.toml 配置
if grep -q "database_id" wrangler.toml; then
    DATABASE_ID=$(grep "database_id" wrangler.toml | cut -d'"' -f2)
    if [ "$DATABASE_ID" != "101b9a41-ab0a-4b26-9d92-4ddad54f44b2" ]; then
        echo -e "${GREEN}✅ wrangler.toml 配置了自定义数据库ID${NC}"
    else
        echo -e "${YELLOW}⚠️ 使用示例数据库ID，建议创建新的数据库${NC}"
        echo "运行以下命令创建新数据库："
        echo "npx wrangler d1 create simple-blog-db"
    fi
else
    echo -e "${RED}❌ wrangler.toml 缺少数据库配置${NC}"
    exit 1
fi

echo -e "\n${BLUE}🚀 第六步：测试基本功能${NC}"

# 检查数据库是否存在
DATABASE_NAME="simple-blog-db"
if npx wrangler d1 info "$DATABASE_NAME" &> /dev/null; then
    echo -e "${GREEN}✅ 数据库 $DATABASE_NAME 存在${NC}"
else
    echo -e "${YELLOW}⚠️ 数据库 $DATABASE_NAME 不存在，正在创建...${NC}"
    npx wrangler d1 create "$DATABASE_NAME"
    echo -e "${YELLOW}请将上面输出的数据库ID更新到 wrangler.toml 文件中${NC}"
fi

echo -e "\n${GREEN}🎉 环境验证完成！${NC}"
echo -e "\n${BLUE}📝 下一步操作建议：${NC}"
echo "1. 初始化本地数据库："
echo "   npm run db:init:local"
echo ""
echo "2. 启动本地开发服务器："
echo "   npm run dev"
echo ""
echo "3. 测试 API 端点："
echo "   curl http://localhost:8787/api/posts"
echo ""
echo "4. 初始化生产数据库："
echo "   npm run db:init:remote"
echo ""
echo "5. 部署到生产环境："
echo "   npm run deploy"

echo -e "\n${BLUE}📖 详细测试指南请查看：D1测试验证指南.md${NC}"
