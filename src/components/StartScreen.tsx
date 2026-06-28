'use client';

interface Props {
  onStart: () => void;
  hasApiKey: boolean;
}

export default function StartScreen({ onStart, hasApiKey }: Props) {
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
          <button className="btn btn-primary" onClick={onStart}>
            ► START HEIST
          </button>
        ) : (
          <div className="config-warning">
            <strong>Missing API key.</strong>
            <p>
              Create <code>.env.local</code> with{' '}
              <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=&lt;your key&gt;</code> and restart{' '}
              <code>npm run dev</code>. See the README for setup steps.
            </p>
          </div>
        )}

        <p className="credit">3D imagery © Google · Powered by CesiumJS</p>
      </div>
    </div>
  );
}
