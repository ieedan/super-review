// Coalesces and time-budgets DOM-heavy render work so a single state change
// (tab switch, view-mode flip, scroll burst) doesn't block the main thread.
// Tasks queue up and run inside requestAnimationFrame; the queue drains until
// either it's empty or the per-frame budget is spent, then yields to paint
// before continuing on the next frame.

const FRAME_BUDGET_MS = 8;

type RenderTask = () => void;

const queue: RenderTask[] = [];
let scheduled = false;

function tick(): void {
  scheduled = false;
  const start = performance.now();
  while (queue.length > 0) {
    const task = queue.shift()!;
    try {
      task();
    } catch (err) {
      console.error('render task failed:', err);
    }
    if (performance.now() - start >= FRAME_BUDGET_MS) break;
  }
  if (queue.length > 0) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(tick);
}

// Enqueue a render task. Returns a cancel function — callers should invoke it
// when the task becomes obsolete (e.g. component unmounted, newer render
// supersedes this one) so the queue doesn't run stale work.
export function scheduleRender(task: RenderTask): () => void {
  queue.push(task);
  schedule();
  return () => {
    const idx = queue.indexOf(task);
    if (idx >= 0) queue.splice(idx, 1);
  };
}
