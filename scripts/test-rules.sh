#!/bin/bash
# Test all active override rules
# Usage:
#   ./scripts/test-rules.sh          # Test all rules
#   ./scripts/test-rules.sh <group>  # Test specific group
#   ./scripts/test-rules.sh --demo   # Test only demo rules

set -e

BASE_URL="http://localhost:4000"
RULES_DIR="rules"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Counters
TOTAL=0
PASSED=0
FAILED=0
SKIPPED=0

# Helper functions
pass() {
  echo -e "${GREEN}✓ PASS${NC} $1"
  ((PASSED++))
}

fail() {
  echo -e "${RED}✗ FAIL${NC} $1"
  echo -e "${GRAY}  $2${NC}"
  ((FAILED++))
}

skip() {
  echo -e "${YELLOW}⊘ SKIP${NC} $1"
  ((SKIPPED++))
}

info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

# Check if server is running
check_server() {
  if ! curl -s -f "$BASE_URL/__env" > /dev/null 2>&1; then
    echo -e "${RED}Error: Server not running at $BASE_URL${NC}"
    echo "Start server with: pnpm dev"
    exit 1
  fi
}

# Test built-in endpoints
test_builtin() {
  echo "Testing Built-in Endpoints"
  echo "=========================="
  echo ""

  # Test /__env
  ((TOTAL++))
  response=$(curl -s -w "\n%{http_code}" "$BASE_URL/__env")
  status=$(echo "$response" | tail -n 1)
  body=$(echo "$response" | head -n -1)

  if [ "$status" -eq 200 ]; then
    if echo "$body" | grep -q "PROXY_TARGET"; then
      pass "GET /__env returns environment config"
    else
      fail "GET /__env" "Response missing PROXY_TARGET field"
    fi
  else
    fail "GET /__env" "Expected 200, got $status"
  fi

  echo ""
}

# Test demo rules
test_demo() {
  echo "Testing Demo Rules"
  echo "=================="
  echo ""

  # Test /__demo/hello
  if [ -f "$RULES_DIR/_demo.ts" ]; then
    ((TOTAL++))
    response=$(curl -s -w "\n%{http_code}" "$BASE_URL/__demo/hello")
    status=$(echo "$response" | tail -n 1)
    body=$(echo "$response" | head -n -1)

    if [ "$status" -eq 200 ]; then
      if echo "$body" | grep -q "message"; then
        pass "GET /__demo/hello returns demo response"
      else
        fail "GET /__demo/hello" "Response missing 'message' field"
      fi
    else
      fail "GET /__demo/hello" "Expected 200, got $status"
    fi
  else
    ((TOTAL++))
    skip "GET /__demo/hello (file not found)"
  fi

  echo ""
}

# Test auth rules (if they exist)
test_auth() {
  if [ ! -d "$RULES_DIR/auth" ] && [ ! -d "$RULES_DIR/commerce" ]; then
    return
  fi

  echo "Testing Auth Rules"
  echo "=================="
  echo ""

  # Test common auth endpoints
  test_auth_endpoint() {
    local path=$1
    local method=${2:-GET}
    local description=$3

    ((TOTAL++))

    # Test without auth (should fail)
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$path")
    status=$(echo "$response" | tail -n 1)

    if [ "$status" -eq 401 ]; then
      pass "$method $path without auth → 401 Unauthorized"
    elif [ "$status" -eq 404 ]; then
      skip "$method $path (endpoint not found)"
    else
      fail "$method $path without auth" "Expected 401, got $status"
    fi

    # Test with auth (if applicable)
    if [ "$status" -ne 404 ]; then
      ((TOTAL++))
      response=$(curl -s -w "\n%{http_code}" -X "$method" \
        -H "Authorization: Bearer valid-token-123" \
        "$BASE_URL$path")
      status=$(echo "$response" | tail -n 1)

      if [ "$status" -eq 200 ] || [ "$status" -eq 201 ]; then
        pass "$method $path with valid token → $status OK"
      else
        fail "$method $path with valid token" "Expected 2xx, got $status"
      fi
    fi
  }

  # Common auth endpoints
  test_auth_endpoint "/api/auth/me" "GET" "Get current user"
  test_auth_endpoint "/api/profile" "GET" "User profile"
  test_auth_endpoint "/api/admin/stats" "GET" "Admin stats"

  echo ""
}

# Test error simulation rules
test_errors() {
  if [ ! -d "$RULES_DIR/errors" ]; then
    return
  fi

  echo "Testing Error Simulation Rules"
  echo "==============================="
  echo ""

  test_error_endpoint() {
    local path=$1
    local expected_status=$2
    local description=$3

    ((TOTAL++))
    response=$(curl -s -w "\n%{http_code}" "$BASE_URL$path")
    status=$(echo "$response" | tail -n 1)

    if [ "$status" -eq "$expected_status" ]; then
      pass "$path → $expected_status"
    elif [ "$status" -eq 404 ]; then
      skip "$path (endpoint not found)"
    else
      fail "$path" "Expected $expected_status, got $status"
    fi
  }

  test_error_endpoint "/api/test/400" 400 "Bad Request"
  test_error_endpoint "/api/test/401" 401 "Unauthorized"
  test_error_endpoint "/api/test/403" 403 "Forbidden"
  test_error_endpoint "/api/test/404" 404 "Not Found"
  test_error_endpoint "/api/test/500" 500 "Internal Server Error"
  test_error_endpoint "/api/test/503" 503 "Service Unavailable"

  echo ""
}

# Test proxy fallback
test_proxy() {
  echo "Testing Proxy Fallback"
  echo "======================"
  echo ""

  ((TOTAL++))
  # Request to unmocked endpoint should proxy to upstream
  response=$(curl -s -w "\n%{http_code}" "$BASE_URL/pokemon/ditto")
  status=$(echo "$response" | tail -n 1)
  body=$(echo "$response" | head -n -1)

  if [ "$status" -eq 200 ]; then
    if echo "$body" | grep -q "ditto"; then
      pass "Unmocked /pokemon/ditto proxies to upstream"
    else
      fail "Unmocked endpoint" "Response doesn't contain expected data"
    fi
  else
    fail "Proxy fallback" "Expected 200, got $status"
  fi

  echo ""
}

# Test specific rule group
test_group() {
  local group=$1
  local group_dir="$RULES_DIR/$group"

  if [ ! -d "$group_dir" ]; then
    echo -e "${RED}Error: Group '$group' not found${NC}"
    exit 1
  fi

  echo "Testing Group: $group"
  echo "===================="
  echo ""

  # Find all rule files in group
  find "$group_dir" -name "*.ts" -o -name "*.js" | while read -r file; do
    echo "File: $file"
    # TODO: Parse file and extract test info
    # For now, just note the file
    info "Manual testing required for rules in $file"
    echo ""
  done
}

# Print summary
print_summary() {
  echo ""
  echo "Test Summary"
  echo "============"
  echo -e "Total:   $TOTAL"
  echo -e "Passed:  ${GREEN}$PASSED${NC}"
  echo -e "Failed:  ${RED}$FAILED${NC}"
  echo -e "Skipped: ${YELLOW}$SKIPPED${NC}"
  echo ""

  if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
  else
    echo -e "${RED}Some tests failed${NC}"
    exit 1
  fi
}

# Main
main() {
  local target=${1:-all}

  echo "override-proxy Rule Tests"
  echo "========================="
  echo ""

  # Check server is running
  check_server
  info "Server is running at $BASE_URL"
  echo ""

  case "$target" in
    all)
      test_builtin
      test_demo
      test_auth
      test_errors
      test_proxy
      ;;
    builtin)
      test_builtin
      ;;
    demo)
      test_demo
      ;;
    auth)
      test_auth
      ;;
    errors)
      test_errors
      ;;
    proxy)
      test_proxy
      ;;
    --help|-h)
      echo "Usage: $0 [target]"
      echo ""
      echo "Targets:"
      echo "  all      Test all rules (default)"
      echo "  builtin  Test built-in endpoints"
      echo "  demo     Test demo rules"
      echo "  auth     Test auth rules"
      echo "  errors   Test error simulation rules"
      echo "  proxy    Test proxy fallback"
      echo "  <group>  Test specific rule group"
      exit 0
      ;;
    *)
      # Assume it's a group name
      test_group "$target"
      ;;
  esac

  print_summary
}

main "$@"
