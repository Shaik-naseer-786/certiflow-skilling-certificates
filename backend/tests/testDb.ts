// Tests run in their own Postgres SCHEMA ("certiflow_test") so they never touch demo data.
export function testDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://certiflow:certiflow@localhost:5433/certiflow';
  const url = new URL(base);
  url.searchParams.set('schema', 'certiflow_test');
  return url.toString();
}
