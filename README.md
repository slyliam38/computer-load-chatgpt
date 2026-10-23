# Computer Load for ChatGPT and Codex

[Русская документация](README.ru.md) · [MIT license](LICENSE) · [Validation](VALIDATION.md)

A local-first MCP plugin that helps explain why a computer feels slow. It takes
a short CPU, memory, disk and network sample, then displays the busiest processes
in an interactive dashboard. It runs on the computer being diagnosed.

This is an independent community project, not an official OpenAI product or a
ChatGPT directory listing. The dashboard and current user-facing messages are in
Russian. macOS has been exercised locally; real Windows UI operation and the
widget inside a native ChatGPT/Codex chat remain unverified.

## What it does

- Samples for 2–10 seconds and returns at most 50 processes (defaults: 3 seconds,
  25 processes).
- Shows CPU activity, available RAM, swap growth, free disk space, disk throughput
  and network throughput, with labels when a metric is unavailable.
- Keeps reports and process-stop proposals in memory, with expiry and bounded
  request queues.
- Supports MCP over stdio and a loopback HTTP endpoint, plus an MCP Apps widget.
- Offers a separate, explicitly confirmed close request for a small allowlist of
  media applications. Diagnostics alone never close an application.

The project does not measure GPU, temperature, native macOS memory pressure or
disk health, and does not scan files or identify malware. A short sample cannot
prove sustained overload. Per-process RSS values must not be summed as exact
machine RAM usage.

## Run locally

Requirements: Node.js **20+**, Python **3.9+**, npm and access to npm/PyPI during
setup. On Windows, install the Python launcher (`py`). Run as a regular user.

```sh
npm run setup
npm start
```

Open **http://127.0.0.1:8798** and choose the diagnosis button. Keep the terminal
open while using the agent. Alternatively, launch `Start-macOS.command` or
`Start-Windows.cmd`; the first launch prepares project-local dependencies.

The standalone panel works without an AI account or API key. Exporting its JSON
report and sharing that report is a separate user action. Installation downloads
dependencies; normal sampling does not call an external API.

## Connect an MCP client

Prepare dependencies first. Configure the client to launch:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/computer-load-chatgpt/server/main.mjs", "--stdio"],
  "cwd": "/absolute/path/to/computer-load-chatgpt"
}
```

Only one instance can use the default ports at a time. A stdio instance starts
its own local confirmation panel, so stop a standalone instance that you started
before launching the same plugin through a client. Custom instances can use
`COMPUTER_LOAD_MCP_PORT` and `COMPUTER_LOAD_LOCAL_PORT` with different loopback ports.

The repository includes `plugin.json`, `mcp.json`, a local marketplace manifest,
and a model skill. See the [desktop and private-tunnel setup](README.ru.md#подключение-к-chatgpt)
for the integration tested during development. Client support and tunnel access
depend on the host and account. OpenAI usage is billed by the host; this project
does not provide model access or reset account limits.

| MCP tool | Effect |
| --- | --- |
| `diagnose_computer` | Collect a bounded fresh sample. |
| `show_diagnosis` | Display an existing, unexpired sample. |
| `prepare_process_stop` | Create a local confirmation proposal; send no signal. |
| `get_stop_status` | Read the proposal status and checked outcome. |

## Privacy and process controls

Reports contain process names, PIDs and resource metrics. Command-line arguments,
file contents, usernames, executable paths, hostnames and network addresses are
not included. Executable identity and ownership are checked locally. Process
names are untrusted input and must never be treated as instructions.

The control panel binds to `127.0.0.1:8798`, verifies local address, Host, Origin
and CSRF, and cannot be embedded in a frame. The MCP endpoint binds to
`127.0.0.1:8797`. **Do not expose either port to the public Internet.** Public
authentication and multi-user agent isolation are not implemented.

A human must confirm a proposed close in the local panel by entering the exact
application name and confirming saved work. The agent rechecks identity, owner,
creation time, policy and expiry before acting. macOS uses SIGTERM; Windows uses
WM_CLOSE for a visible window. There is no forced-kill fallback. Even SIGTERM can
lose unsaved work. System, business, remote-access, security, unknown and
other-user processes are protected or left to manual handling. ChatGPT and Codex
are protected. See [SECURITY.md](SECURITY.md) for the full boundary.

## Development and validation

```sh
npm run setup
npm run check
npm test
npm run verify
npm run verify:stdio
npm run pack:source
```

The verification commands use separate loopback test ports. Tests use fake
processes and one disposable child created by the test itself; they do not close
user applications. Live diagnostic reports and screenshots stay in ignored
`artifacts/`. Source archives are built from an explicit file allowlist into
ignored `dist/`.

See [VALIDATION.md](VALIDATION.md) for dated results and unverified cases,
[CONTRIBUTING.md](CONTRIBUTING.md) for contributions, and
[CHANGELOG.md](CHANGELOG.md) for release notes. The package is marked private to
prevent accidental npm publication; its source is available under MIT.

## Architecture and attribution

`agent/` contains Python/psutil sampling and the process policy; `server/` contains
the Node MCP bridge and local confirmation panel; `public/` contains the shared
dashboard; `skills/` contains host guidance; `tests/` and `scripts/` contain
verification and packaging tools.

Transport/resource wiring was adapted from the
[OpenAI MCP App Basics example](https://github.com/openai/openai-apps-sdk-examples/tree/main/mcp_app_basics_node)
and [Apps SDK quickstart](https://developers.openai.com/apps-sdk/quickstart).
Dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
