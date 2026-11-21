// One JSON object per line: easy to grep, and easy to ship to a log service later.
export function log(event: string, data: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === 'test') return;
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));
}
