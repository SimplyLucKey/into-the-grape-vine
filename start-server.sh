#!/bin/bash
# Start/restart the backend server with clean state

set -e

echo "🔄 Starting Into the Grape Vine backend server..."
echo ""

# 1. Kill any running servers
echo "1️⃣  Stopping any running servers..."
pkill -9 -f "server.py" 2>/dev/null || true
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
sleep 1

if lsof -i :8000 >/dev/null 2>&1; then
    echo "   ❌ Failed to stop server on port 8000"
    exit 1
fi
echo "   ✅ Port 8000 clear"
echo ""

# 2. Clear Python bytecode cache
echo "2️⃣  Clearing Python bytecode cache..."
cd backend
rm -rf __pycache__ 2>/dev/null || true
find . -type d -name "__pycache__" -not -path "./.venv/*" -not -path "*/.venv/*" -exec rm -rf {} + 2>/dev/null || true
find . -name "*.pyc" -not -path "./.venv/*" -not -path "*/.venv/*" -delete 2>/dev/null || true
echo "   ✅ Cache cleared"
echo ""

# 3. Start server with bytecode caching disabled
echo "3️⃣  Starting server..."
export PYTHONDONTWRITEBYTECODE=1

echo ""
echo "▶️  Server running on http://localhost:8000"
echo "   Press Ctrl+C to stop"
echo ""

uv run python server.py
