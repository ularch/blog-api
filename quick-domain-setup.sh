#!/bin/bash

# 快速域名配置脚本
echo "🌐 开始配置 huaman-lou.top 自定义域名..."

# 检查当前状态
echo "📋 当前 Worker 状态:"
wrangler deployments list

echo ""
echo "🔍 当前 Worker 配置:"
cat wrangler.toml

echo ""
echo "⚠️  注意: 自定义域名配置需要在 Cloudflare Dashboard 中完成"
echo ""
echo "📋 手动配置步骤:"
echo "1. 访问: https://dash.cloudflare.com"
echo "2. 转到: Workers & Pages"
echo "3. 找到: Custom Domains 或域名管理"
echo "4. 添加域名: huaman-lou.top"
echo ""

# 检查域名是否已经在 Cloudflare 管理下
echo "🔍 检查域名 DNS 状态:"
nslookup huaman-lou.top

echo ""
echo "✅ 域名配置完成后，测试命令:"
echo "curl https://huaman-lou.top/api/posts"
echo ""

# 提供备选的手动配置方法
echo "📝 如果需要手动配置 DNS:"
echo "类型: CNAME"
echo "名称: @ (或 api)"  
echo "目标: simple-blog-api.gudaobaiyun12.workers.dev"
echo "代理: 启用 (橙色云朵)"
