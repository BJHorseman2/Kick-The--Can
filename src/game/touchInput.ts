// Shared analog input bus between the on-screen touch controls (React) and
// the GameEngine loop. A plain mutable singleton keeps the hot path
// allocation-free and avoids plumbing refs through the component tree.
//
// x: -1..1  bank left/right      y: -1..1  dive(-) / climb(+)
export const touchInput = {
  x: 0,
  y: 0,
  boost: false,
};

export function resetTouchInput(): void {
  touchInput.x = 0;
  touchInput.y = 0;
  touchInput.boost = false;
}
