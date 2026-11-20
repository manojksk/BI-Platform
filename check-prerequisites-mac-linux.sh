#!/bin/bash
cd "$(dirname "$0")"
echo "============================================"
echo "  Salon Manager - Prerequisite Check"
echo "============================================"
echo ""
echo "Note: no pip or npm packages are needed. The server is a single"
echo "Python file using only its standard library, and the app is a single"
echo "bundled HTML file. This checks the real requirements: Python (to run"
echo "the server) and, if you want phones to reach it from outside the"
echo "salon, Tailscale."
echo ""

ALL_GOOD=1
MISSING=""

# 1. Python check
echo "[1/3] Checking for Python 3..."
PYCMD=""
for cmd in python3 python; do
  if command -v "$cmd" &>/dev/null; then
    VER=$("$cmd" --version 2>&1)
    if [[ "$VER" == *"Python 3"* ]]; then
      PYCMD="$cmd"
      echo "  OK: Found $VER (command: $cmd)"
      break
    fi
  fi
done
if [ -z "$PYCMD" ]; then
  echo "  MISSING: Python 3 was not found."
  echo "  Fix: run ./install-python-mac-linux.sh in this same folder."
  ALL_GOOD=0
  MISSING="$MISSING Python3"
fi
echo ""

# 2. App files + port check
echo "[2/3] Checking the app files and port 8765..."
if [ -f "server.py" ]; then
  echo "  OK: server.py found."
else
  echo "  MISSING: server.py is not in this folder."
  ALL_GOOD=0
  MISSING="$MISSING server.py"
fi
if [ -f "salon-manager-remote.html" ]; then
  echo "  OK: salon-manager-remote.html found."
else
  echo "  MISSING: salon-manager-remote.html is not in this folder."
  ALL_GOOD=0
  MISSING="$MISSING salon-manager-remote.html"
fi
if command -v lsof &>/dev/null && lsof -i :8765 &>/dev/null; then
  echo "  NOTE: Port 8765 is currently in use by something else."
  echo "  Only a problem if the server fails to start -- if so, use a"
  echo "  different port, e.g.: python3 server.py --port 8766"
else
  echo "  OK: Port 8765 is free (or could not be checked, which is fine)."
fi
echo ""

# 3. Tailscale check
echo "[3/3] Checking for Tailscale (needed for phone access from anywhere)..."
if command -v tailscale &>/dev/null || [ -d "/Applications/Tailscale.app" ]; then
  echo "  OK: Tailscale is installed."
  tailscale status 2>/dev/null | head -5
else
  echo "  Not installed yet."
  echo "  This is only required if you want phones to reach the app from"
  echo "  outside the salon's WiFi. See README.md -> 'Access From Anywhere"
  echo "  (Tailscale)' for the install steps."
fi
echo ""

echo "============================================"
if [ "$ALL_GOOD" -eq 1 ]; then
  echo "All required prerequisites are met."
  echo "You're ready to run start-server-mac-linux.sh"
else
  echo "MISSING:$MISSING"
  echo "Resolve the item(s) above, then run this check again."
fi
echo "============================================"
read -p "Press Enter to close..."
