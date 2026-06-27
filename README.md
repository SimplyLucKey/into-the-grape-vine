# 🍇 Into the Grape Vine

Come explore into the grape vine in the Amazons. A personal browser extension that captures your Amazon Vine order history and syncs it to your Dropbox — with optional LLM-generated reviews trained on your own writing style.

---

## Structure

```
into-the-grape-vine/
├── shared/             # Edit these — source of truth for the extension
│   ├── vine-orders.js       # Scrapes /vine/orders page
│   ├── account-orders.js    # Scrapes /order-history page
│   ├── utils.js             # Shared utility functions
│   ├── dropbox-sync.js      # One-click Dropbox sync
│   ├── background.js        # Extension background service
│   ├── popup.html
│   └── popup.js
├── chrome/
│   └── manifest.json
├── firefox/
│   └── manifest.json
├── backend/
│   ├── dropbox_auth.py
│   ├── dropbox_upsert.py
│   ├── dropbox_utils.py
│   ├── pyproject.toml
│   └── .env.template
├── build.sh
└── README.md
```

Only `manifest.json` differs per browser. All extension logic lives in `shared/`.

---

## Extension setup

**1. Build**

Run after cloning, and again after any change to `shared/`:

```bash
chmod +x build.sh
./build.sh
```

**2. Install on Chrome**

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `chrome/` folder

**3. Install on Zen (Firefox)**

1. Go to `about:debugging` → **This Firefox**
2. Click **Load Temporary Add-on…** → select `firefox/manifest.json`

> Temporary add-ons are removed when the browser closes. For a persistent install without publishing to the store, use Firefox Developer Edition with `xpinstall.signatures.required` set to `false` in `about:config`.

---

## Extension usage

### Capturing Vine orders

1. Go to [amazon.com/vine/orders](https://www.amazon.com/vine/orders) while logged in
2. Click the 🍇 icon → **Extract Vine Orders**
3. Paginate and repeat — duplicates are skipped automatically

### Capturing Account orders

1. Go to [amazon.com/your-orders](https://www.amazon.com/your-orders) while logged in
2. Click the 🍇 icon → **Extract Account Orders**
3. Paginate through all pages to capture delivery dates
4. Click **Export JSON** to download the data
5. Run the sync script (see below) to update your spreadsheet

Open DevTools (F12) → Console for `[Into the Grape Vine]` log output if something looks off.

---

## Dropbox setup (one-time)

**1. Create a Dropbox app**

Go to [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) → **Create app**
- API: Scoped access
- Access type: Full Dropbox
- Name: anything

**2. Set permissions**

In your app → **Permissions** tab, enable:
- `files.content.read`
- `files.content.write`

Click **Submit**. Do this before generating tokens.

**3. Get App key and App secret**

Settings tab → copy both values.

**4. Generate your refresh token**

Paste this in your browser (replace `YOUR_APP_KEY`):

```
https://www.dropbox.com/oauth2/authorize?client_id=YOUR_APP_KEY&token_access_type=offline&response_type=code
```

Authorize → copy the authorization code Dropbox shows you (expires in minutes).

Then run in terminal:

```bash
curl https://api.dropbox.com/oauth2/token \
  -d code=YOUR_AUTHORIZATION_CODE \
  -d grant_type=authorization_code \
  -u YOUR_APP_KEY:YOUR_APP_SECRET
```

Copy the `refresh_token` from the JSON response. This doesn't expire.

**5. Create your `.env`**

```bash
cd backend
cp .env.template .env
```

Fill in:
```
DROPBOX_APP_KEY=your_app_key
DROPBOX_APP_SECRET=your_app_secret
DROPBOX_REFRESH_TOKEN=your_refresh_token
DROPBOX_FILE_PATH=/path/to/your/spreadsheet.xlsx
```

`DROPBOX_FILE_PATH` is relative to your Dropbox root, e.g. `/Vine/vine_orders.xlsx`.

**6. Install dependencies and verify**

```bash
cd backend
uv sync
uv run python dropbox_file.py
```

If you don't have uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`

A successful run prints your account name, then the column headers and first 5 rows of your spreadsheet.

---

## Syncing delivery dates

The extension calls a Python backend server to sync data (keeps credentials secure).

**1. Start the backend server**

```bash
./start-server.sh
```

Or manually:
```bash
cd backend
uv sync  # First time only, installs dependencies
uv run python server.py
```

Server starts on <http://localhost:8000>

Keep this terminal window open while using the extension.

**2. Extract account orders**

Go to [amazon.com/order-history](https://www.amazon.com/gp/css/order-history) and:
- Click **Extract Account Orders**
- Paginate through all pages to capture delivery dates

**3. Sync (with safety preview)**

Two buttons available:

**🔍 Preview Changes** (Dry-Run)
- Shows exactly what would be changed
- Doesn't modify your Excel file
- Check console (F12) for detailed list of changes

**🔄 Sync to Dropbox** (Real Sync)
- Actually updates your Excel file
- Use after verifying the preview

The extension will:
- Send account orders to your local backend
- Backend downloads Excel file from Dropbox
- Matches items by ASIN (extracted from URL column)
- Fills blank `delivered_date` cells for delivered items
- Uploads updated file back to Dropbox (unless dry-run)
- Shows how many dates were filled

**Notes:**
- Backend server must be running (localhost:8000)
- Only updates rows where `delivered_date` is currently blank
- Skips rows that already have a delivery date
- Warns about cancelled items (delete manually from spreadsheet)
- Your Dropbox credentials stay secure in `.env` file
- **Always preview first!** Use dry-run mode before actual sync

---

## Fetching prices automatically

**One-Click Workflow:**

Click **💰 Fetch Prices** in the extension popup.

The backend will:
- Read your Excel file
- Find all items missing prices (within your configured time window)
- Fetch each product page from Amazon automatically
- Parse the current price
- Update the price column (or mark as -1 if failed)
- Upload back to Dropbox

**Smart Guardrails:**

Customize two settings in the popup to prevent wasting time on old/unavailable products:

- **Days back**: Only fetch prices for orders from the last X days (enter any number)
  - Default: 14 days
  - Old products often have no listing anymore
- **Max items**: Limit how many items to fetch per run
  - Default: 50 items
  - Prevents long-running fetches

**Failed items are marked as -1** to skip them on future runs, so your list doesn't grow forever.

**Safety:**
- Click **🔍 Preview** first to see how many items need prices
- Adds ~1.5 second delay between requests (respectful to Amazon)
- Logs detailed progress in backend terminal

**Note:** Amazon may occasionally block requests if too many are made. The backend handles this gracefully and will log which items failed.

---

## .gitignore reminder

Make sure `backend/.env` is in your `.gitignore` — never commit credentials.
