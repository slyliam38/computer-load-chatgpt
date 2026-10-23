# Security and privacy

## Scope

This is a single-user, local diagnostics prototype. It is intended for a trusted
computer under the user's normal account. Public HTTPS service hosting,
multi-user operation and hostile local users are outside the supported boundary.

Both listeners bind to loopback. The local control panel checks the peer,
Host, Origin, forwarded headers, content type and CSRF token; it denies framing.
The private MCP HTTP endpoint has no public authentication. Do not forward the
control port or expose the MCP endpoint directly to the Internet.

## Process-close boundary

Diagnostics and display are read-only. `prepare_process_stop` only creates a
short-lived proposal; it does not authorize or execute a close. Execution is not
an MCP tool. A human must confirm in the separate local panel and acknowledge
saved work. Identity and policy are revalidated immediately before the request.

The allowlist covers exact main executable paths for VLC, IINA and Spotify on
macOS, and VLC and Spotify on Windows. System, business, security, backup,
synchronization, remote-access, agent, ChatGPT/Codex and other-user processes are
protected. Unknown processes are manual-only. A proposal expires in 60 seconds,
a diagnostic snapshot in 120 seconds, and a used proposal cannot be replayed.

macOS sends SIGTERM; Windows sends WM_CLOSE to a visible window. There is no
SIGKILL, Windows TerminateProcess, process-tree kill or privilege elevation in
the production close path. Normal close requests can still lose unsaved work.
Only an `exited` status confirms that the selected process exited; it does not
prove all helpers exited or that the application did not relaunch.

## Data

Public reports include process names, PIDs and resource metrics. Command-line
arguments, file contents, executable paths, owners, hostnames and network
addresses are excluded. Process identity is retained locally in memory for
policy checks. Snapshots and proposals are bounded and expire; restart clears
them. Live verification reports and screenshots must remain in ignored local
artifacts and must not be attached to public issues without careful redaction.

Process names and tool results are untrusted data. A model must not follow
instructions embedded in them. High usage alone does not establish malware,
hardware failure or permission to close an application.

## Reporting

Use GitHub's private vulnerability reporting when it is available on this
repository. If it is unavailable, open a minimal issue requesting a private
contact channel without including vulnerability details, private logs or
credentials. Do not test third-party systems or user processes without consent.

The current development line is 0.1.x. There is no response-time commitment or
guarantee of compatibility with every host/OS version; see [VALIDATION.md](VALIDATION.md).
