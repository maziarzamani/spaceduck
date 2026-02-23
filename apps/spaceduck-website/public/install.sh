#!/usr/bin/env bash
# Spaceduck installer — installs the gateway server + CLI
# https://spaceduck.ai
#
# Usage:
#   curl -fsSL https://spaceduck.ai/install.sh | bash
#   curl -fsSL https://spaceduck.ai/install.sh | bash -s -- --yes
#
# Env overrides (for CI):
#   SPACEDUCK_RELEASE_BASE_URL  — override download base URL
#   SPACEDUCK_VERSION           — pin version (e.g. v0.14.1)
#   SPACEDUCK_SKIP_BUN_INSTALL=1 — fail if Bun is not found

set -euo pipefail

# ── Release contract (must match scripts/release-contract.json) ───────────────
REPO="maziarzamani/spaceduck"
ARTIFACT_GATEWAY="spaceduck-gateway.js"
ARTIFACT_CLI="spaceduck-cli.js"
ARTIFACT_CHECKSUMS="checksums.txt"
ARTIFACT_MANIFEST="manifest.json"
ARTIFACT_VERSION="VERSION"
INSTALL_DEFAULT_DIR=".spaceduck"
INSTALL_BIN_DIR="bin"
INSTALL_RELEASES_DIR="releases"
INSTALL_CURRENT_LINK="current"
INSTALL_DATA_DIR="data"
BUN_MIN_VERSION="1.2.0"

# ── Defaults ──────────────────────────────────────────────────────────────────
YES=0
VERSION=""
INSTALL_DIR=""
BASE_URL=""
NO_BUN_INSTALL=0

# ── Color helpers ─────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -t 2 ]; then
  BOLD="\033[1m"
  DIM="\033[2m"
  RED="\033[31m"
  GREEN="\033[32m"
  YELLOW="\033[33m"
  CYAN="\033[36m"
  RESET="\033[0m"
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi

info()  { printf "${CYAN}info${RESET}  %s\n" "$*"; }
ok()    { printf "${GREEN}  ok${RESET}  %s\n" "$*"; }
warn()  { printf "${YELLOW}warn${RESET}  %s\n" "$*" >&2; }
err()   { printf "${RED}error${RESET} %s\n" "$*" >&2; }
fatal() { err "$@"; exit 1; }

# ── Usage ─────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}spaceduck Installer${RESET}

Install the spaceduck gateway server + CLI.

${BOLD}USAGE${RESET}
    curl -fsSL https://spaceduck.ai/install.sh | bash
    curl -fsSL https://spaceduck.ai/install.sh | bash -s -- [OPTIONS]

${BOLD}OPTIONS${RESET}
    --yes               Non-interactive mode (auto-install Bun, skip prompts)
    --version <tag>     Install a specific version (e.g. v0.14.1)
    --install-dir <dir> Override install directory (default: ~/.spaceduck)
    --base-url <url>    Override release download base URL
    --no-bun-install    Fail if Bun is not found instead of installing it
    -h, --help          Show this help

${BOLD}ENVIRONMENT${RESET}
    SPACEDUCK_RELEASE_BASE_URL   Same as --base-url
    SPACEDUCK_VERSION            Same as --version
    SPACEDUCK_SKIP_BUN_INSTALL   Set to 1 for --no-bun-install
EOF
  exit 0
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y)          YES=1; shift ;;
    --version)         VERSION="${2:-}"; [ -z "$VERSION" ] && fatal "--version requires a value"; shift 2 ;;
    --install-dir)     INSTALL_DIR="${2:-}"; [ -z "$INSTALL_DIR" ] && fatal "--install-dir requires a value"; shift 2 ;;
    --base-url)        BASE_URL="${2:-}"; [ -z "$BASE_URL" ] && fatal "--base-url requires a value"; shift 2 ;;
    --no-bun-install)  NO_BUN_INSTALL=1; shift ;;
    -h|--help)         usage ;;
    *)                 fatal "Unknown option: $1 (see --help)" ;;
  esac
done

# Apply env overrides (flags take precedence)
[ -z "$BASE_URL" ] && BASE_URL="${SPACEDUCK_RELEASE_BASE_URL:-}"
[ -z "$VERSION" ]  && VERSION="${SPACEDUCK_VERSION:-}"
[ "$NO_BUN_INSTALL" -eq 0 ] && [ "${SPACEDUCK_SKIP_BUN_INSTALL:-0}" = "1" ] && NO_BUN_INSTALL=1

# ── OS / Arch detection ──────────────────────────────────────────────────────
detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux)  OS="linux" ;;
    Darwin) OS="darwin" ;;
    *)      fatal "Unsupported operating system: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64)   ARCH="x86_64" ;;
    aarch64|arm64)   ARCH="aarch64" ;;
    *)               fatal "Unsupported architecture: $arch" ;;
  esac

  info "Detected platform: $OS/$ARCH"
}

# ── HTTP helper (curl with wget fallback) ─────────────────────────────────────
fetch() {
  local url="$1" dest="$2"
  if command -v curl &>/dev/null; then
    curl -fsSL --retry 3 --retry-delay 2 -o "$dest" "$url"
  elif command -v wget &>/dev/null; then
    wget -q --tries=3 -O "$dest" "$url"
  else
    fatal "Neither curl nor wget found. Install one and try again."
  fi
}

fetch_text() {
  local url="$1"
  if command -v curl &>/dev/null; then
    curl -fsSL --retry 3 --retry-delay 2 "$url"
  elif command -v wget &>/dev/null; then
    wget -q --tries=3 -O- "$url"
  else
    fatal "Neither curl nor wget found. Install one and try again."
  fi
}

# ── SHA256 helper ─────────────────────────────────────────────────────────────
sha256_cmd=""
detect_sha256() {
  if command -v sha256sum &>/dev/null; then
    sha256_cmd="sha256sum"
  elif command -v shasum &>/dev/null; then
    sha256_cmd="shasum -a 256"
  else
    fatal "Could not verify download integrity (sha256 tool missing). Install coreutils or Xcode command line tools."
  fi
}

verify_checksums() {
  local checksums_file="$1" dir="$2"
  info "Verifying checksums..."
  cd "$dir"
  if ! $sha256_cmd --check "$checksums_file" --status 2>/dev/null; then
    # --status may not be available everywhere; try verbose check
    if ! $sha256_cmd --check "$checksums_file"; then
      fatal "Checksum verification failed. Downloaded files may be corrupted or tampered with."
    fi
  fi
  cd - >/dev/null
  ok "All checksums verified"
}

# ── Bun detection / install ───────────────────────────────────────────────────
BUN_BIN=""
find_bun() {
  if command -v bun &>/dev/null; then
    BUN_BIN="$(command -v bun)"
  elif [ -x "$HOME/.bun/bin/bun" ]; then
    BUN_BIN="$HOME/.bun/bin/bun"
  fi
}

ensure_bun() {
  find_bun
  if [ -n "$BUN_BIN" ]; then
    local bun_ver
    bun_ver="$("$BUN_BIN" --version 2>/dev/null || echo "unknown")"
    ok "Bun found: $BUN_BIN (v$bun_ver)"
    return
  fi

  if [ "$NO_BUN_INSTALL" -eq 1 ]; then
    fatal "Bun runtime not found and --no-bun-install is set. Install Bun first: https://bun.sh"
  fi

  if [ "$YES" -eq 0 ]; then
    printf "\n${YELLOW}Bun runtime is required but not found.${RESET}\n"
    printf "Install Bun now? [Y/n] "
    read -r answer </dev/tty 2>/dev/null || answer="y"
    case "$answer" in
      [nN]*) fatal "Bun is required. Install it from https://bun.sh and try again." ;;
    esac
  fi

  info "Installing Bun..."
  if command -v curl &>/dev/null; then
    curl -fsSL https://bun.sh/install | bash
  elif command -v wget &>/dev/null; then
    wget -qO- https://bun.sh/install | bash
  fi

  # Refresh PATH in-process
  export PATH="$HOME/.bun/bin:$PATH"
  find_bun
  if [ -z "$BUN_BIN" ]; then
    fatal "Bun was installed but could not be found. Add ~/.bun/bin to your PATH and try again."
  fi
  local bun_ver
  bun_ver="$("$BUN_BIN" --version 2>/dev/null || echo "unknown")"
  ok "Bun installed: $BUN_BIN (v$bun_ver)"
}

# ── Version resolution ────────────────────────────────────────────────────────
resolve_version() {
  if [ -n "$VERSION" ]; then
    info "Using pinned version: $VERSION"
    return
  fi

  info "Resolving latest version..."
  local api_url="https://api.github.com/repos/$REPO/releases/latest"
  local response
  response="$(fetch_text "$api_url" 2>/dev/null)" || {
    err "Failed to query GitHub API for latest release."
    err "This can happen due to rate limits or network issues."
    fatal "Try again later or pin a version with --version vX.Y.Z"
  }

  # Extract tag_name without jq dependency
  VERSION="$(echo "$response" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
  if [ -z "$VERSION" ]; then
    fatal "Could not parse latest version from GitHub API response. Try --version vX.Y.Z"
  fi
  ok "Latest version: $VERSION"
}

# ── Download release assets ───────────────────────────────────────────────────
download_release() {
  local release_base
  if [ -n "$BASE_URL" ]; then
    release_base="${BASE_URL%/}"
  else
    release_base="https://github.com/$REPO/releases/download/$VERSION"
  fi

  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  info "Downloading Spaceduck $VERSION..."

  local assets=("$ARTIFACT_CHECKSUMS" "$ARTIFACT_GATEWAY" "$ARTIFACT_CLI" "$ARTIFACT_MANIFEST" "$ARTIFACT_VERSION")
  for asset in "${assets[@]}"; do
    fetch "$release_base/$asset" "$tmpdir/$asset" || fatal "Failed to download $asset from $release_base/$asset"
  done

  ok "Downloaded all release assets"

  # Verify checksums
  verify_checksums "$ARTIFACT_CHECKSUMS" "$tmpdir"

  # Validate manifest
  validate_manifest "$tmpdir"

  DOWNLOAD_DIR="$tmpdir"
  # Remove the trap so we don't delete it yet
  trap - EXIT
}

# ── Manifest validation ──────────────────────────────────────────────────────
validate_manifest() {
  local dir="$1"
  local manifest_file="$dir/$ARTIFACT_MANIFEST"

  if [ ! -f "$manifest_file" ]; then
    warn "No manifest.json found; skipping manifest validation"
    return
  fi

  info "Validating manifest..."

  # Extract version from manifest (no jq dependency)
  local manifest_version
  manifest_version="$(grep '"version"' "$manifest_file" | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"

  local version_file_content
  version_file_content="$(cat "$dir/$ARTIFACT_VERSION" | tr -d '[:space:]')"

  if [ "$manifest_version" != "$version_file_content" ]; then
    fatal "Version mismatch: manifest.json says '$manifest_version' but VERSION says '$version_file_content'"
  fi

  # Check gateway artifact name
  local manifest_gateway
  manifest_gateway="$(grep '"gateway"' "$manifest_file" | head -1 | sed 's/.*"gateway"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
  if [ "$manifest_gateway" != "$ARTIFACT_GATEWAY" ]; then
    fatal "Artifact name mismatch: manifest.json gateway='$manifest_gateway', expected '$ARTIFACT_GATEWAY'"
  fi

  # Check Bun min version (warning only)
  local manifest_bun_min
  manifest_bun_min="$(grep '"minVersion"' "$manifest_file" | head -1 | sed 's/.*"minVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')" || true
  if [ -n "$manifest_bun_min" ] && [ -n "$BUN_BIN" ]; then
    local bun_ver
    bun_ver="$("$BUN_BIN" --version 2>/dev/null || echo "0.0.0")"
    if [ "$(printf '%s\n' "$manifest_bun_min" "$bun_ver" | sort -V | head -1)" != "$manifest_bun_min" ]; then
      warn "Bun $bun_ver may be too old (minimum: $manifest_bun_min). Consider upgrading: bun upgrade"
    fi
  fi

  ok "Manifest validated"
}

# ── Install files ─────────────────────────────────────────────────────────────
install_release() {
  local sd_home="$INSTALL_DIR"
  local releases_dir="$sd_home/$INSTALL_RELEASES_DIR"
  local version_dir="$releases_dir/$VERSION"
  local current_link="$sd_home/$INSTALL_CURRENT_LINK"
  local bin_dir="$sd_home/$INSTALL_BIN_DIR"
  local data_dir="$sd_home/$INSTALL_DATA_DIR"

  # Create directory structure
  mkdir -p "$version_dir" "$bin_dir" "$data_dir"

  # Copy artifacts to versioned release directory
  cp "$DOWNLOAD_DIR/$ARTIFACT_GATEWAY" "$version_dir/"
  cp "$DOWNLOAD_DIR/$ARTIFACT_CLI" "$version_dir/"
  cp "$DOWNLOAD_DIR/$ARTIFACT_VERSION" "$version_dir/"
  cp "$DOWNLOAD_DIR/$ARTIFACT_MANIFEST" "$version_dir/" 2>/dev/null || true
  cp "$DOWNLOAD_DIR/$ARTIFACT_CHECKSUMS" "$version_dir/" 2>/dev/null || true

  ok "Installed to $version_dir"

  # Atomic symlink swap
  local tmp_link="$current_link.tmp.$$"
  ln -sfn "$version_dir" "$tmp_link"
  mv -f "$tmp_link" "$current_link"
  ok "Activated version: $VERSION"

  # Clean up download dir
  rm -rf "$DOWNLOAD_DIR"

  # Write wrapper
  install_wrapper "$bin_dir" "$sd_home"
}

# ── Wrapper script ────────────────────────────────────────────────────────────
install_wrapper() {
  local bin_dir="$1" sd_home="$2"
  local wrapper="$bin_dir/spaceduck"

  cat > "$wrapper" <<'WRAPPER_EOF'
#!/usr/bin/env bash
set -euo pipefail

SD_HOME="${SPACEDUCK_HOME:-$HOME/.spaceduck}"
BUN_BIN="${BUN_BIN:-bun}"
CLI_JS="$SD_HOME/current/spaceduck-cli.js"
GATEWAY_JS="$SD_HOME/current/spaceduck-gateway.js"

if ! command -v "$BUN_BIN" &>/dev/null && [ ! -x "$HOME/.bun/bin/bun" ]; then
  echo "Error: Bun runtime not found." >&2
  echo "Re-run the installer or add ~/.bun/bin to your PATH." >&2
  exit 1
fi
if ! command -v "$BUN_BIN" &>/dev/null; then
  BUN_BIN="$HOME/.bun/bin/bun"
fi

cmd="${1:-}"

case "$cmd" in
  gateway|serve)
    shift || true
    cd "$SD_HOME"
    exec "$BUN_BIN" "$GATEWAY_JS" "$@"
    ;;
  cli)
    shift || true
    exec "$BUN_BIN" "$CLI_JS" "$@"
    ;;
  version|--version|-V)
    if [ -f "$SD_HOME/current/VERSION" ]; then
      echo "spaceduck $(cat "$SD_HOME/current/VERSION")"
    else
      echo "spaceduck (version unknown)"
    fi
    exit 0
    ;;
  ""|-h|--help|help|setup|chat|status|config|doctor|pair)
    exec "$BUN_BIN" "$CLI_JS" "$@"
    ;;
  *)
    exec "$BUN_BIN" "$CLI_JS" "$@"
    ;;
esac
WRAPPER_EOF

  chmod +x "$wrapper"
  ok "Wrapper installed: $wrapper"
}

# ── PATH configuration ────────────────────────────────────────────────────────
MARKER_START="# >>> spaceduck >>>"
MARKER_END="# <<< spaceduck <<<"

configure_path() {
  local bin_dir="$INSTALL_DIR/$INSTALL_BIN_DIR"

  # Check if already on PATH
  case ":$PATH:" in
    *":$bin_dir:"*) ok "Already on PATH"; return ;;
  esac

  local shell_name rc_file=""
  shell_name="$(basename "${SHELL:-unknown}")"

  case "$shell_name" in
    bash)
      if [ -f "$HOME/.bashrc" ]; then
        rc_file="$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then
        rc_file="$HOME/.bash_profile"
      else
        rc_file="$HOME/.bashrc"
      fi
      ;;
    zsh)
      rc_file="${ZDOTDIR:-$HOME}/.zshrc"
      ;;
    fish)
      rc_file="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
      ;;
    *)
      warn "Unknown shell: $shell_name"
      warn "Add this to your shell profile manually:"
      warn "  export PATH=\"$bin_dir:\$PATH\""
      return
      ;;
  esac

  # Check if marker block already exists
  if [ -f "$rc_file" ] && grep -qF "$MARKER_START" "$rc_file" 2>/dev/null; then
    ok "PATH already configured in $rc_file"
    return
  fi

  # Ensure rc file parent directory exists (for fish)
  mkdir -p "$(dirname "$rc_file")"

  if [ "$shell_name" = "fish" ]; then
    cat >> "$rc_file" <<EOF

$MARKER_START
fish_add_path $bin_dir
$MARKER_END
EOF
  else
    cat >> "$rc_file" <<EOF

$MARKER_START
export PATH="$bin_dir:\$PATH"
$MARKER_END
EOF
  fi

  ok "Added to PATH in $rc_file"
  PATH_RC_FILE="$rc_file"
}

# ── Post-install verification ─────────────────────────────────────────────────
post_install_check() {
  local bin_dir="$INSTALL_DIR/$INSTALL_BIN_DIR"
  local wrapper="$bin_dir/spaceduck"

  printf "\n"
  printf "${BOLD}── Spaceduck installed ──${RESET}\n\n"

  # Version check
  export PATH="$bin_dir:$PATH"
  local ver
  ver="$("$wrapper" version 2>/dev/null || echo "(could not verify)")"
  printf "  ${GREEN}✓${RESET} %s\n" "$ver"
  printf "  ${GREEN}✓${RESET} Bun: %s\n" "$BUN_BIN"
  printf "  ${GREEN}✓${RESET} Install dir: %s\n" "$INSTALL_DIR"
  printf "  ${GREEN}✓${RESET} Data dir: %s\n" "$INSTALL_DIR/$INSTALL_DATA_DIR"

  if [ -n "${PATH_RC_FILE:-}" ]; then
    printf "  ${GREEN}✓${RESET} PATH configured: %s\n" "$PATH_RC_FILE"
  fi

  # Check if this is an upgrade
  local release_count
  release_count="$(ls -1d "$INSTALL_DIR/$INSTALL_RELEASES_DIR"/*/ 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$release_count" -gt 1 ]; then
    printf "\n  ${DIM}Existing data will be migrated automatically on next gateway start.${RESET}\n"
  fi

  printf "\n${BOLD}Next steps:${RESET}\n\n"
  printf "  ${CYAN}spaceduck serve${RESET}    Start the gateway (foreground)\n"
  printf "  ${CYAN}spaceduck setup${RESET}    Interactive configuration wizard\n"
  printf "  ${CYAN}spaceduck status${RESET}   Check gateway health\n"
  printf "\n  ${DIM}Background service setup coming soon via: spaceduck service install${RESET}\n"

  if [ -n "${PATH_RC_FILE:-}" ]; then
    printf "\n  ${YELLOW}Restart your shell or run:${RESET}  source %s\n" "$PATH_RC_FILE"
  fi
  printf "\n"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  printf "\n  ${BOLD}${CYAN}🦆 Spaceduck Installer${RESET}\n\n"

  detect_platform
  detect_sha256

  # Set install dir
  if [ -z "$INSTALL_DIR" ]; then
    INSTALL_DIR="$HOME/$INSTALL_DEFAULT_DIR"
  fi

  ensure_bun
  resolve_version
  download_release
  install_release
  configure_path
  post_install_check
}

main
