# AGENTS.md

A browser extension reads Amazon Vine and order pages. A local Python server writes that data to an Excel file in Dropbox.

```markdown
Amazon page ──> extension (shared/*.js) ──HTTP──> backend/server.py ──> Dropbox Excel file
                                                    localhost:8000
```

## How to write

These rules apply to replies, docs, comments, and docstrings.

- Use simple English. Short sentences. Common words. Active voice.
- Put the answer first. If more detail helps, add it after.
- Make it easy to scan: short sections, bullets, tables.
- Show, then tell. If a diagram, table, or before/after example is clearer than prose, use it:

  ```markdown
  Before: 07/09/2026      After: 7/9/2026
  ```

- If possible, keep comments and docstrings to one line. Say what the code does, not the story of how it got there.

## Repo rules

- **Edit `shared/`, never `chrome/` or `firefox/`.** Those `.js`/`.html` files are copies. Run `./build.sh` after each change to `shared/`, then reload the extension.
- **Start the server with `./start-server.sh`.** It stops the old server, clears the Python cache, then starts a fresh one. Use it after every backend change.
- **Dates are strings in `M/D/YYYY` form** (`7/9/2026`, no leading zeros). Excel rejects time zones, and the owner wants plain text dates.
- **Keep row order.** New Vine rows are sorted by `order_timestamp` (epoch ms). Many orders can share one day, so the date string alone loses their order.
- **Dropbox rate limits are strict.** The Dropbox app is in development status, so uploads often fail for a long time. `@retry_dropbox()` in `backend/dropbox_utils.py` handles retries. The SDK's own retries are off (`max_retries_on_*=0` in `dropbox_auth.py`) so two retry layers never stack.
- **Ctrl+C must stop the server fast.** Long waits sleep in 1-second steps so the interrupt gets through.
- **Dry run means "do everything except upload."** Fetch and compute real results, log them, and skip only the Dropbox write.
- **Python packages come from public PyPI.** `backend/pyproject.toml` sets the index so `uv.lock` works on any machine.
