# Validation record

Validated locally on 2026-09-18 with Node **22.23.2** and the committed dependency lockfile.

| Check                                            | Result                                  |
| ------------------------------------------------ | --------------------------------------- |
| Dependency installation                          | Passed                                  |
| ESLint                                           | Passed                                  |
| TypeScript source and test type checks           | Passed                                  |
| TypeScript production build                      | Passed; compiled entrypoints in `dist/` |
| Automated tests                                  | **27 passed**, 5 test files             |
| Formatting check                                 | Passed                                  |
| `npm audit` (including development dependencies) | **0 known vulnerabilities**             |
| Combined Docker Compose configuration            | Passed                                  |
| Split Docker Compose configuration               | Passed                                  |

Tests cover all three compiled stdio entrypoints, a real Streamable HTTP SDK client roundtrip, project routing, read-only annotations, API request shapes and pagination, discovery opt-in, validation failures, URL property boundaries, secret encryption/tampering/permissions, scope checks, redacted errors, cancellation, bounded API requests, Host/Origin/bearer checks, OAuth discovery, and JWT signature/issuer/audience/expiry/scope validation.

## Not verified live

- No Google credentials or actual property IDs were supplied. Google API payloads were mocked; live consent, token refresh and property access need an operator smoke test after setup.
- JWT verification and OAuth metadata were tested locally. No external authorization server or ChatGPT/Claude/Cursor/VS Code UI login flow was deployed or exercised. Client setup examples are based on linked official documentation.
- Docker Compose files were validated, but an image build/runtime test could not run because the local Docker daemon was not running. CI includes an image build job.
- Local execution used Node 22. CI is configured for Node 20, 22 and 24; the other versions were not run on this machine.

The initial HTTP test attempt was blocked by sandbox loopback restrictions; the final successful run used permitted local networking. A temporary disk-space issue was resolved for this task without deleting user files. Neither limitation caused tests to be skipped.
