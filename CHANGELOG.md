# Changelog

## 0.1.4 — 2026-10-23

- Prepare the first public source release under the MIT license.
- Add English/Russian documentation, contribution and security guidance.
- Build source archives from an explicit allowlist; exclude local reports,
  environments, credentials and generated output.
- Add archive privacy regression coverage and CI for Linux, macOS and Windows.
- Read server version metadata from package.json to keep manifests consistent.
- Refresh MCP SDK and affected transitive dependencies before public release.
- Use POSIX path fixtures when testing macOS process policy on Windows.
- Document executable permission for the downloaded macOS launcher.

Publishing a CI workflow is not a passed CI run. Native chat rendering and
Windows UI interaction still require explicit validation evidence.

## 0.1.3 — 2026-10-03

- Add MCP Apps iframe bridge handling, visible error/cancellation states,
  recovery, memory sorting and host size notifications.
- Record local macOS, transport and isolated widget validation.
