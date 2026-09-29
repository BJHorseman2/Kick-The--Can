// AWACS / wingman radio lines, keyed by game event. `{n}` is substituted
// with a count where noted. Player callsign: VIPER 1. Controller: OVERLORD.
//
// Written as real comms: short, dry, fast. Urgency comes from tempo and the
// radio channel, not from acting. Combat calls are brevity code; only the
// briefing and the debrief get a little color.
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
  aceIntro: string[]; // the named ace turns in on you — {ace} = callsign
  aceHit: string[]; // a missile hit the ace and it's still flying — {ace}
  aceKill: string[]; // the ace goes down — {ace}
  aceTaunt: string[]; // the ace itself, on your frequency
  bomberDown: string[]; // intercept: a bomber goes down
  bomberClose: string[]; // intercept: a bomber is closing on the target
  bomberHit: string[]; // intercept: a bomber reached the target (mission lost)
  vipHit: string[]; // escort: the transport took a hit
  vipClear: string[]; // escort: every raider down
  vipSafe: string[]; // escort: the transport landed (mission won)
  vipDown: string[]; // escort: the transport went down (mission lost)
  /** Every ace callsign in the campaign; {ace} lines are recorded once per name. */
  aceCallsigns: string[];
}

export const RADIO_LINES: RadioLines = {
  missionStart: {
    '*': [
      'Viper 1, Overlord. Picture hostile. Weapons free.',
      'Overlord to Viper 1. Bandits on scope. Cleared hot.',
      'Viper 1, you are on station. Commence sweep.',
    ],
    parispatrol: [
      'Viper 1, Overlord. Three bandits over the Seine. Weapons free.',
      'Picture: three hostiles, Tower to Montmartre. Clean them up.',
      'Paris is closed airspace until those three are in the river. Go.',
    ],
    baycap: [
      'Viper 1, five bandits over the Bay, Financial District to the Golden Gate. Sweep it clean.',
      'Hostiles over San Francisco. Fog at dusk. Be done before it.',
      'Five contacts, Viper 1. Weapons free.',
    ],
    yosemite: [
      'Viper 1, bandits in the valley, El Cap to Half Dome. Mind the granite.',
      'Five hostiles low in Yosemite. Terrain masks both ways down there.',
      'Valley is hot. Watch your altitude. Those walls are a kilometer tall.',
    ],
    chicagosiege: [
      'Viper 1, five bandits hold the Loop. Splash them in the towers, egress over the lake.',
      'Chicago under siege, Willis to Navy Pier. Thread the towers.',
      'Five contacts on the lakefront. Take the sky back.',
    ],
    nycfury: [
      'Viper 1, six bandits own Manhattan, WTC to the Park. Take it back.',
      'Six hostiles over New York. Extract at Liberty when the sky is clean.',
      'Six contacts. Manhattan Fury is a go. Good hunting.',
    ],
    ggintercept: [
      'Viper 1, bombers inbound from the Pacific for the Golden Gate. Stop every one of them.',
      'Overlord: four bombers on the way to the bridge, fighters sweeping ahead. Go get them.',
      'Bombers coming in off the ocean. Nothing reaches that bridge, Viper 1.',
    ],
    af2escort: [
      'Viper 1, Air Force Two is coming up the Hudson. Raiders are waiting. Keep them off the package.',
      'Overlord: the package is inbound over Liberty. Stay close, it can’t take much.',
      'Escort mission, Viper 1. Get the package to Central Park in one piece.',
    ],
    southampton: [
      'Viper 1, bandits over the Hamptons, Shinnecock to Coopers Beach. Low and fast.',
      'Five contacts on the South Fork. Try not to part anyone’s hair on Meadow Lane.',
      'Beach sweep. Five bandits, inlet to the estates. Weapons free.',
    ],
  },
  fox2: ['Fox two!', 'Viper 1, fox two!', 'Fox two, fox two!'],
  splash: [
    'Splash one! {n} remaining.',
    'Good kill. {n} still up.',
    'Splash! {n} to go.',
    'Bandit down. {n} on scope.',
  ],
  allClear: [
    'Splash the last one. Picture clean! Extraction is open.',
    'All bandits down. Get to the portal.',
    'Scope clear. Egress and extract.',
  ],
  incoming: [
    'Missile inbound, {clock}! Break, break!',
    'Viper 1, defend! Launch, {clock}!',
    'Spike, {clock}! Break hard!',
    'Launch, {clock}! Get off that line!',
  ],
  hit: [
    'Viper 1, you’re hit! Shields at {n}!',
    'You took one. {n} left. Stay with it!',
    'Impact on Viper 1! {n} remaining. Keep moving!',
  ],
  shieldsCritical: [
    'Last shield! One more and you’re going down!',
    'Shields critical! Do not take another hit!',
    'Last shield, Viper 1! Evade, evade!',
  ],
  victory: [
    'Viper 1 through the portal. Mission complete. Drinks are on Overlord.',
    'Extraction confirmed. Textbook, Viper 1.',
    'Skies cleared, pilot recovered. Well done.',
  ],
  down: [
    'Viper 1 is down! I say again, Viper 1 is down!',
    'We lost Viper 1. Mark the crash site.',
    'Viper 1, respond! Viper 1, respond!',
  ],
  goodHit: ['Good hit! Good hit!', 'Direct hit. Target destroyed.', 'That’s a kill!'],
  spoofed: [
    'Flares! Your bird went for the flares. Get closer, or go guns.',
    'Spoofed. Seeker chased a flare. Press in.',
    'Negative hit, that was a flare. Close the range.',
  ],
  gunsKill: [
    'Guns kill! Guns kill! All pilot, Viper 1.',
    'Splash one with the cannon. Nobody spoofs a bullet.',
    'Guns, guns, guns. And he’s down!',
  ],
  recharge: ['Shields back up.', 'Systems recovered. Shield restored.', 'Shield restored. Stay clean.'],
  winchester: [
    'Viper 1, you’re Winchester. Go guns, or hit the portal to rearm.',
    'Rails empty. Cannon only, or run for the portal.',
    'Last missile gone. Guns, or rearm at extraction.',
  ],
  rearm: ['Rearm complete. Six on the rails. Get back in there.', 'Reloaded. Full rails.', 'Six fresh missiles. Make them count.'],
  checkSix: [
    'Check six, Viper 1! Bandit on your tail!',
    'Break! He’s on your six, closing!',
    'One on your six! Turn hard!',
  ],
  wingFox: ['Two’s in. Fox two!', 'Viper 2, fox two!', 'Got a shot. Fox two!'],
  wingKill: ['Splash one! That one’s mine, Lead.', 'Viper 2, good kill. Scratch one.', 'He’s down! Two’s got a kill.'],
  aceIntro: [
    'Viper 1, heads up. {ace} is up, and he’s coming for you. This one’s no rookie.',
    'Overlord to Viper 1: that’s {ace} turning in. Watch him, he pops flares.',
    'Bandit ace, callsign {ace}, closing fast. Take him and the sky is yours.',
  ],
  aceHit: [
    'Good hit on {ace}! He’s smoking, but he’s still flying. Finish him!',
    '{ace} took it and kept flying. Hit him again!',
    'He’s hurt! {ace} is still up. One more, Viper 1!',
  ],
  aceKill: [
    '{ace} is down! I say again, {ace} is down! Outstanding!',
    'Splash {ace}! That’s their best pilot, Viper 1.',
    'You got {ace}! Scratch one ace!',
  ],
  aceTaunt: [
    'You’re in my sky now, Viper.',
    'I see you. Run all you like.',
    'Nice try. Now it’s my turn.',
    'Your wingman can’t save you.',
    'Break left, break right. I’ll still be here.',
  ],
  bomberDown: ['Bomber down! Keep going!', 'Scratch one bomber!', 'That bomber’s finished. Next one!'],
  bomberClose: [
    'Bomber closing on the target! Get on him, Viper 1!',
    'One’s almost through! Stop that bomber!',
    'Bomber on final! Take him now!',
  ],
  bomberHit: ['Bomber’s through. The target is hit. Mission failed.', 'We couldn’t stop him. The target is gone.'],
  vipHit: [
    'The package is taking fire! Get them off it!',
    'Package hit! Viper 1, cover it!',
    'They’re on the package! Break them up!',
  ],
  vipClear: ['Raiders down. Stay with the package all the way in.', 'Sky’s clear around the package. Bring it home.'],
  vipSafe: [
    'The package is on the ground. Outstanding escort, Viper 1!',
    'Package down safe. Textbook escort.',
  ],
  vipDown: ['We lost the package! Mission failed.', 'The package is down. I say again, the package is down.'],
  aceCallsigns: ['Phantom', 'Fog Cutter', 'Blackjack', 'Red King', 'Rockfall', 'Riptide'],
};
