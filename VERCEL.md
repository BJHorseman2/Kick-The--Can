# Deploying Sky Fury on Vercel (with the voice link)

The GitHub Pages build is a static export and stays exactly as it is. Vercel
runs the same code as a normal Next.js app, which is what lets it host the
one server endpoint the voice link needs — the piece that keeps your OpenAI
key out of the browser.

## 1. Import the project

1. In Vercel: **Add New → Project → Import** `BJHorseman2/Kick-The--Can`.
2. **Framework preset:** Next.js (auto-detected). Leave build & output
   commands at their defaults. Do **not** set `STATIC_EXPORT` or
   `NEXT_PUBLIC_BASE_PATH` — those are only for GitHub Pages.
3. **Production branch:** `claude/sky-heist-variation` (Settings → Git) until
   the game is merged to `main`.

## 2. Environment variables (Settings → Environment Variables)

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | your Maps key | same key as GitHub Pages |
| `NEXT_PUBLIC_VOICE_ENABLED` | `1` | shows the VOICE LINK toggle on the start screen |
| `OPENAI_API_KEY` | `sk-…` | server-side only; never exposed |
| `VOICE_ACCESS_CODE` | any word | pilot gate — players type this once per session |
| `VOICE_MAX_MINUTES` | `10` | the browser hangs up at this; your cost ceiling per session |
| `VOICE_MODEL` | `gpt-realtime` | default. For GPT‑Live‑1 set `gpt-live-1` and add `VOICE_SESSION_JSON` below |
| `VOICE_VOICE` | `cedar` | any voice the model supports |
| `VOICE_SESSION_JSON` | *(optional)* | extra session fields merged verbatim, e.g. GPT‑Live‑1's delegation block:<br>`{"delegation":{"type":"responses","responses":{"model":"gpt-5.6-terra","instructions":"Answer as Overlord, briefly."}}}` |

Then **Deploy**. Every push to the production branch redeploys.

## 3. Google Maps key

Add the Vercel domain to the key's HTTP-referrer allowlist:
`https://<your-project>.vercel.app/*` (and your custom domain later).

## 4. Try it

1. Open the Vercel URL on your phone. Look for the build stamp at the bottom
   of the start screen.
2. Tap **🎧 VOICE LINK**, enter the access code.
3. Fly any mission. The pill under the mission text goes **VOICE LINK LIVE**
   once the call is up (the browser will ask for the microphone — that's
   the only permission).
4. **Hold TALK** (or **T** on a keyboard) and speak: *"Overlord, where's the
   nearest bandit?"* — *"Two, take the one on my left."* — *"How many
   missiles do I have?"*

Overlord's canned radio lines keep appearing as subtitles but are no longer
spoken by the browser voice while the link is live; the live voice narrates
the fight from the events it receives.

## Cost control

The voice layer is billed per minute by OpenAI; the backend model (when
GPT‑Live‑1 delegates) is billed per token. `VOICE_MAX_MINUTES` caps every
session, the access code caps who can start one, and the endpoint refuses
more than 20 sessions a minute per instance. For a paid tier you'd replace
the access code with a login + minute ledger (Stripe Checkout → credits).

## Troubleshooting

- **VOICE LINK: Wrong access code** — `VOICE_ACCESS_CODE` on Vercel doesn't
  match what you typed.
- **OpenAI refused the session (400 …)** — the session config isn't accepted
  by the chosen model; the message quotes OpenAI's reason. For GPT‑Live‑1
  check `VOICE_SESSION_JSON` against the [GPT‑Live docs](https://developers.openai.com/api/docs/guides/live).
- **No microphone prompt on iPhone** — Safari only asks over HTTPS after a
  tap; the TALK button is that tap. Check Settings → Safari → Microphone.
- **Silence but the pill says LIVE** — iPhone ringer switch: the game's own
  sounds opt out of it; WebRTC audio also should, but flip the switch and
  check the volume rocker first.
