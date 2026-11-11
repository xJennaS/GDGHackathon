# GDGHackathon
The web, without the browsing.

Tabless is a Chrome Manifest V3 extension that replaces the New Tab page with an intent-driven workspace. Instead of opening tabs, navigating sites and switching between apps, you say what you want done. A Gemini-powered agent, running on Google Cloud (Vertex AI), uses a small set of authorized browser tools to gather the information, then renders a clean, task-specific interface. The original pages stay one click away.

The agent's tabs open in a collapsed "Tabless" tab group. Reads happen automatically. Anything that writes needs your Approve click.

- `extension/`: Chrome MV3 extension (Vite, React, TypeScript, Tailwind). The agent loop runs in the New Tab page.
- `backend/`: one stateless Express file that adds the system instruction and tool declarations and calls Gemini on Vertex AI.

## Run the backend

You need Node 22.9 or newer, a Google Cloud project with the Vertex AI API enabled, and Application Default Credentials.

```sh
gcloud auth application-default login
gcloud services enable aiplatform.googleapis.com --project YOUR_PROJECT_ID

cd backend
npm install
cp .env.example .env    # then set GOOGLE_CLOUD_PROJECT and GEMINI_MODEL
npm start
```

Check it: `curl http://localhost:8080/health` returns `{"ok":true,...}`.

| Variable | Required | Meaning |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | yes | Project that runs Vertex AI |
| `GEMINI_MODEL` | yes | Gemini model id on Vertex AI |
| `GOOGLE_CLOUD_LOCATION` | no | Defaults to `global` |
| `DEMO_TOKEN` | no | If set, requests must send the same value in `x-demo-token` |
| `PORT` | no | Defaults to `8080` |

## Build and load the extension

```sh
cd extension
npm install
npm run build      # or: npm run dev, which rebuilds on every change
```

1. Open `chrome://extensions` and turn on Developer mode.
2. Click "Load unpacked" and pick `extension/dist`.
3. Sign in to Gmail and Google Calendar in the same Chrome profile.
4. Open a new tab. If Chrome asks whether to keep the new tab page, keep it.

The backend URL is a field under the activity log and defaults to `http://localhost:8080`. If the backend uses `DEMO_TOKEN`, put `VITE_DEMO_TOKEN=the-same-value` in `extension/.env.local` and rebuild. To change the default backend URL at build time, set `VITE_BACKEND_URL` in the same file.

## Try it

1. "Read me my latest email."
2. "She's asking to meet Thursday. Am I free? If so, say yes and put it on my calendar."
3. "What's on Hacker News about AI today? Compare the top 3."

## Deploy the backend to Cloud Run

Run from the repo root. The service account that Cloud Run uses needs the Vertex AI User role (`roles/aiplatform.user`).

```sh
gcloud run deploy tabless-backend \
  --source backend \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=YOUR_MODEL_ID,DEMO_TOKEN=YOUR_DEMO_TOKEN
```

Then paste the service URL into the extension's Backend URL field.

## How it stays honest

- Cards show only what a tool returned. An email card is rebuilt in code from the text the Gmail tool read, and is labelled "Preview" when only the inbox snippet was read.
- A write never happens by itself. `propose_action` only creates a pending approval. The Gmail compose or Calendar event page opens from your Approve click, once per approval, and the card then says "Opened in Gmail: review and send", never "Sent".
- Page and email text is treated as data. It is wrapped in delimiters before Gemini sees it and is never executed or rendered as HTML.
- No keys live in the repo or the extension. The backend uses Application Default Credentials.

## Known limits

- Gmail and Calendar are read from their pages, not their APIs. The Gmail selectors are in `extension/src/adapters/gmail-selectors.ts`; if Gmail changes its page, fix them there.
- Opening an email to read it marks it as read in Gmail.
- The calendar card is based on the events visible in the day view. It does not verify that you are free.
- Chrome keeps the cursor in the address bar on a new tab, so click the input or press Tab before typing.
