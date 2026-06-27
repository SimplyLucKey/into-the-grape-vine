#!/bin/bash
# Copies all shared files into each browser folder.
# Run this after any change to shared/ before loading the extension.

cp shared/*.{js,html} chrome/
cp shared/*.{js,html} firefox/

echo "Build complete."
