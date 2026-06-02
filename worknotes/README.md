# WorkNotes

A fast, offline-first **work note-taking & productivity app**, built as a mobile-first
installable PWA — optimized for iPhone (Add to Home Screen, safe-area insets, dark mode,
offline support).

## Features

- 📝 Create, edit, and delete notes with title, body, and tags
- 🔎 Instant search across titles, content, and tags
- 🏷️ Tag chips for quick filtering
- 📌 Pin important notes to the top
- 🌙 Automatic light/dark mode (follows system)
- 📶 Works fully offline (service worker cache)
- 💾 Notes stored locally on-device (localStorage) — nothing leaves your phone
- 📱 Installable to the iPhone home screen as a standalone app

## Run it

It's a static site — no build step.

```bash
# from the project root
python3 -m http.server 8000
# then open http://localhost:8000 on your phone or browser
```

> A local/HTTPS server is required for the service worker to register
> (opening `index.html` via `file://` disables offline caching).

### Install on iPhone

1. Open the served URL in **Safari**.
2. Tap the **Share** button → **Add to Home Screen**.
3. Launch **WorkNotes** from your home screen — it runs full-screen, offline.

## Tech

Vanilla HTML, CSS, and JavaScript. No dependencies, no tracking, no backend.

## Project structure

```
index.html            App shell & markup
styles.css            Mobile-first styles, light/dark themes
app.js                State, rendering, editor, persistence
manifest.webmanifest  PWA metadata
service-worker.js     Offline asset caching
icons/                App icons
```

## Roadmap ideas

- Checklist rendering for `[ ]` / `[x]` lines
- Note export / import (JSON)
- Reminders & due dates
- Optional end-to-end encrypted sync
