#!/usr/bin/env bash

set -euo pipefail

SWAP_SIZE_GB="${SWAP_SIZE_GB:-4}"
SWAPFILE_PATH="${SWAPFILE_PATH:-/swapfile}"
SWAPPINESS="${SWAPPINESS:-10}"

usage() {
  cat <<'EOF'
Usage:
  sudo ./scripts/setup-server.sh [--swap-size-gb N] [--swapfile-path PATH] [--swappiness N]

Examples:
  sudo ./scripts/setup-server.sh
  sudo ./scripts/setup-server.sh --swap-size-gb 4
  SWAP_SIZE_GB=6 sudo ./scripts/setup-server.sh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --swap-size-gb)
      SWAP_SIZE_GB="$2"
      shift 2
      ;;
    --swapfile-path)
      SWAPFILE_PATH="$2"
      shift 2
      ;;
    --swappiness)
      SWAPPINESS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root or via sudo." >&2
  exit 1
fi

if ! [[ "${SWAP_SIZE_GB}" =~ ^[0-9]+$ ]] || [[ "${SWAP_SIZE_GB}" -lt 1 ]]; then
  echo "SWAP_SIZE_GB must be a positive integer." >&2
  exit 1
fi

if ! [[ "${SWAPPINESS}" =~ ^[0-9]+$ ]] || [[ "${SWAPPINESS}" -lt 0 ]] || [[ "${SWAPPINESS}" -gt 100 ]]; then
  echo "SWAPPINESS must be an integer from 0 to 100." >&2
  exit 1
fi

SIZE_BYTES="${SWAP_SIZE_GB}G"

if swapon --show=NAME --noheadings | grep -Fxq "${SWAPFILE_PATH}"; then
  swapoff "${SWAPFILE_PATH}"
fi

rm -f "${SWAPFILE_PATH}"
fallocate -l "${SIZE_BYTES}" "${SWAPFILE_PATH}"
chmod 600 "${SWAPFILE_PATH}"
mkswap "${SWAPFILE_PATH}" >/dev/null
swapon "${SWAPFILE_PATH}"

if grep -qE "^[^#]*[[:space:]]${SWAPFILE_PATH//\//\\/}[[:space:]]" /etc/fstab; then
  sed -i.bak "\|${SWAPFILE_PATH}|c\\${SWAPFILE_PATH} none swap sw 0 0" /etc/fstab
else
  echo "${SWAPFILE_PATH} none swap sw 0 0" >> /etc/fstab
fi

cat >/etc/sysctl.d/99-crm-ai-swap.conf <<EOF
vm.swappiness=${SWAPPINESS}
vm.vfs_cache_pressure=50
EOF

sysctl --system >/dev/null

echo "Swap configured:"
swapon --show
free -h
