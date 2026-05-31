# kie.ai connector for Claude — setup guide

This puts a kie.ai connector online so you can chat with Claude on **claude.ai**
(where your memory and projects live) and have it generate images & videos with
kie.ai — exactly like the higgsfield connector, but kie.ai.

You'll do this once. ~20–30 minutes. Three phases: GitHub → Render → Claude.

Files in this folder:
- `server.js`   — the connector (don't edit)
- `package.json`

Your private values (keep these handy):
- **MCP_SECRET:** `104a4b949d290a870d9921b54e00bf6f8372`
- **KIE_API_KEY:** your kie.ai key from https://kie.ai/api-key

---

## Phase 1 — Put the code on GitHub (browser only)

1. Go to https://github.com and sign in (or make a free account).
2. Click **+** (top right) → **New repository**.
3. Name it `kie-mcp`, set it to **Private**, click **Create repository**.
4. On the new repo page, click **uploading an existing file**.
5. Drag in **both** `server.js` and `package.json`, then click **Commit changes**.

Done — your code is on GitHub.

## Phase 2 — Deploy it on Render (browser only, free)

1. Go to https://render.com and **Sign up with GitHub** (easiest).
2. Click **New +** → **Web Service**.
3. Connect / pick your `kie-mcp` repo → **Connect**.
4. Render auto-detects Node. Confirm:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
5. Scroll to **Environment Variables** → **Add Environment Variable**, add two:
   - `KIE_API_KEY` = your kie.ai key
   - `MCP_SECRET`  = `104a4b949d290a870d9921b54e00bf6f8372`
6. Click **Create Web Service** and wait ~2–3 min for "Live".
7. Copy your service URL at the top — looks like `https://kie-mcp-xxxx.onrender.com`.
8. Test it: open that URL in a browser. You should see
   *"kie.ai MCP server is running."*

Your **connector URL** is that address plus your secret and `/mcp`:
```
https://kie-mcp-xxxx.onrender.com/104a4b949d290a870d9921b54e00bf6f8372/mcp
```

## Phase 3 — Add it to Claude (claude.ai)

1. On claude.ai: **Settings → Connectors → Add custom connector** (the **+**).
2. **Name:** `kie.ai`   **URL:** paste your connector URL from above.
3. Click **Add**.
4. In any chat, click the **+** near the message box and enable **kie.ai**.
5. Try it: *"Use kie.ai to list the models"*, then *"generate a 9:16 image of a neon ramen shop."*

That's it. In your ad-production project, Claude now has your memory **and** kie.ai.

---

### Tools Claude gets
- `list_models` — exact kie.ai model ids + input fields (the catalog below).
- `create_task` — start any generation (image or video). Returns a task_id.
- `check_status` — poll a task_id; returns the image/video URL when done.

Claude calls create_task, then checks status a few times until it's ready — that
back-and-forth is why it never times out.

### Verified models in the catalog
- `nano-banana-2` — **Nano Banana Pro** (image / image-to-image; `image_input`, `resolution` 1K/2K/4K)
- `gpt-image-2-text-to-image` — GPT Image 2 (image)
- `kling-3.0/video` — **Kling 3.0** (video; `mode`, `duration`, `multi_shots`, `kling_elements`)
- `bytedance/seedance-1.5-pro` — **Seedance 1.5 Pro** (video; `input_urls`, `resolution`, `duration`)
- `bytedance/seedance-2` — Seedance 2.0 (video)

**Any other kie.ai model id also works** — just tell Claude the model and it'll pass
it to create_task. The catalog is only the documented shortlist.

### Notes
- **Free tier sleeps.** After ~15 min idle, Render's free server naps; the first
  request wakes it (~30–60s), then it's fast. If that delay bugs you, switch the
  Render instance to a paid always-on tier (~$7/mo).
- **Keep the secret private.** Anyone with the full connector URL can spend your
  kie.ai credits. To rotate it, change `MCP_SECRET` in Render's env vars and
  update the URL in Claude.
- **VEO 3.1** uses a different kie.ai endpoint, so it's not in the catalog yet —
  easy to add if you want it.
