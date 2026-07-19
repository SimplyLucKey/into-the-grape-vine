#!/bin/bash
# Quick start script for the backend server

cd backend

# Clear Python bytecode cache to ensure fresh code
find . -type d -name "__pycache__" -not -path "./.venv/*" -exec rm -rf {} + 2>/dev/null || true
find . -name "*.pyc" -not -path "./.venv/*" -delete 2>/dev/null || true

# Disable Python bytecode writing
export PYTHONDONTWRITEBYTECODE=1

echo "Starting Into the Grape Vine backend server..."
uv run python server.py
