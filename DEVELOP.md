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
