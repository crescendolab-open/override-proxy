#!/bin/bash
# List all override rules with details
# Usage:
#   ./scripts/list-rules.sh           # List all active rules
#   ./scripts/list-rules.sh --all     # Include disabled rules
#   ./scripts/list-rules.sh --tree    # Show tree structure
#   ./scripts/list-rules.sh <group>   # List rules in specific group

set -e

RULES_DIR="rules"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Extract rule info from file
parse_rule_file() {
  local file=$1
  local name=$(grep -oP 'export\s+(const|default)\s+\K\w+' "$file" 2>/dev/null | head -1 || echo "Unknown")
  local methods=$(grep -oP 'methods:\s*\[\K[^\]]+' "$file" 2>/dev/null | tr -d "'" | tr -d '"' || echo "GET")
  local path=$(grep -oP "path:\s*['\"/]\\K[^'\"]*" "$file" 2>/dev/null | head -1 || echo "?")
  local enabled=$(grep -q 'enabled:\s*false' "$file" && echo "disabled" || echo "enabled")

  echo "$name|$methods|$path|$enabled"
}

# List rules in a directory
list_rules_in_dir() {
  local dir=$1
  local prefix=$2
  local show_disabled=${3:-false}

  # Check if directory should be listed
  local dirname=$(basename "$dir")

  # Skip if disabled and not showing disabled
  if [[ "$dirname" == .* ]] && [ "$show_disabled" != "true" ]; then
    return
  fi

  # Skip .trash
  if [[ "$dirname" == ".trash" ]]; then
    return
  fi

  # Find all TypeScript/JavaScript files
  local files=$(find "$dir" -maxdepth 1 -type f \( -name "*.ts" -o -name "*.js" \) ! -name "*.d.ts" 2>/dev/null || echo "")

  if [ -z "$files" ]; then
    return
  fi

  # Print directory header
  if [[ "$dirname" == .* ]]; then
    echo -e "${GRAY}$prefix$dirname/${NC} ${YELLOW}(disabled)${NC}"
  else
    echo -e "${GREEN}$prefix$dirname/${NC}"
  fi

  # List files
  echo "$files" | while read -r file; do
    if [ -z "$file" ]; then
      continue
    fi

    local info=$(parse_rule_file "$file")
    local name=$(echo "$info" | cut -d'|' -f1)
    local methods=$(echo "$info" | cut -d'|' -f2)
    local path=$(echo "$info" | cut -d'|' -f3)
    local enabled=$(echo "$info" | cut -d'|' -f4)

    local basename=$(basename "$file")

    if [ "$enabled" == "disabled" ]; then
      echo -e "  ${GRAY}• $basename${NC}"
      echo -e "    ${GRAY}├─ Rule: $name${NC}"
      echo -e "    ${GRAY}├─ Methods: $methods${NC}"
      echo -e "    ${GRAY}├─ Path: $path${NC}"
      echo -e "    ${GRAY}└─ Status: ${YELLOW}disabled${NC}"
    else
      echo -e "  ${BLUE}• $basename${NC}"
      echo -e "    ├─ Rule: ${GREEN}$name${NC}"
      echo -e "    ├─ Methods: $methods"
      echo -e "    ├─ Path: $path"
      echo -e "    └─ Status: ${GREEN}enabled${NC}"
    fi
    echo ""
  done
}

# List all rules
list_all() {
  local show_disabled=${1:-false}

  echo "Override Rules"
  echo "=============="
  echo ""

  # Get all directories in rules/
  find "$RULES_DIR" -mindepth 1 -maxdepth 1 -type d | sort | while read -r dir; do
    list_rules_in_dir "$dir" "" "$show_disabled"
  done

  # Also check root level files
  local root_files=$(find "$RULES_DIR" -maxdepth 1 -type f \( -name "*.ts" -o -name "*.js" \) ! -name "*.d.ts" 2>/dev/null || echo "")

  if [ -n "$root_files" ]; then
    echo -e "${GREEN}$RULES_DIR/ (root)${NC}"
    echo "$root_files" | while read -r file; do
      if [ -z "$file" ]; then
        continue
      fi

      local info=$(parse_rule_file "$file")
      local name=$(echo "$info" | cut -d'|' -f1)
      local methods=$(echo "$info" | cut -d'|' -f2)
      local path=$(echo "$info" | cut -d'|' -f3)
      local enabled=$(echo "$info" | cut -d'|' -f4)

      local basename=$(basename "$file")

      echo -e "  ${BLUE}• $basename${NC}"
      echo -e "    ├─ Rule: ${GREEN}$name${NC}"
      echo -e "    ├─ Methods: $methods"
      echo -e "    ├─ Path: $path"
      echo -e "    └─ Status: ${GREEN}$enabled${NC}"
      echo ""
    done
  fi
}

# Tree view
tree_view() {
  echo "Override Rules (Tree View)"
  echo "=========================="
  echo ""

  if command -v tree > /dev/null; then
    tree -I 'node_modules' --dirsfirst "$RULES_DIR"
  else
    echo "Install 'tree' command for tree view, or use:"
    echo "  find $RULES_DIR -type f -name '*.ts' -o -name '*.js'"
    echo ""
    find "$RULES_DIR" -type f \( -name "*.ts" -o -name "*.js" \) ! -name "*.d.ts" | sort
  fi
}

# Summary statistics
show_stats() {
  echo "Rule Statistics"
  echo "==============="
  echo ""

  local total_files=$(find "$RULES_DIR" -type f \( -name "*.ts" -o -name "*.js" \) ! -name "*.d.ts" | wc -l | tr -d ' ')
  local active_files=$(find "$RULES_DIR" -type f \( -name "*.ts" -o -name "*.js" \) ! -path "*/.*/*" ! -name ".*" ! -name "*.d.ts" | wc -l | tr -d ' ')
  local disabled_files=$((total_files - active_files))

  local total_dirs=$(find "$RULES_DIR" -mindepth 1 -type d | wc -l | tr -d ' ')
  local active_dirs=$(find "$RULES_DIR" -mindepth 1 -type d ! -name ".*" ! -path "*/.trash/*" | wc -l | tr -d ' ')
  local disabled_dirs=$((total_dirs - active_dirs))

  echo "Files:"
  echo "  Total: $total_files"
  echo "  Active: ${GREEN}$active_files${NC}"
  echo "  Disabled: ${YELLOW}$disabled_files${NC}"
  echo ""

  echo "Groups:"
  echo "  Total: $total_dirs"
  echo "  Active: ${GREEN}$active_dirs${NC}"
  echo "  Disabled/Archived: ${YELLOW}$disabled_dirs${NC}"
}

# List specific group
list_group() {
  local group=$1
  local dir="$RULES_DIR/$group"

  if [ ! -d "$dir" ]; then
    echo -e "${RED}Error: Group '$group' not found${NC}"
    exit 1
  fi

  echo "Rules in group: $group"
  echo "======================"
  echo ""

  list_rules_in_dir "$dir" "" "true"
}

# Main
main() {
  local command=${1:-list}

  case "$command" in
    list)
      list_all "false"
      ;;
    --all|-a)
      list_all "true"
      ;;
    --tree|-t)
      tree_view
      ;;
    --stats|-s)
      show_stats
      ;;
    --help|-h)
      echo "Usage: $0 [command|group]"
      echo ""
      echo "Commands:"
      echo "  list          List active rules (default)"
      echo "  --all, -a     List all rules (including disabled)"
      echo "  --tree, -t    Show tree structure"
      echo "  --stats, -s   Show statistics"
      echo "  <group>       List rules in specific group"
      echo "  --help, -h    Show this help"
      echo ""
      echo "Examples:"
      echo "  $0"
      echo "  $0 --all"
      echo "  $0 --tree"
      echo "  $0 --stats"
      echo "  $0 auth"
      ;;
    *)
      # Assume it's a group name
      list_group "$command"
      ;;
  esac
}

main "$@"
