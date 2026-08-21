#!/usr/bin/env bash
# nseap-mcp M0 冒烟测试
# 验证：启动握手 → 工具注册 → 本地交付物检查 → mock 提交闭环
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== nseap-mcp M0 Smoke Test ==="
echo ""

# 准备临时交付物目录
SMOKE_DIR=$(mktemp -d /tmp/nseap-smoke-XXXX)
trap 'rm -rf "$SMOKE_DIR"' EXIT
mkdir -p "$SMOKE_DIR/src"
echo "# smoke project" > "$SMOKE_DIR/README.md"
echo "print('hi')" > "$SMOKE_DIR/src/main.py"

PASS=0
FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# 用 node --import tsx 跑 server，stdin 喂 MCP JSON-RPC
run_mcp() {
  NSEAP_MOCK=1 NSEAP_STUDENT_ID=test-student node --import tsx src/index.ts 2>/dev/null
}

# 1. initialize + tools/list + 工具调用
OUTPUT=$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"nseap_check_deliverables\",\"arguments\":{\"workdir\":\"$SMOKE_DIR\",\"requiredDeliverables\":\"README.md, src/**, reflection.md\"}}}" \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"nseap_submit_project","arguments":{"challengeId":"ch-mock-c03","githubRepoUrl":"https://github.com/test/repo","projectTitle":"冒烟项目","aarText":"这是AAR复盘内容测试，包含完整的方法论总结","selfEvaluationText":"这是自评内容测试，对自己的项目进行完整评估","isPublic":true,"workdir":"'$SMOKE_DIR'","requiredDeliverables":"README.md, reflection.md","blockOnMissing":true}}}' \
  | run_mcp | python3 -c "
import sys, json
results = {}
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try: msg = json.loads(line)
    except: continue
    if msg.get('id') in (1,2,3,4):
        results[msg['id']] = msg
print(json.dumps(results))
")

echo "$OUTPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)

# 1. initialize
m1 = data.get('1', {})
if m1.get('result', {}).get('serverInfo', {}).get('name') == 'nseap-platform':
    print('  ✅ initialize 握手成功')
else:
    print('  ❌ initialize 失败:', m1)

# 2. tools/list
m2 = data.get('2', {})
tools = [t['name'] for t in m2.get('result', {}).get('tools', [])]
expected = ['nseap_check_deliverables','nseap_prepare_submission','nseap_list_challenges','nseap_get_challenge','nseap_list_my_submissions','nseap_get_task','nseap_submit_project','nseap_get_evaluation','nseap_get_dashboard','nseap_health','nseap_submit_review','nseap_notify']
missing = [t for t in expected if t not in tools]
if not missing:
    print(f'  ✅ {len(tools)} 个工具全部注册')
else:
    print(f'  ❌ 缺工具: {missing}')

# 3. check_deliverables
m3 = data.get('3', {})
sc3 = m3.get('result', {}).get('structuredContent', {})
if sc3.get('ok') is False and sc3.get('missing') == ['reflection.md']:
    print('  ✅ 本地交付物检查：正确发现缺失 reflection.md')
else:
    print('  ❌ check_deliverables 结果异常:', sc3)

# 4. submit（带缺失交付物，应被本地拦截）
m4 = data.get('4', {})
sc4 = m4.get('result', {}).get('structuredContent', {})
if sc4.get('ok') is False and ('缺少交付物' in str(sc4.get('error', {}).get('message', ''))):
    print('  ✅ 提交拦截：缺交付物时正确拦截（不消耗平台资源）')
else:
    print('  ❌ submit 拦截异常:', sc4)
"

# 2. 类型检查
if pnpm typecheck > /dev/null 2>&1; then
  ok "tsc --noEmit 零错误"
else
  fail "tsc --noEmit 有错误"
fi

# 3. 单元测试
if pnpm test > /dev/null 2>&1; then
  ok "单元测试全部通过"
else
  fail "单元测试失败"
fi

echo ""
echo "=== Smoke 结果: $PASS 通过 / $FAIL 失败 ==="
[ "$FAIL" -eq 0 ]
