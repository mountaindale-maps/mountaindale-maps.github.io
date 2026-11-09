/** Undo/redo over immutable plan snapshots. */

export function createHistory(present) {
  return { past: [], present, future: [] };
}

export function commit(history, present) {
  if (JSON.stringify(history.present) === JSON.stringify(present)) return history;
  return {
    past: [...history.past, history.present].slice(-80),
    present,
    future: [],
  };
}

export function undo(history) {
  if (!history.past.length) return history;
  const present = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present,
    future: [history.present, ...history.future],
  };
}

export function redo(history) {
  if (!history.future.length) return history;
  const [present, ...future] = history.future;
  return {
    past: [...history.past, history.present],
    present,
    future,
  };
}
