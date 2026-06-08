let active: AbortController | null = null;

export function startNewTaskAbortController(): AbortController {
  cancelActiveTask();
  active = new AbortController();
  return active;
}

export function cancelActiveTask(): void {
  active?.abort();
  active = null;
}
