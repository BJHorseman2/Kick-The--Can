# Radio voice: recorded lines

Out of the box the radio uses the browser's built-in speech synthesis, which
sounds like a phone assistant. The realistic voice comes from recording every
radio line once with OpenAI's text-to-speech and shipping the clips with the
game (`public/voice/`). The game plays them through a military-radio effect
(band-limited, squelch clicks, carrier hiss) and ducks the engine while a
line is on the air. Lines without a clip fall back to the browser voice, so
nothing breaks while the bank is missing or incomplete.

## Record the bank (no terminal needed)

1. GitHub → the repository → **Settings → Secrets and variables → Actions →
   New repository secret**. For ElevenLabs name it `ELEVENLABS_API_KEY`; for
   OpenAI `OPENAI_API_KEY`. Value: the provider's API key.
2. **Actions → "Record radio voice bank" → Run workflow.** Pick the branch
   (`claude/sky-heist-variation`), the provider, and the voices (defaults:
   ElevenLabs `Charlie` for Overlord and `Liam` for Viper 2), and run it.
3. It takes a few minutes and commits `public/voice/*.mp3` plus
   `manifest.json` to the branch. Then redeploy the beta and the game picks
   the clips up automatically — no code change.

Re-running is incremental: only new or changed lines are recorded. Tick
`force` to re-record everything (for example after changing the voice).

## Or locally

```
ELEVENLABS_API_KEY=... npm run gen:voice -- --provider=elevenlabs --overlord=Brian --wingman=Liam
OPENAI_API_KEY=sk-...  npm run gen:voice -- --provider=openai --overlord=ash --wingman=verse
```

`--dry` lists what would be recorded without spending anything.

## Providers and voices

**ElevenLabs** (recommended — far more expressive). Default model
`eleven_v3`, which follows inline delivery tags: urgent calls are recorded
`[shouting]`, Viper 2's lines `[excited]`. If the account can't use v3 the
script drops back to `eleven_multilingual_v2` with high style settings.
Voices can be given by name (any voice in your account's list, premade ones
included — Brian, George, Roger, Daniel, Callum, Liam, Chris, Will, Eric…)
or by voice id. Plans: the free tier is roughly enough characters for one
recording a month and requires attribution; the $5 Starter plan covers
re-records comfortably and allows commercial use.

**OpenAI.** Model `gpt-4o-mini-tts`, which takes written voice direction
(Overlord as a live air-battle controller, Viper 2 as a wingman
mid-dogfight, urgent calls shouted). Voices: `ash`, `ballad`, `verse`,
`echo`, `onyx`, `sage`, `cedar`, `marin`, `alloy`, `coral`, `fable`, `nova`,
`shimmer`. Cheaper, but flatter.

## Cost

About 150 short clips, roughly 11,000 characters. ElevenLabs: about 11k
credits (one recording fits a Starter month with room to spare). OpenAI:
cents. The clips are static files, so playing the game costs nothing extra
no matter how many people fly.

## How the game finds them

`scripts/generate-voice.mjs` writes `public/voice/manifest.json` mapping a
line key (for example `incoming.2.c9` = incoming line 2 at nine o'clock) to
its file. `src/game/radio.ts` builds the same key when it picks a line and
asks `src/game/voiceBank.ts` for the clip. Keys are stable as long as the
order of lines in `src/game/radioLines.ts` is; regenerating the line bank
with `npm run gen:radio` means recording again.
