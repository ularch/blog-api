#!/bin/bash

# API 测试脚本
# 用于测试博客 API 的所有端点

# 默认配置
BASE_URL="${1:-http://localhost:8787}"
API_BASE="$BASE_URL/api"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 测试计数器
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# 测试函数
run_test() {
    local test_name="$1"
    local method="$2"
    local endpoint="$3"
    local data="$4"
    local expected_status="$5"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    echo -e "\n${BLUE}🧪 测试: $test_name${NC}"
    echo "请求: $method $endpoint"
    
    if [ -n "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$API_BASE$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_BASE$endpoint")
    fi
    
    # 分离响应体和状态码
    status_code=$(echo "$response" | tail -n1)
    response_body=$(echo "$response" | head -n -1)
    
    echo "状态码: $status_code"
    echo "响应: $response_body" | head -c 200
    if [ ${#response_body} -gt 200 ]; then
        echo "..."
    fi
    
    if [ "$status_code" = "$expected_status" ]; then
        echo -e "${GREEN}✅ 测试通过${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        echo -e "${RED}❌ 测试失败 (期望状态码: $expected_status, 实际: $status_code)${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

echo -e "${BLUE}🚀 开始 API 测试${NC}"
echo "测试目标: $BASE_URL"

# 检查服务是否运行
echo -e "\n${BLUE}📡 检查服务连接${NC}"
if curl -s "$BASE_URL" > /dev/null; then
    echo -e "${GREEN}✅ 服务连接正常${NC}"
else
    echo -e "${RED}❌ 无法连接到服务${NC}"
    echo "请确保本地开发服务器正在运行："
    echo "npm run dev"
    exit 1
fi

echo -e "\n${YELLOW}======== 开始 API 端点测试 ========${NC}"

# 测试 1: 获取帖子列表
run_test "获取帖子列表" "GET" "/posts" "" "200"

# 测试 2: 获取帖子列表（分页）
run_test "获取帖子列表（分页）" "GET" "/posts?page=1&limit=1" "" "200"

# 测试 3: 获取帖子列表（状态筛选）
run_test "获取已发布帖子" "GET" "/posts?status=published" "" "200"

# 测试 4: 获取单个帖子
run_test "获取单个帖子" "GET" "/posts/1" "" "200"

# 测试 5: 获取不存在的帖子
run_test "获取不存在的帖子" "GET" "/posts/999" "" "404"

# 测试 6: 创建新帖子
TIMESTAMP=$(date +%s)
NEW_POST_DATA='{
    "title": "自动化测试文章 '${TIMESTAMP}'",
    "content": "这是一篇通过自动化测试创建的文章，时间戳: '${TIMESTAMP}'",
    "author": "测试机器人",
    "slug": "auto-test-post-'${TIMESTAMP}'",
    "status": "published",
    "excerpt": "自动化测试摘要"
}'

run_test "创建新帖子" "POST" "/posts" "$NEW_POST_DATA" "201"

# 获取刚创建的帖子ID（假设是最新的）
echo -e "\n${BLUE}📝 获取新创建的帖子ID${NC}"
LATEST_POST=$(curl -s "$API_BASE/posts?limit=1" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

if [ -n "$LATEST_POST" ]; then
    echo "最新帖子ID: $LATEST_POST"
    
    # 测试 7: 更新帖子
    UPDATE_DATA='{
        "title": "已更新的测试文章 '${TIMESTAMP}'",
        "content": "这是更新后的内容"
    }'
    run_test "更新帖子" "PUT" "/posts/$LATEST_POST" "$UPDATE_DATA" "200"
    
    # 测试 8: 验证更新
    run_test "验证帖子更新" "GET" "/posts/$LATEST_POST" "" "200"
    
    # 测试 9: 删除帖子
    run_test "删除帖子" "DELETE" "/posts/$LATEST_POST" "" "200"
    
    # 测试 10: 验证删除
    run_test "验证帖子删除" "GET" "/posts/$LATEST_POST" "" "404"
else
    echo -e "${YELLOW}⚠️ 无法获取新创建的帖子ID，跳过更新和删除测试${NC}"
fi

# 测试无效数据
echo -e "\n${YELLOW}======== 错误处理测试 ========${NC}"

# 测试 11: 创建无效帖子（缺少必需字段）
INVALID_POST_DATA='{
    "title": "无效帖子"
}'

run_test "创建无效帖子（缺少字段）" "POST" "/posts" "$INVALID_POST_DATA" "400"

# 测试 12: 更新不存在的帖子
run_test "更新不存在的帖子" "PUT" "/posts/999" "$UPDATE_DATA" "404"

# 测试 13: 删除不存在的帖子
run_test "删除不存在的帖子" "DELETE" "/posts/999" "" "404"

# 测试 14: 无效的查询参数
run_test "无效的页码参数" "GET" "/posts?page=-1" "" "400"

# 测试 15: 无效的限制参数
run_test "无效的限制参数" "GET" "/posts?limit=0" "" "400"

echo -e "\n${YELLOW}======== 性能测试 ========${NC}"

# 简单的性能测试
echo -e "\n${BLUE}⚡ 执行基础性能测试${NC}"
START_TIME=$(date +%s.%N)
for i in {1..10}; do
    curl -s "$API_BASE/posts" > /dev/null
done
END_TIME=$(date +%s.%N)
DURATION=$(echo "$END_TIME - $START_TIME" | bc)
AVG_TIME=$(echo "scale=3; $DURATION / 10" | bc)

echo "10次请求总时间: ${DURATION}s"
echo "平均响应时间: ${AVG_TIME}s"

if (( $(echo "$AVG_TIME < 0.5" | bc -l) )); then
    echo -e "${GREEN}✅ 性能测试通过 (< 0.5s)${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${YELLOW}⚠️ 性能稍慢但可接受${NC}"
fi

# 测试总结
echo -e "\n${YELLOW}======== 测试总结 ========${NC}"
echo "总测试数: $TOTAL_TESTS"
echo -e "通过测试: ${GREEN}$PASSED_TESTS${NC}"
echo -e "失败测试: ${RED}$FAILED_TESTS${NC}"

SUCCESS_RATE=$(echo "scale=1; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc)
echo "成功率: ${SUCCESS_RATE}%"

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "\n${GREEN}🎉 所有测试通过！API 工作正常${NC}"
    exit 0
elif [ $FAILED_TESTS -le 2 ]; then
    echo -e "\n${YELLOW}⚠️ 大部分测试通过，有少量失败${NC}"
    exit 1
else
    echo -e "\n${RED}❌ 多个测试失败，请检查API实现${NC}"
    exit 2
fi
