/* Kill card: the impact-cam frame of your best kill, framed for sharing.
   1080x1350 (a 4:5 portrait — the size social feeds show uncropped). Google's
   imagery credit rides on the card, as it does on screen. */

const GAME_URL = 'bjhorseman2.github.io/Kick-The--Can';

export interface CardInfo {
  mission: string; // "CHICAGO: LOOP SIEGE"
  score: number;
  time: string; // "1:42.30"
  kills: string; // "5/5"
  won: boolean;
  medal?: string; // "GOLD"
  ace?: string; // callsign if the shot is an ace kill
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Compose the card; resolves to a JPEG blob. */
export async function composeKillCard(shotUrl: string, info: CardInfo): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05080f';
  g.fillRect(0, 0, W, H);

  // the shot, cover-fit into the top 1000px
  const img = await loadImage(shotUrl);
  const boxH = 1000;
  const s = Math.max(W / img.width, boxH / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  g.save();
  g.beginPath();
  g.rect(0, 0, W, boxH);
  g.clip();
  g.drawImage(img, (W - dw) / 2, (boxH - dh) / 2, dw, dh);
  g.restore();
  // weapon-cam grade: slight green, scanlines, vignette
  g.fillStyle = 'rgba(40, 255, 120, 0.06)';
  g.fillRect(0, 0, W, boxH);
  g.fillStyle = 'rgba(0, 0, 0, 0.12)';
  for (let y = 0; y < boxH; y += 4) g.fillRect(0, y, W, 1);
  const vg = g.createRadialGradient(W / 2, boxH / 2, boxH * 0.3, W / 2, boxH / 2, boxH * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, boxH);
  const fade = g.createLinearGradient(0, boxH - 220, 0, boxH);
  fade.addColorStop(0, 'rgba(5,8,15,0)');
  fade.addColorStop(1, 'rgba(5,8,15,1)');
  g.fillStyle = fade;
  g.fillRect(0, boxH - 220, W, 220);

  // HUD corners + label
  g.strokeStyle = 'rgba(157,245,178,0.9)';
  g.lineWidth = 5;
  const k = 70;
  const m = 40;
  for (const [x, y, sx, sy] of [
    [m, m, 1, 1],
    [W - m, m, -1, 1],
    [m, boxH - 260, 1, -1],
    [W - m, boxH - 260, -1, -1],
  ]) {
    g.beginPath();
    g.moveTo(x, y + sy * k);
    g.lineTo(x, y);
    g.lineTo(x + sx * k, y);
    g.stroke();
  }
  g.font = '600 30px ui-monospace, Menlo, monospace';
  g.fillStyle = 'rgba(157,245,178,0.95)';
  g.textAlign = 'left';
  g.fillText('⦿ IMPACT CAM', m + 20, m + 50);

  // headline
  g.textAlign = 'center';
  g.shadowColor = 'rgba(255, 70, 40, 0.8)';
  g.shadowBlur = 24;
  g.fillStyle = '#ffffff';
  const headline = info.ace ? `ACE DOWN: ${info.ace.toUpperCase()}` : 'TARGET DESTROYED';
  let hs = 78;
  do {
    g.font = `900 ${hs}px system-ui, sans-serif`;
    hs -= 3;
  } while (g.measureText(headline).width > W - 80 && hs > 40);
  g.fillText(headline, W / 2, boxH - 120);
  g.shadowBlur = 0;

  // mission + stats
  g.fillStyle = '#7fe7ff';
  g.font = '700 36px system-ui, sans-serif';
  g.fillText(info.mission, W / 2, boxH - 50);
  g.fillStyle = '#d6f4ff';
  const stats = [`SCORE ${info.score.toLocaleString()}`, info.won ? `TIME ${info.time}` : null, `BANDITS ${info.kills}`]
    .filter(Boolean)
    .join('  ·  ');
  // shrink to fit the card width
  let size = 40;
  do {
    g.font = `600 ${size}px system-ui, sans-serif`;
    size -= 2;
  } while (g.measureText(stats).width > W - 90 && size > 20);
  g.fillText(stats, W / 2, boxH + 80);
  if (info.medal) {
    g.fillStyle = info.medal === 'GOLD' ? '#ffd23f' : info.medal === 'SILVER' ? '#dfe7ef' : '#e0955a';
    g.font = '800 38px system-ui, sans-serif';
    g.fillText(`★ ${info.medal} MEDAL ★`, W / 2, boxH + 150);
  }

  // brand + link
  g.fillStyle = '#19e6ff';
  g.font = '900 54px system-ui, sans-serif';
  g.shadowColor = 'rgba(25,230,255,0.7)';
  g.shadowBlur = 20;
  g.fillText('SKY FURY: WORLD TOUR', W / 2, H - 110);
  g.shadowBlur = 0;
  g.fillStyle = '#9fb6d4';
  g.font = '500 30px system-ui, sans-serif';
  g.fillText(`Play free: ${GAME_URL}`, W / 2, H - 60);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = '400 22px system-ui, sans-serif';
  g.textAlign = 'right';
  g.fillText('Imagery © Google', W - 24, H - 20);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.9));
}

/** Share through the OS sheet where it takes files (phones), else download. */
export async function shareKillCard(blob: Blob, info: CardInfo): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], 'sky-fury-kill.jpg', { type: 'image/jpeg' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const text = info.ace
    ? `I shot down ${info.ace} over ${info.mission.split(':')[0]} in Sky Fury.`
    : `Splash one over ${info.mission.split(':')[0]} in Sky Fury.`;
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], text, url: `https://${GAME_URL}/` });
      return 'shared';
    } catch {
      return 'cancelled'; // user closed the sheet
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sky-fury-kill.jpg';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}
