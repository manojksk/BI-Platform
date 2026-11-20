#!/bin/bash
cd "$(dirname "$0")"
echo "============================================"
echo "  Salon Manager - Server"
echo "============================================"
echo ""

if command -v python3 &>/dev/null; then
  PYCMD=python3
elif command -v python &>/dev/null; then
  PYCMD=python
else
  echo "Python was not found on this computer."
  echo "Run ./install-python-mac-linux.sh first, then run this script again."
  read -p "Press Enter to close..."
  exit 1
fi

echo "Starting the server using $PYCMD ..."
echo ""
echo "On THIS computer, open Chrome and go to:"
echo "    http://localhost:8765/"
echo ""
echo "For your phone, your wife's phone, or your manager's phone to reach"
echo "this same app, see the 'Access From Anywhere (Tailscale)' section in"
echo "README.md -- you only need to set that up once."
echo ""
echo "Keep this Terminal window open the whole time the salon is using the"
echo "app. Closing it stops the server for everyone. Your data is safe"
echo "either way. Press Ctrl+C to stop."
echo "============================================"
echo ""
$PYCMD server.py --port 8765
