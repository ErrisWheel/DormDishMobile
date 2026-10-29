DormDish local test isolation fix

Apply this one file to E:\DormDishMobile:
  tests\api.test.js

Why: npm test starts a temporary local SQLite API. If DATABASE_URL is inherited from
.env, the server entrypoint may select PostgreSQL/Neon instead and tests attempt to
log in against the existing database. The test process now explicitly clears DATABASE_URL
and uses configured DEMO_* passwords, falling back to the documented demo defaults.
This does not change the app or Render environment variables and does not write to Neon.

After replacing the file, run from the repo root:
  npm test

These tests are local integration tests; a failed authorization test after this change
should be diagnosed from its new exact message rather than by changing Neon credentials.
