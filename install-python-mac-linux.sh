#!/bin/bash
echo "============================================"
echo "  Installing Python 3 (Mac / Linux)"
echo "============================================"
echo ""

for cmd in python3 python; do
  if command -v "$cmd" &>/dev/null; then
    VER=$("$cmd" --version 2>&1)
    if [[ "$VER" == *"Python 3"* ]]; then
      echo "Python is already installed: $VER"
      echo "Nothing to do."
      exit 0
    fi
  fi
done

echo "Python was not found. Attempting to install it now..."
echo ""

OS_NAME=$(uname -s)

if [ "$OS_NAME" == "Darwin" ]; then
  if command -v brew &>/dev/null; then
    echo "Using Homebrew to install Python 3..."
    brew install python3
  else
    echo "Homebrew isn't installed, so opening the official Python download"
    echo "page instead. Download and run the macOS installer (.pkg) from there."
    open "https://www.python.org/downloads/macos/" 2>/dev/null \
      || echo "Visit: https://www.python.org/downloads/macos/"
  fi
elif [ "$OS_NAME" == "Linux" ]; then
  if command -v apt-get &>/dev/null; then
    echo "Using apt to install Python 3 (you may be asked for your password)..."
    sudo apt-get update && sudo apt-get install -y python3
  elif command -v dnf &>/dev/null; then
    echo "Using dnf to install Python 3 (you may be asked for your password)..."
    sudo dnf install -y python3
  elif command -v yum &>/dev/null; then
    echo "Using yum to install Python 3 (you may be asked for your password)..."
    sudo yum install -y python3
  elif command -v pacman &>/dev/null; then
    echo "Using pacman to install Python 3 (you may be asked for your password)..."
    sudo pacman -Sy --noconfirm python3
  else
    echo "Could not detect a package manager on this system."
    echo "Please install Python 3 manually from: https://www.python.org/downloads/"
  fi
else
  echo "Unrecognized system ($OS_NAME)."
  echo "Please install Python 3 manually from: https://www.python.org/downloads/"
fi

echo ""
echo "Once done, run ./check-prerequisites-mac-linux.sh again to confirm."
read -p "Press Enter to close..."
