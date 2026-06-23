#!/bin/bash
# Copies shared files into each browser folder.
# Run this after any change to shared/ before loading the extension.

cp shared/content.js chrome/
cp shared/background.js chrome/
cp shared/popup.html chrome/
cp shared/popup.js chrome/

cp shared/content.js firefox/
cp shared/background.js firefox/
cp shared/popup.html firefox/
cp shared/popup.js firefox/

echo "Build complete."
