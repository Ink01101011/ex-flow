## Development

Scripts:

- `pnpm run dev` - run local playground
- `pnpm run test` - run tests
- `pnpm run build` - build library into `dist/`
- `pnpm run lint` - run oxlint
- `pnpm run format` - format with oxfmt
- `pnpm run format:check` - verify formatting
- `pnpm run ci` - run format check + lint + test + build

## Publish Workflow

This repo includes:

- `.github/workflows/ci.yml` for pull request and push verification
- `.github/workflows/publish.yml` for npm publish on GitHub Release

Required secret:

- `NPM_TOKEN` with publish access on npm

Before first publish:

1. Ensure package name/version are correct in `package.json`
2. Create npm token and set `NPM_TOKEN` in GitHub repository secrets
3. Create a GitHub Release to trigger publish workflow

## Release Hardening Checklist

Before each consumer-facing release:

1. Run compatibility checks:
   - Validate ordering expectations in both `level` and `throughput` modes.
   - Confirm `tieFallbackPolicy` migration impact in release notes.
2. Run diagnostics checks:
   - Verify cycle errors include `diagnostics.cyclePath` and unresolved nodes.
   - Verify invalid option errors include structured diagnostics fields.
3. Run throughput benchmark:
   - Execute `pnpm run bench`.
   - Record round count and deferred node trends for regressions.
4. Validate fairness behavior:
   - Ensure aging + max deferral scenarios are covered by tests.
