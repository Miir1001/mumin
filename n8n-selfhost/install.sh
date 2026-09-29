#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu server: installs Docker and starts n8n.
set -euo pipefail
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
cd "$(dirname "$0")"
sudo docker compose up -d
echo "n8n is running. On your own computer run:"
echo "  ssh -L 5678:localhost:5678 $USER@<server-ip>"
echo "then open http://localhost:5678"
