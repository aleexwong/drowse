# Deploying Drowse Layer 0

Target: a remote MCP server the phone's Claude app can reach (PRD §11). Roughly
20 minutes end to end.

## 1. Generate the token

```bash
openssl rand -hex 32
```

Single user, one long-lived token, no OAuth flow. Keep it in a password manager.
It is the only thing standing between the internet and the journal.

## 2. Firestore

```bash
gcloud firestore databases create --location=nam5      # or your region
gcloud firestore deploy --rules firestore.rules        # via firebase CLI if you use it
```

`firestore.rules` denies every client read and write. The MCP server writes with
the Admin SDK, which bypasses rules, so that denial costs nothing and closes the
browser/phone path completely. Deploy the rules **before** anything else goes up.

## 3. Deploy to Cloud Run

```bash
gcloud run deploy drowse \
  --source . \
  --region us-west1 \
  --allow-unauthenticated \
  --set-env-vars "DROWSE_TIMEZONE=America/Vancouver,DROWSE_DEFAULT_PHASE=baseline,GOOGLE_CLOUD_PROJECT=$(gcloud config get-value project)" \
  --set-secrets "DROWSE_TOKEN=drowse-token:latest"
```

`--allow-unauthenticated` puts Google's IAM layer aside; the app's own token
check is the gate. Create the secret first:

```bash
printf '%s' "$YOUR_TOKEN" | gcloud secrets create drowse-token --data-file=-
```

Give the Cloud Run service account `roles/datastore.user` and
`roles/secretmanager.secretAccessor`.

Fly.io or any container host works the same way — one HTTPS origin, the two env
vars, and the secret.

## 4. Check it

```bash
curl https://drowse-xxxx.run.app/healthz
# {"ok":true,"server":"drowse","version":"0.1.0"}
```

## 5. Add the connector in Claude

Settings → Connectors → **Add custom connector**, with the URL:

```
https://drowse-xxxx.run.app/mcp/<YOUR_TOKEN>
```

**Why the token is in the URL.** The custom-connector UI only offers OAuth client
id and secret — there is no field for a bearer token. Putting the token in the
path is the standard single-user workaround. The server also accepts
`Authorization: Bearer` and `x-api-key`, so if header auth appears in the UI later,
switch to `https://drowse-xxxx.run.app/mcp` and drop the token from the URL.

Consequence: **the whole URL is a secret.** Do not paste it into a chat, a
screenshot, or an issue. To rotate, change `DROWSE_TOKEN` and re-add the connector.

Then create the Claude Project and paste in
[`claude-project-instructions.md`](./claude-project-instructions.md).

## 6. Back up from day one

```bash
GOOGLE_CLOUD_PROJECT=your-project npm run export -- --out exports/drowse-$(date +%F).json
```

Or from the phone/browser: `https://drowse-xxxx.run.app/export/<YOUR_TOKEN>`.

Firebase is not a backup. Losing the corpus is the worst realistic failure, and
it gets worse every month (PRD §11).

## Privacy, before the corpus gets big

Daily voice journals are the most sensitive data this project will ever hold.
Decide **now** whether Google is where you want it — moving 200 transcripts is
easy, moving two years of them is not. `TranscriptStore` is a two-method
interface (`src/store/types.ts`), so a different backend is a new file, not a
rewrite.
