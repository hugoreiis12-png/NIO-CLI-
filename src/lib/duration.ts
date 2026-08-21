export function durationSeconds(start: string, end: string | null): number {
  const endMs = end ? new Date(end).getTime() : Date.now();
  return Math.floor((endMs - new Date(start).getTime()) / 1000);
}
