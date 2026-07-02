'use client';

interface Props {
  onStart: () => void;
  onStartDemo: () => void;
  hasApiKey: boolean;
}

export default function StartScreen({ onStart, onStartDemo, hasApiKey }: Props) {
  return (
    <div className="overlay">
      <div className="panel">
        <h1 className="title">
          SKY HEIST<span className="title-sub">: MANHATTAN</span>
        </h1>
        <p className="tagline">Steal the loot and escape through the portal.</p>

        <ul className="controls">
          <li>
            <kbd>W</kbd> dive&nbsp;/&nbsp;descend &nbsp;·&nbsp; <kbd>S</kbd> climb
          </li>
          <li>
            <kbd>A</kbd> bank left &nbsp;·&nbsp; <kbd>D</kbd> bank right
          </li>
          <li>
            <kbd>Space</kbd> boost &nbsp;·&nbsp; <kbd>R</kbd> restart after a crash
          </li>
        </ul>

        <p className="hint">
          Fly the glowing rings, grab all 3 loot orbs, then dive through the portal.
          Fast + low = big score. Hit a building or the ground and it&apos;s over.
        </p>

        {hasApiKey ? (
          <div className="start-buttons">
            <button className="btn btn-primary" onClick={onStart}>
              ► START HEIST
            </button>
            <button className="btn btn-secondary" onClick={onStartDemo}>
              ◇ TRAINING GRID (demo)
            </button>
          </div>
        ) : (
          <>
            <button className="btn btn-primary" onClick={onStartDemo}>
              ► FLY THE TRAINING GRID (demo)
            </button>
            <div className="config-warning">
              <strong>Want the real Manhattan?</strong>
              <p>
                The photorealistic city needs a Google Maps Platform key. Create{' '}
                <code>.env.local</code> with{' '}
                <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=&lt;your key&gt;</code> and restart{' '}
                <code>npm run dev</code>. See the README for setup steps. Meanwhile the demo
                mission is fully playable on a stylized neon grid.
              </p>
            </div>
          </>
        )}

        <p className="credit">3D imagery © Google · Powered by CesiumJS</p>
      </div>
    </div>
  );
}
