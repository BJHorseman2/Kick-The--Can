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
   New repository secret**. Name `OPENAI_API_KEY`, value your OpenAI key.
2. **Actions → "Record radio voice bank" → Run workflow.** Pick the branch
   (`claude/sky-heist-variation`), leave the voices at their defaults
   (Overlord `ash`, Viper 2 `verse`) or choose others, and run it.
3. It takes a couple of minutes and commits `public/voice/*.mp3` plus
   `manifest.json` to the branch. Then redeploy the beta and the game picks
   the clips up automatically — no code change.

Re-running is incremental: only new or changed lines are recorded. Tick
`force` to re-record everything (for example after changing the voice).

## Or locally

```
OPENAI_API_KEY=sk-... npm run gen:voice --overlord=onyx --wingman=echo
```

`--dry` lists what would be recorded without spending anything.

## Voices

The default model is `gpt-4o-mini-tts`, which takes voice direction: Overlord
is directed as a calm, deep AWACS controller and Viper 2 as a wingman
mid-dogfight; urgent calls (missile inbound, last shield, check six) are
recorded faster and sharper. Voice options: `onyx`, `ash`, `echo`, `verse`,
`ballad`, `sage`, `cedar`, `marin`, `alloy`, `coral`, `fable`, `nova`,
`shimmer`.

## Cost

About 150 short clips, a few minutes of audio in total — cents per full
recording. The clips are static files, so playing the game costs nothing
extra no matter how many people fly.

## How the game finds them

`scripts/generate-voice.mjs` writes `public/voice/manifest.json` mapping a
line key (for example `incoming.2.c9` = incoming line 2 at nine o'clock) to
its file. `src/game/radio.ts` builds the same key when it picks a line and
asks `src/game/voiceBank.ts` for the clip. Keys are stable as long as the
order of lines in `src/game/radioLines.ts` is; regenerating the line bank
with `npm run gen:radio` means recording again.
