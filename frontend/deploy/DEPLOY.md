# Frontend production deploy (holderforge.io)

## Why the site is blank on other machines

If the browser console shows:

`Failed to load module script ... main.tsx ... MIME type application/octet-stream`

the server is serving **source files** (`index.html` with `/src/main.tsx`), not the **production build**.

- `npm run dev` works locally (Vite compiles TS on the fly).
- Production must serve the **`dist/`** folder after `npm run build`.

## Correct deploy steps

```bash
cd AVG_Frontend   # repo root containing package.json
npm ci
npm run build     # creates dist/ with /assets/index-*.js
```

Deploy **only** the contents of `dist/` to the web root (not the whole repo).

Verify `dist/index.html` contains:

```html
<script type="module" crossorigin src="/assets/index-xxxxx.js"></script>
```

It must **not** contain `/src/main.tsx`.

## Nginx (EC2)

See [nginx.conf.example](./nginx.conf.example). Point `root` at `dist/`.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Apache

`.htaccess` is copied into `dist/` from `public/` on build (MIME + SPA routing).

## AWS S3 + CloudFront

```bash
aws s3 sync dist/ s3://YOUR_BUCKET --delete \
  --exclude "*" \
  --include "*.html" --content-type "text/html" \
  --include "*.js" --content-type "application/javascript" \
  --include "*.css" --content-type "text/css" \
  --include "*.png" --content-type "image/png" \
  --include "*.svg" --content-type "image/svg+xml"

aws s3 sync dist/assets/ s3://YOUR_BUCKET/assets/ --delete \
  --content-type "application/javascript" \
  --exclude "*.css" \
  --include "*.css" --content-type "text/css"
```

CloudFront: default root object `index.html`, custom error 403/404 → `/index.html` (SPA).

## Environment

Set `VITE_API_URL` at **build time** (e.g. `https://your-api.railway.app`) in CI or `.env.production`.
