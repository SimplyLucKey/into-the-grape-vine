# 🍇 Into the Grape Vine

Come explore into the grape vine in the Amazons. A personal browser extension that captures your Amazon Vine order history and syncs it to your Dropbox — with optional LLM-generated reviews trained on your own writing style.

---

## Structure

```
into-the-grape-vine/
├── shared/             # Edit these — source of truth for the extension
│   ├── content.js
│   ├── background.js
│   ├── popup.html
│   └── popup.js
├── chrome/
│   └── manifest.json
├── firefox/
│   └── manifest.json
├── backend/
│   ├── dropbox_auth.py
│   ├── dropbox_file.py
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

1. Go to [amazon.com/vine/orders](https://www.amazon.com/vine/orders) while logged in
2. Click the 🍇 icon → **Extract this page**
3. Paginate and repeat — duplicates are skipped automatically

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

## .gitignore reminder

Make sure `backend/.env` is in your `.gitignore` — never commit credentials.
