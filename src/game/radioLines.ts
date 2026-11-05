// AWACS / wingman radio lines, keyed by game event. Player callsign: VIPER 1.
// Controller: OVERLORD. Wingman: VIPER 2. The enemy ace (BANDIT) cuts in.
// Placeholders: {n} a count, {clock} a clock position, {ace} the ace's callsign.
//
// Written as real comms: a short human beat, then procedure. Urgency is pace,
// clipped words and repetition ("break hard, break hard"), never volume —
// Overlord never shouts. Combat lines are one breath: at most one sentence
// break, commas or dashes inside it. Briefings keep their periods.
//
// Delivery tags (ElevenLabs audio tags) are written inline: at most one
// opening tag, plus at most one mid-line [laughs] / [exhales] / [sighs].
// Calm lines stay untagged. Who speaks each category, its intensity tier,
// the tags each speaker may use and the {n} range per category live in
// radioTiers.json. Untagged lines in a critical category are recorded with
// [urgent]; "[as-is]" opts a line out and marks a stunned, flat read (recorded
// at tier-1 pace and loudness at most, played with a quiet mic). Tags never
// reach a subtitle — radio.ts strips them (radioTags.ts).
//
// The recorded voice bank (public/voice) is keyed by category + index, so
// reordering lines means re-recording (npm run gen:voice --force).
//
// This bank can be regenerated and expanded by Claude Fable 5.1:
//   ANTHROPIC_API_KEY=sk-ant-... npm run gen:radio
// (see scripts/generate-radio.mjs — the script rewrites this file in place.)

export interface RadioLines {
  /** Keyed by level id; '*' is the fallback for unknown levels. */
  missionStart: Record<string, string[]>;
  fox2: string[]; // Viper 2 calls lead's missile away (plays on some launches)
  splash: string[]; // bandit killed by the player's missile, {n} remain
  doubleKill: string[]; // the player's second kill in quick succession
  allClear: string[]; // last bandit killed — extraction open
  incoming: string[]; // enemy missile tracking the player — {clock}
  defeated: string[]; // that missile ran out of energy without a hit
  hit: string[]; // shield lost, {n} left
  shieldsCritical: string[]; // last shield
  victory: string[]; // extraction complete (also right after an escort lands)
  down: string[]; // player crashed / shot down
  goodHit: string[]; // impact cam confirms the kill (when no kill call just went out)
  spoofed: string[]; // bandit flares decoyed our missile — get closer or go guns
  gunsKill: string[]; // bandit downed with the cannon
  recharge: string[]; // a shield came back
  winchester: string[]; // out of missiles (the portal rearms)
  rearm: string[]; // reloaded at the portal
  checkSix: string[]; // Viper 2: a hunter is on your tail
  wingFox: string[]; // Viper 2 launching
  wingKill: string[]; // Viper 2 scored
  copy: string[]; // Overlord acknowledges Viper 2
  wingRetort: string[]; // Viper 2 answers the ace's taunt
  aceIntro: string[]; // the named ace turns in on you — {ace} = callsign
  aceHit: string[]; // a missile hit the ace and it's still flying — {ace}
  aceKill: string[]; // the ace goes down (by anyone) — {ace}
  aceTaunt: string[]; // the ace itself, on your frequency
  bomberDown: string[]; // intercept: a bomber goes down
  bomberClose: string[]; // intercept: a bomber is closing on the target
  bomberHit: string[]; // intercept: a bomber reached the target (mission lost)
  vipHit: string[]; // escort: the transport took a hit
  vipClear: string[]; // escort: every raider down
  vipSafe: string[]; // escort: the transport landed (mission won)
  vipDown: string[]; // escort: the transport went down (mission lost)
  check: string[]; // radio check, played from the voice toggle
  /** Every ace callsign in the campaign; {ace} lines are recorded once per name. */
  aceCallsigns: string[];
}

export const RADIO_LINES: RadioLines = {
  missionStart: {
    '*': [
      'Viper 1, Overlord. Picture’s hostile. You’re cleared to engage.',
      'Overlord has you, Viper 1. Multiple bandits on scope. Weapons free — go get ’em.',
      'Viper 1, Overlord, radar contact. Bandits are hot. Commit.',
    ],
    parispatrol: [
      'Viper 1, Overlord, radar contact. Three bandits over the Seine. Weapons free.',
      'Picture: three hostiles, Eiffel Tower to Montmartre. Clean them up, Viper 1.',
      'Paris is closed airspace till those three are in the river. Cleared to engage.',
    ],
    baycap: [
      'Viper 1, Overlord. Five bandits over the Bay, downtown to the Golden Gate. Commit.',
      'Five hostiles over San Francisco. Fog rolls in at dusk — be done before it does.',
      'Five contacts, all hostile. Weapons free, Viper 1. Your exit’s over the Pacific.',
    ],
    yosemite: [
      'Viper 1, bandits in the valley, El Cap to Half Dome. Mind the granite.',
      'Five hostiles, low in Yosemite. Terrain masks both ways down there. Use it.',
      'Valley’s hot, Viper 1. Watch your altitude — those walls are a kilometer tall.',
    ],
    chicagosiege: [
      'Viper 1, Overlord. Five bandits hold the Loop. Splash them in the towers, egress over the lake.',
      'Chicago’s under siege, Willis to Navy Pier. Thread the towers, Viper 1.',
      'Five contacts on the lakefront. Weapons free. Take the sky back.',
    ],
    nycfury: [
      'Viper 1, Overlord. Six bandits own Manhattan, Trade Center to the Park. Take it back.',
      'Six hostiles over New York. Extraction’s at Liberty once the sky is clean.',
      'Six contacts, Viper 1. This is the big one. Good hunting.',
    ],
    ggintercept: [
      'Viper 1, Overlord. Bombers inbound off the Pacific for the Golden Gate. Commit. Stop every one.',
      'Four heavies headed for the bridge, fighters sweeping ahead of them. Go get them.',
      'Bombers coming in off the ocean. Nothing reaches that bridge, Viper 1. Nothing.',
    ],
    af2escort: [
      'Viper 1, Air Force Two is coming up the Hudson. Raiders are waiting. Keep them off the package.',
      'Viper 1, Overlord. Package is inbound over Liberty. Stay close — it can’t take much.',
      'Escort duty, Viper 1. Get Air Force Two to Central Park in one piece.',
    ],
    southampton: [
      'Viper 1, bandits over the Hamptons, Shinnecock to Coopers Beach. Low and fast.',
      'Five contacts on the South Fork. Try not to part anyone’s hair on Meadow Lane.',
      'Beach sweep, Viper 1. Five bandits, inlet to the estates. Weapons free.',
    ],
  },
  fox2: [
    'Lead’s fox two!',
    '[excited] Good shot, Lead, it’s tracking!',
    'Your bird’s tracking, Lead.',
    'Missile off your jet, guiding!',
    'Tracking, tracking!',
    'Nice shot, it’s on him!',
  ],
  splash: [
    '[excited] Splash one, {n} remaining!',
    'Good kill, good kill — {n} still up!',
    '[excited] Splash! {n} to go, keep it coming!',
    'Bandit’s off my scope — {n} left!',
    '[exhales] That’s a kill, {n} remaining.',
  ],
  doubleKill: [
    '[excited] That’s two, keep it going!',
    'Two in a row, Viper 1!',
    'Another one, [laughs] nice shooting!',
  ],
  allClear: [
    '[excited] That’s the last one! Picture clean, extraction’s open!',
    'All bandits down, scope’s clean — get to the portal!',
    '[exhales] Picture clean. Nice work, Viper 1 — egress and extract.',
    'Last bandit’s down. Sky’s yours — head for extraction!',
  ],
  incoming: [
    '[urgent] Missile, missile, {clock}! Break!',
    '[urgent] Viper 1, defend! Launch, {clock}!',
    '[urgent] Missile inbound, {clock} — break hard, break hard!',
    '[urgent] Viper 1, missile in the air, {clock} — get off that line!',
    '[urgent] Viper 1, missile {clock}, break now!',
  ],
  defeated: [
    '[exhales] Missile’s trashed. You’re clear, Viper 1.',
    'It went wide, Viper 1. Nice flying.',
    'Missile defeated. Back on the attack.',
    '[excited] Clear, clear, it missed you!',
  ],
  hit: [
    '[urgent] Viper 1, you’re hit — shields {n}!',
    'You took one, {n} left — stay with it!',
    '[urgent] Impact on Viper 1! {n} remaining, keep moving!',
    'That one connected, {n} shields — don’t give him another!',
  ],
  shieldsCritical: [
    '[urgent] Last shield! One more and you’re done — move!',
    '[urgent] Viper 1, shields critical! Do not take another hit!',
    '[urgent] Last shield, Viper 1! Evade, evade!',
    '[urgent] You’re on your last shield — get out of there, now!',
  ],
  victory: [
    '[exhales] Extraction confirmed. Textbook, Viper 1.',
    'Mission complete, Viper 1. [laughs] Drinks are on Overlord.',
    'Sky’s clear, pilot’s home — nice flying, Viper 1!',
    '[excited] Overlord copies mission complete. That’s how it’s done!',
  ],
  down: [
    '[urgent] Viper 1 is down! I say again, Viper 1 is down!',
    '[urgent] Viper 1, Overlord. Viper 1, respond!',
    '[as-is] We lost Viper 1. Mark the crash site.',
    '[urgent] Lost Viper 1 on scope — Viper 1, Overlord, come in!',
  ],
  goodHit: [
    '[excited] Good hit! Good hit!',
    'Direct hit, he’s off my scope!',
    '[excited] That’s a kill!',
    'Yes, impact — he’s gone!',
    '[exhales] Good hit, Viper 1.',
  ],
  spoofed: [
    'Trashed — your missile took his flares. Get closer, or go guns!',
    '[urgent] Spoofed! Seeker went for a flare, press in!',
    '[sighs] Negative hit, that was a flare. Close the range.',
    'He flared it — get in tight, he can’t spoof point-blank!',
  ],
  gunsKill: [
    '[excited] Guns kill, guns kill — all pilot, Viper 1!',
    'Splash one with the cannon. Nobody spoofs a bullet!',
    '[excited] Guns, guns, guns — and he’s down!',
    'Up close and personal. [laughs] Splash one!',
  ],
  recharge: [
    'Shields back up.',
    'Shield’s restored. Stay clean.',
    'Systems recovered. You’ve got a shield back.',
    '[exhales] Shield’s back. Don’t waste it.',
  ],
  winchester: [
    'Viper 1, you’re Winchester — go guns, or hit the portal to rearm!',
    'Rails are empty — cannon only, or run for the portal!',
    'Winchester — guns, or rearm at the portal!',
    'No missiles, Viper 1 — get in close and use the gun!',
    'Winchester, Viper 1. It’s a knife fight now!',
  ],
  rearm: [
    'Rearm complete. Six on the rails. Get back in there.',
    'Reloaded. Full rails — back to work.',
    'Six fresh missiles. Make them count.',
    'Rails are full, Viper 1. Go hunting.',
  ],
  checkSix: [
    '[shouting] Lead, check six! Bandit on your tail!',
    '[strained] Break! He’s on your six — closing!',
    '[shouting] One on your six, Lead! Turn, turn!',
    '[breathless] Lead, bandit your six, close! Break now!',
    '[urgent] He’s sitting right behind you, One — shake him!',
  ],
  wingFox: [
    'Two’s in. Fox two!',
    'Viper 2, fox two!',
    '[excited] Got a shot — fox two!',
    'Two, fox two. Bird’s away.',
    '[excited] Two’s engaged, fox two!',
  ],
  wingKill: [
    '[excited] Splash one! That one’s mine, Lead!',
    'Two, splash. Scratch one.',
    'He’s down! [laughs] Two’s got a kill!',
    '[excited] Got him! Somebody paint that on my jet!',
  ],
  copy: ['Overlord copies.', 'Copy, Two.', 'Overlord copies, Two.', 'Copy. Keep it up, Two.'],
  wingRetort: [
    'Ignore him, Lead. He talks too much.',
    'Big talk. Let’s shut him up, Lead.',
    '[laughs] Cut the chatter, bandit.',
  ],
  aceIntro: [
    'Viper 1, new contact, hot and fast — that’s {ace}. He’s no rookie!',
    '[urgent] Heads up, Viper 1 — {ace} just turned in on you. He pops flares, so get close!',
    'Bandit ace, callsign {ace}, closing fast. Take him and the sky is yours!',
  ],
  aceHit: [
    '[excited] Good hit on {ace}! He’s smoking, still flying — finish him!',
    '[urgent] {ace} took it and kept flying — hit him again!',
    '[excited] He’s hurt! {ace}’s still up — one more, Viper 1!',
  ],
  aceKill: [
    '[excited] {ace} is down! I say again, {ace} is down!',
    '[excited] Splash {ace}! That was their best, Viper 1!',
    '[exhales] {ace}’s off my scope. Scratch one ace.',
  ],
  aceTaunt: [
    'You’re in my sky now, Viper.',
    '[mischievously] I see you. Run all you like.',
    '[laughs] Nice try. My turn.',
    'Your wingman can’t save you.',
    '[sarcastic] Break left, break right. I’ll still be here.',
    '[mischievously] Here it comes, Viper. Dance for me.',
    '[sarcastic] Is that all? I expected more.',
    'That one has your name on it.',
  ],
  bomberDown: [
    '[excited] Bomber down, keep going!',
    'Scratch one heavy!',
    'That bomber’s finished — next one!',
    '[exhales] Splash the bomber. Good — find me the next one.',
  ],
  bomberClose: [
    '[urgent] Leaker! One’s closing on the target — get on him, Viper 1!',
    '[urgent] One’s almost through! Stop that bomber!',
    '[urgent] Bomber on final, take him now!',
    '[urgent] He’s on his run-in, Viper 1 — kill that bomber!',
  ],
  bomberHit: [
    '[sighs] Bomber’s through. Target’s hit, mission failed.',
    '[as-is] We couldn’t stop him. The target is gone.',
    'Leaker got through — target destroyed, mission failed.',
  ],
  vipHit: [
    '[urgent] Package is taking fire! Get them off it!',
    '[urgent] Package hit! Viper 1, cover it!',
    '[urgent] They’re on the package! Break them up!',
    '[urgent] Package took a hit — keep them off it, Viper 1!',
  ],
  vipClear: [
    '[exhales] Raiders are down. Stay with the package all the way in.',
    'Sky’s clear around the package. Bring it home!',
    '[excited] That’s the last raider — escort to touchdown, Viper 1!',
  ],
  vipSafe: [
    '[excited] Package is on the ground! Outstanding escort, Viper 1!',
    '[exhales] Package down safe. Textbook escort.',
    'Wheels down, package safe — nice work, Viper 1!',
  ],
  vipDown: ['[urgent] We lost the package! Mission failed.', '[as-is] The package is down. I say again, the package is down.'],
  check: ['Overlord, loud and clear, Viper 1. Good to have you up.'],
  aceCallsigns: ['Phantom', 'Fog Cutter', 'Blackjack', 'Red King', 'Rockfall', 'Riptide'],
};
