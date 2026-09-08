// AWACS / wingman radio lines, keyed by game event. `{n}` is substituted
// with a count where noted. Player callsign: VIPER 1. Controller: OVERLORD.
//
// This bank can be regenerated and expanded by Claude Fable 5.1:
//   ANTHROPIC_API_KEY=sk-ant-... npm run gen:radio
// (see scripts/generate-radio.mjs — the script rewrites this file in place.)

export interface RadioLines {
  /** Keyed by level id; '*' is the fallback for unknown levels. */
  missionStart: Record<string, string[]>;
  fox2: string[]; // player missile away
  splash: string[]; // bandit killed, {n} remain
  allClear: string[]; // last bandit killed — extraction open
  incoming: string[]; // enemy missile tracking the player
  hit: string[]; // shield lost, {n} left
  shieldsCritical: string[]; // last shield
  victory: string[]; // extraction complete
  down: string[]; // player crashed / shot down
  goodHit: string[]; // impact cam confirms the kill
  spoofed: string[]; // bandit flares decoyed our missile
  gunsKill: string[]; // bandit downed with the cannon
  recharge: string[]; // a shield came back
  winchester: string[]; // out of missiles
  rearm: string[]; // reloaded at the portal
  checkSix: string[]; // Viper 2: a hunter is on your tail
  wingFox: string[]; // Viper 2 launching
  wingKill: string[]; // Viper 2 scored
}

export const RADIO_LINES: RadioLines = {
  missionStart: {
    '*': [
      'Overlord to Viper 1 — picture is hostile. Weapons free.',
      'Viper 1, Overlord. Bandits on the scope. Cleared to engage.',
      'All stations, Viper 1 is on station. Commencing sweep.',
    ],
    parispatrol: [
      'Viper 1, Overlord. Three bandits over the Seine. The City of Light is your range today — weapons free.',
      'Picture: three hostiles between the Tower and Montmartre. Clean them up, Viper 1.',
      'Overlord here. Paris is closed airspace until those three are swimming in the Seine.',
    ],
    baycap: [
      'Viper 1, five bandits over the Bay. From the Financial District to the Golden Gate — sweep it clean.',
      'Overlord: hostiles over San Francisco. Fog rolls in at dusk — be done before it does.',
      'Five contacts, Viper 1. The Bay Area is counting on you. Weapons free.',
    ],
    yosemite: [
      'Viper 1, bandits in the valley — between El Capitan and Half Dome. Mind the granite; it does not forgive.',
      'Overlord: five hostiles low in Yosemite. Terrain masking works both ways down there.',
      'The valley is hot, Viper 1. Watch your altitude — those walls are a kilometer tall.',
    ],
    chicagosiege: [
      'Viper 1, Overlord. Five bandits hold the Loop. Splash them between the towers and get out over the lake.',
      'Chicago is under siege — Willis to Navy Pier. Thread the towers, Viper 1.',
      'Overlord: five contacts over the lakefront. The Windy City wants its sky back.',
    ],
    nycfury: [
      'Viper 1, this is the big one. Six bandits own Manhattan — WTC to the Park. Take it back.',
      'Overlord: six hostiles over New York. Extraction at Lady Liberty when the sky is clean.',
      'Six contacts, Viper 1. Manhattan Fury is a go. Good hunting.',
    ],
    southampton: [
      'Viper 1, bandits over the Hamptons — Shinnecock to Coopers Beach. Keep it low and fast over the dunes.',
      'Overlord: five contacts on the South Fork. Try not to part anyone’s hair on Meadow Lane.',
      'Beach sweep, Viper 1. Five bandits between the inlet and the estates. Weapons free.',
    ],
  },
  fox2: [
    'Fox two!',
    'Viper 1, fox two!',
    'Fox two — bird away.',
  ],
  splash: [
    'Splash one! {n} remaining.',
    'Good kill, Viper 1. {n} still airborne.',
    'That’s a splash. {n} to go.',
    'Bandit down. {n} left on the scope.',
  ],
  allClear: [
    'Splash the last one — picture is clean! Extraction is open, Viper 1.',
    'All bandits down. Outstanding. Get to the portal.',
    'Scope’s clear, Viper 1. Egress and extract.',
  ],
  incoming: [
    'Missile inbound, {clock} — break, break!',
    'Viper 1, defend! Missile in the air, {clock}!',
    'Spike, {clock}! Break hard!',
    'Launch, {clock}. Get off that line, Viper 1!',
  ],
  hit: [
    'Viper 1, you’re hit! Shields at {n}.',
    'You took one — {n} shields left. Stay with it.',
    'Impact on Viper 1. {n} remaining — keep moving.',
  ],
  shieldsCritical: [
    'Last shield, Viper 1! One more and you’re going down!',
    'Shields critical! Do not take another hit!',
    'You’re on your last shield — evade, evade!',
  ],
  victory: [
    'Viper 1 is through the portal. Mission complete — drinks are on Overlord.',
    'Extraction confirmed. Textbook work, Viper 1.',
    'That’s a wrap. Skies cleared, pilot recovered. Well done.',
  ],
  down: [
    'Viper 1 is down! I say again, Viper 1 is down!',
    'We lost Viper 1. Mark the crash site.',
    'Viper 1, respond... Viper 1, respond!',
  ],
  goodHit: [
    'Good hit! Good hit!',
    'Direct hit — target destroyed.',
    'That’s a kill. Beautiful.',
  ],
  spoofed: [
    'Flares! Your missile went for the flares, Viper 1. Get in closer — or go guns.',
    'He spoofed it — seeker chased a flare. Press in, or take him with the cannon.',
    'Negative hit, that was a flare. Close the range before you fire.',
  ],
  gunsKill: [
    'Guns kill! Guns kill! That one’s all pilot, Viper 1.',
    'Splash one with the cannon — nobody spoofs a bullet.',
    'Guns, guns, guns — and he’s down. Outstanding.',
  ],
  recharge: [
    'Shields back up, Viper 1.',
    'Systems recovered — you’ve got a shield back.',
    'Shield restored. Stay clean out there.',
  ],
  winchester: [
    'Viper 1, you’re Winchester — no missiles left. Go guns, or hit the portal to rearm.',
    'Rails are empty. Cannon only, or run for the portal.',
    'That was your last missile. Guns, guns, guns — or rearm at extraction.',
  ],
  rearm: [
    'Rearm complete — six missiles on the rails. Get back in there.',
    'Reloaded, Viper 1. Full rails.',
    'Six fresh missiles. Go make them count.',
  ],
  checkSix: [
    'Check six, Viper 1! Bandit on your tail!',
    'Break! He’s behind you — six o’clock, closing!',
    'Viper 1, you’ve got one on your six. Turn hard!',
  ],
  wingFox: [
    'Two’s in — fox two!',
    'Viper 2, fox two on the bandit.',
    'Got a shot — fox two!',
  ],
  wingKill: [
    'Splash one! That one’s mine, Lead.',
    'Viper 2, good kill. Scratch one bandit.',
    'He’s down — Two’s got a kill.',
  ],
};
