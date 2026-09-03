/**
 * Local calendar-day helpers for the scheduler.
 *
 * "Local" is the point: FR-42's day boundary is the user's own clock, not UTC. Both
 * functions take a `Date` and return a new value — no `Date.now()` inside either, so day
 * boundaries are computed once per session and passed down, never re-read mid-review
 * ([system-design.md](../../architecture/system-design.md)).
 */

/** `YYYY-MM-DD` in local time — the key a day's set and its reviews are grouped under. */
export function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The last instant of `date`'s local day — an item due any time today still counts as due. */
export function endOfLocalDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}
