#!/bin/bash
# Toggle rule groups on/off by renaming folders
# Usage:
#   ./scripts/toggle-rules.sh list
#   ./scripts/toggle-rules.sh disable <group>
#   ./scripts/toggle-rules.sh enable <group>
#   ./scripts/toggle-rules.sh archive <group>

set -e

RULES_DIR="rules"
TRASH_DIR="$RULES_DIR/.trash"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
error() {
  echo -e "${RED}Error: $1${NC}" >&2
  exit 1
}

success() {
  echo -e "${GREEN}✓ $1${NC}"
}

warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

info() {
  echo -e "${BLUE}ℹ $1${NC}"
}

# Check for uncommitted changes in a directory
check_uncommitted_changes() {
  local dir=$1
  if [ -d ".git" ] && git ls-files --error-unmatch "$dir" >/dev/null 2>&1; then
    if ! git diff --quiet "$dir" || ! git diff --cached --quiet "$dir"; then
      warning "Directory '$dir' has uncommitted changes."
      echo -e "${YELLOW}Suggestions:${NC}"
      echo "  • Commit: git add $dir && git commit -m 'message'"
      echo "  • Stash: git stash push -m 'temp' $dir"
      echo ""
      read -p "Continue anyway? (y/N): " -n 1 -r
      echo
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        error "Operation cancelled by user."
      fi
    fi
  fi
}

# List all rule groups
list_groups() {
  echo "Rule Groups:"
  echo ""

  # Active groups (no dot prefix, not in .trash)
  echo -e "${GREEN}Active:${NC}"
  find "$RULES_DIR" -maxdepth 1 -type d ! -name "$RULES_DIR" ! -name ".*" | while read -r dir; do
    group=$(basename "$dir")
    count=$(find "$dir" \( -name "*.ts" -o -name "*.js" \) | wc -l | tr -d ' ')
    echo "  • $group/ ($count files)"
  done

  # Disabled groups (dot prefix, not in .trash)
  echo ""
  echo -e "${YELLOW}Disabled:${NC}"
  find "$RULES_DIR" -maxdepth 1 -type d -name ".*" ! -name ".trash" | while read -r dir; do
    group=$(basename "$dir")
    count=$(find "$dir" \( -name "*.ts" -o -name "*.js" \) | wc -l | tr -d ' ')
    echo "  • $group ($count files)"
  done

  # Archived groups (in .trash)
  if [ -d "$TRASH_DIR" ]; then
    echo ""
    echo -e "${RED}Archived (.trash):${NC}"
    find "$TRASH_DIR" -maxdepth 1 -type d ! -name ".trash" | while read -r dir; do
      group=$(basename "$dir")
      count=$(find "$dir" \( -name "*.ts" -o -name "*.js" \) | wc -l | tr -d ' ')
      echo "  • $group/ ($count files)"
    done
  fi
}

# Disable a group (add dot prefix)
disable_group() {
  local group=$1
  local source="$RULES_DIR/$group"
  local target="$RULES_DIR/.$group"

  if [ ! -d "$source" ]; then
    error "Group '$group' not found in $RULES_DIR/"
  fi

  if [ -d "$target" ]; then
    error "Disabled group '.$group' already exists. Enable or delete it first."
  fi

  # Safety check for uncommitted changes
  check_uncommitted_changes "$source"

  mv "$source" "$target"
  success "Disabled $group/ → .$group/"
  warning "Restart server for changes to take effect: pnpm dev"
}

# Enable a group (remove dot prefix)
enable_group() {
  local group=$1
  # Remove leading dot if provided
  group="${group#.}"

  local source="$RULES_DIR/.$group"
  local target="$RULES_DIR/$group"

  if [ ! -d "$source" ]; then
    error "Disabled group '.$group' not found. Use 'list' to see available groups."
  fi

  if [ -d "$target" ]; then
    error "Active group '$group' already exists. Disable or delete it first."
  fi

  # Safety check for uncommitted changes
  check_uncommitted_changes "$source"

  mv "$source" "$target"
  success "Enabled .$group/ → $group/"
  warning "Restart server for changes to take effect: pnpm dev"
}

# Archive a group (move to .trash)
archive_group() {
  local group=$1
  local source="$RULES_DIR/$group"
  local target="$TRASH_DIR/$group"

  if [ ! -d "$source" ]; then
    error "Group '$group' not found in $RULES_DIR/"
  fi

  # Create .trash if doesn't exist
  mkdir -p "$TRASH_DIR"

  if [ -d "$target" ]; then
    error "Group '$group' already archived. Delete it first or use a different name."
  fi

  # Safety check for uncommitted changes
  check_uncommitted_changes "$source"

  mv "$source" "$target"
  success "Archived $group/ → .trash/$group/"
  info "To restore: mv $target $source"
  warning "Restart server for changes to take effect: pnpm dev"
}

# Restore from archive
restore_group() {
  local group=$1
  local source="$TRASH_DIR/$group"
  local target="$RULES_DIR/$group"

  if [ ! -d "$source" ]; then
    error "Archived group '$group' not found in .trash/"
  fi

  if [ -d "$target" ]; then
    error "Group '$group' already exists. Delete or rename it first."
  fi

  mv "$source" "$target"
  success "Restored .trash/$group/ → $group/"
  warning "Restart server for changes to take effect: pnpm dev"
}

# Main command dispatcher
main() {
  local command=${1:-list}
  local group=$2

  case "$command" in
    list|ls)
      list_groups
      ;;
    disable|off)
      if [ -z "$group" ]; then
        error "Usage: $0 disable <group>"
      fi
      disable_group "$group"
      ;;
    enable|on)
      if [ -z "$group" ]; then
        error "Usage: $0 enable <group>"
      fi
      enable_group "$group"
      ;;
    archive)
      if [ -z "$group" ]; then
        error "Usage: $0 archive <group>"
      fi
      archive_group "$group"
      ;;
    restore)
      if [ -z "$group" ]; then
        error "Usage: $0 restore <group>"
      fi
      restore_group "$group"
      ;;
    help|-h|--help)
      echo "Usage: $0 <command> [group]"
      echo ""
      echo "Commands:"
      echo "  list              List all rule groups (active, disabled, archived)"
      echo "  disable <group>   Disable a group (add dot prefix)"
      echo "  enable <group>    Enable a group (remove dot prefix)"
      echo "  archive <group>   Archive a group (move to .trash/)"
      echo "  restore <group>   Restore from archive"
      echo "  help              Show this help"
      echo ""
      echo "Examples:"
      echo "  $0 list"
      echo "  $0 disable auth"
      echo "  $0 enable auth"
      echo "  $0 archive old-feature"
      echo "  $0 restore old-feature"
      ;;
    *)
      error "Unknown command: $command. Use '$0 help' for usage."
      ;;
  esac
}

main "$@"
