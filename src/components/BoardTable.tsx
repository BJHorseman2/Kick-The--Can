'use client';

import { Board } from '@/game/leaderboard';

/** The daily challenge board: top rows, plus your own row if you're further down. */
export default function BoardTable({ board, you, limit = 10 }: { board: Board; you?: string; limit?: number }) {
  const rows = board.entries.slice(0, limit);
  const youShown = rows.some((e) => e.callsign === you);
  return (
    <ol className="board">
      {rows.map((e) => (
        <li key={e.callsign} className={e.callsign === you ? 'you' : ''}>
          <span className="board-rank">{e.rank}</span>
          <span className="board-name">{e.callsign}</span>
          <span className="board-score">{e.score.toLocaleString()}</span>
        </li>
      ))}
      {board.you && !youShown && (
        <li className="you">
          <span className="board-rank">{board.you.rank}</span>
          <span className="board-name">{board.you.callsign}</span>
          <span className="board-score">{board.you.score.toLocaleString()}</span>
        </li>
      )}
    </ol>
  );
}
