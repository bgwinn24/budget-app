# Budget (v1)

Plain HTML/CSS/JS PWA. No build step, no dependencies. All data is stored in this browser's localStorage on the phone. Nothing is sent anywhere.

## Run locally
    python3 -m http.server 8765   # then open http://localhost:8765

## Install on Android
The app must be served over HTTPS. Open the URL in Chrome, then use the menu and choose **Add to Home screen / Install app**. After the first load it works offline.

## Updating
After changing any file, bump `VERSION` in `sw.js` so phones pick up the new files. Re-open the app twice to get the update.

## Backups
More → Backup & restore → Export backup (JSON). Keep a copy off the phone. If you clear Chrome site data or uninstall the app, the data on the phone is deleted.

## Files
index.html, styles.css, app.js (all logic), sw.js (offline cache), manifest.json, icons/, sample.csv (test bank export)
