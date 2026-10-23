# Contributing

Useful contributions include reproducible Windows reports, native MCP Apps host
compatibility, accessibility and translation improvements, tests, and fixes that
preserve the local confirmation boundary.

1. Fork the repository and create a focused branch.
2. Run `npm run setup`, `npm run check`, `npm test`, `npm run verify` and
   `npm run verify:stdio` as a regular user.
3. Describe the OS, Node/Python versions, expected behavior and observed result.
   State clearly which checks were not run.
4. Submit a focused pull request with the relevant validation results.

Do not upload live diagnostic reports, process lists, screenshots containing
private data, credentials, `.env` files or local environments. Use synthetic,
minimal fixtures when reporting a bug. Keep `artifacts/` and `dist/` local.

Do not broaden process-stop permissions, add forced-kill fallbacks, bypass local
approval, expose the control port, or treat process names as trusted input.
Tests that send a real signal must target only a disposable child created by the
test itself. Run all tests on a development computer where these bounds can be
verified.

By contributing code, you agree to license your contribution under the project's
MIT license. Report security concerns as described in [SECURITY.md](SECURITY.md).
