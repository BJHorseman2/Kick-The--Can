/* Delivery tags in the radio script. Lines in radioLines.ts carry ElevenLabs
   audio tags inline ("[excited] Splash one, {n} remaining!", "Mission
   complete, Viper 1. [laughs] Drinks are on Overlord."); "[as-is]" opts a
   line out of the generator's default tag and marks a flat, stunned read. Tags are for the recording only:
   they never reach a subtitle, the voice link or the browser's speech.
   Pure functions, no imports — scripts and the game share the same rules. */

/** The line with every [tag] removed: what is shown and what a plain TTS voice says. */
export function stripTags(s: string): string {
  return s
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1') // "word [laughs], more" → "word, more"
    .trim();
}

/** "[ Excited ]" / "excited" → "excited". */
function tagName(t: string): string {
  return t.toLowerCase().replace(/^\s*\[|\]\s*$/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Mood of a line from its opening tag (the tag before any words; "[as-is]"
 * is skipped): +0.5 for a hot tag (excited, urgent…), -0.5 for a calm one
 * (exhales, sighs), else 0. `hot` and `calm` take names with or without brackets.
 */
export function lineMood(s: string, hot: string[], calm: string[]): number {
  const lead = s.match(/^\s*(?:\[[^\]]*\]\s*)+/);
  if (!lead) return 0;
  const first = [...lead[0].matchAll(/\[([^\]]*)\]/g)].map((m) => tagName(m[1])).find((n) => n !== 'as-is');
  if (!first) return 0;
  if (hot.some((t) => tagName(t) === first)) return 0.5;
  if (calm.some((t) => tagName(t) === first)) return -0.5;
  return 0;
}
