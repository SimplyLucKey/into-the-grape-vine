# 🍇 Into the Grape Vine
Come explore into the grape vine in the Amazons. A personal browser extension that captures your Amazon Vine order history and syncs it to your Dropbox — with optional LLM-generated reviews trained on your own writing style.

---

## Data extraction foundation

- **Content script** (`content.js`) — runs automatically on `amazon.com/vine/orders` while you're logged in. Reads each row of the Vine orders table and extracts:
  - Product name
  - ASIN
  - Product URL
  - Order date
  - Fair Market Value (FMV)
  - Order ID

  No login automation, no navigation — it reads what is already on screen in your active session.

- **Background script** (`background.js`) — receives the extracted data, deduplicates by order ID, sorts newest-first, and stores everything in the browser's local storage. Acts as a queue for later phases.

- **Popup UI** (`popup.html` / `popup.js`) — the panel that opens when you click the extension icon. Shows all captured orders with thumbnails, FMV, and dates. Includes a manual "Extract this page" button and a "Clear queue" button.

Two builds are included:
- `chrome/` — Manifest V3, for Chrome and any Chromium-based browser
- `firefox/` — Manifest V2, for Firefox and Zen browser

The logic in `content.js`, `background.js`, `popup.html`, and `popup.js` is **identical** between both builds. Only the `manifest.json` differs.

---

## How to install

### Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `chrome/` folder from this repo
5. The 🍇 icon will appear in your toolbar

### Zen (Firefox)

1. Open Zen and go to `about:debugging`
2. Click **This Firefox** in the left sidebar
3. Click **Load Temporary Add-on…**
4. Navigate into the `firefox/` folder and select `manifest.json`
5. The extension is now active for this session

> **Note:** Firefox's "Load Temporary Add-on" only lasts until the browser is closed. For a permanent install without publishing to the Firefox Add-on Store, you need Firefox Developer Edition or Nightly with `xpinstall.signatures.required` set to `false` in `about:config`.

---

## How to test it

1. Install the extension on Chrome using the steps above
2. Go to [amazon.com/vine/orders](https://www.amazon.com/vine/orders) while logged in to your Vine account
3. Wait for the page to fully load (all rows should be visible)
4. Click the 🍇 extension icon in your toolbar
5. Click **Extract this page**
6. You should see your 10 most recent Vine orders listed with thumbnails, FMV amounts, and dates

**To capture more orders:**
- The Vine orders page shows 10 orders per page
- Extract the current page, then click "Next" in the pagination, wait for it to load, and extract again
- The background script deduplicates automatically — re-extracting a page you already captured will not create duplicates

**To verify extraction is working under the hood:**
- Open DevTools (F12) while on the orders page
- Go to the **Console** tab
- Look for `[Into the Grape Vine]` log lines — they will show how many orders were found and whether any were skipped as duplicates

**If fields come back missing:**
- Open DevTools → Elements tab → Ctrl+F
- Search for `vvp-orders-table--row` to confirm the selector still exists
- If Amazon has changed their markup, the relevant selectors are documented in `content.js` with instructions on how to update them

---

## Project structure

```
into-the-grape-vine/
├── chrome/
│   ├── manifest.json       # Chrome Manifest V3 config
│   ├── content.js          # DOM extraction (runs on Vine orders page)
│   ├── background.js       # Storage and deduplication
│   ├── popup.html          # Extension popup UI
│   └── popup.js            # Popup logic
├── firefox/
│   ├── manifest.json       # Firefox Manifest V2 config
│   ├── content.js          # (identical to chrome/)
│   ├── background.js       # (identical to chrome/)
│   ├── popup.html          # (identical to chrome/)
│   └── popup.js            # (identical to chrome/)
└── README.md
```

---

## Roadmap

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Data extraction from Vine orders page | ✅ Complete |
| 2 | Popup UI polish, pagination helper | 🔜 Next |
| 3 | Python backend + Dropbox Excel sync | 🔜 Planned |
| 4 | Daily/weekly auto-scheduler | 🔜 Planned |
| 5 | LLM review generation (trained on your past reviews) | 🔜 Planned |
| 6 | Firefox/Zen verification and polish | 🔜 Planned |
