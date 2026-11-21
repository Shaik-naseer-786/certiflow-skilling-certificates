// All tunable settings in one place. Everything can be overridden by env vars.
const num = (name: string, fallback: number) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : Number(v);
};

export const config = {
  port: num('PORT', 4000),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  queuePrefix: process.env.QUEUE_PREFIX ?? 'certiflow', // tests use another prefix so they never touch real jobs
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:8080',
  demoMode: process.env.DEMO_MODE !== 'false', // exposes the demo user switcher

  // Workflow rules
  districtApprovalsRequired: num('DISTRICT_APPROVALS_REQUIRED', 2),
  qualityThreshold: num('QUALITY_THRESHOLD', 50), // batches this big also need the quality team
  escalationMinutes: num('ESCALATION_MINUTES', 1440), // 24h by default
  passMark: num('PASS_MARK', 40),
  maxRows: num('MAX_ROWS', 1000),

  // Requests per minute per IP address (in memory, per API instance)
  rateLimit: {
    login: num('RATE_LIMIT_LOGIN', 20),
    public: num('RATE_LIMIT_PUBLIC', 120),
    api: num('RATE_LIMIT_API', 600),
  },

  // Fake WhatsApp provider behaviour (probabilities between 0 and 1)
  whatsapp: {
    failRate: num('WA_FAIL_RATE', 0.2),
    timeoutRate: num('WA_TIMEOUT_RATE', 0.1),
    callTimeoutMs: num('WA_CALL_TIMEOUT_MS', 2000), // how long we wait before giving up
    maxAttempts: num('WA_MAX_ATTEMPTS', 6), // total tries per certificate before it is marked FAILED
    backoffMs: num('WA_BACKOFF_MS', 1000), // first retry delay; doubles each time
  },
};
