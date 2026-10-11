# Budget (v1)

Plain HTML/CSS/JS PWA. No build step, no dependencies. Sign in with Google (or an invite code); your budget is cached in localStorage and saved, encrypted, to your account on the sync Worker so it appears on any device. Works offline and syncs when back online.

## Run locally
    python3 -m http.server 8765   # then open http://localhost:8765

## Install on Android
The app must be served over HTTPS. Open the URL in Chrome, then use the menu and choose **Add to Home screen / Install app**. After the first load it works offline.

## Updating
After changing any file, bump `VERSION` in `sw.js` so phones pick up the new files. Re-open the app twice to get the update.

## Optional bank sync (v2)
More → Advanced → Bank sync, after signing in. Uses the built-in sync Worker and Plaid. The phone never stores bank logins or Plaid access tokens.

## Backups
More → Backup & restore → Export backup (JSON) any time. Your data is also saved to your account; signing out removes it from that device only.

## Files
index.html, styles.css, app.js (all logic), sw.js (offline cache), manifest.json, icons/, sample.csv (test bank export)
