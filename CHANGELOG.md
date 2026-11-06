# Changelog

## [Unreleased]

### Added

- `modelChains` on `swarm_run` and `run_judge_panel`: ordered models per harness, moving on only when a run fails or returns nothing.
- Run artifacts, rows and panel judges record `model`, `reportedModel` and `attempts`.

### Changed

- Gemini CLI is retired from default runs, because Google refuses personal sign-in. Naming it still runs it.
- Cursor uses ACP under `auto` when a model is set.

### Fixed

- `run_judge_panel` publishes `modelChains`. Its MCP schema now comes from the validated one, so the two can't drift.
- ACP errors keep the peer's code and message instead of a generic line.
- ACP runs now apply the requested model through the session's model option, restore the previous default afterwards, and stop before any prompt if the model can't be confirmed. The model used to be dropped silently.

## [0.1.1] — 2026-10-22

### Fixed

- Reject Grok's `agent.exe` alias when it is discovered under the Cursor harness, preventing duplicate-provider votes.

- Require a true strict majority and exclude failed or timed-out harness output from voting.
- Reject malformed, duplicate, incomplete, or unexpected manifest replies; report panels with no usable votes as failures.
- Preserve repeated run artifacts and completed results when another harness or a summary write fails.
- Resolve evidence and artifact paths through filesystem links to enforce workspace and secret-path boundaries.
- Launch supported Windows npm Node shims without CMD; reject unsafe arguments to unsupported custom batch launchers.
- Handle stdin delivery errors, launch exceptions, and forced-termination escalation without reporting false success.
- Match exact CLI flag names and validate local launch targets during dry runs.
- Authenticate supported Grok ACP sessions and retain phase-specific timeouts, EOF, cancellation, and stderr diagnostics.

### Compatibility notes

- Run, swarm, and panel artifact directories now have unique suffixes. Consume returned paths rather than constructing directory names.
- Custom Windows batch launchers reject shell-sensitive arguments. Use a native executable, supported npm Node shim, or advertised ACP transport.
- Errors may now include `execution_failed` or `artifact_storage`; completed results remain available when summary storage fails.
- Dry runs can execute version/help discovery probes. Live provider availability and image access still require separate verification.
