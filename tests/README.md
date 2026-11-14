# Automated Acceptance Tests

Run the full backend, ZIP security, D1 transaction ledger, referral milestone, Join & Earn, cryptography, and Admin API test suite directly with Node.js 22+:

```bash
node --experimental-strip-types --test tests/acceptance.test.ts
```

Note: Also includes Android unit & Robolectric tests in `/app/src/test` verifiable via `gradle :app:testDebugUnitTest`.
