# Repository Guidelines

## Project Structure & Module Organization

Amber is a Node.js ESM application for Windows notifications, health monitoring, and change-record delivery. Runtime entry points live in `scripts/`, reusable modules in `scripts/lib/`, event adapters in `scripts/hooks/`, and the dashboard in `dashboard/`. Tests live in `test/`; design and release documents belong in `docs/`. Runtime queues and state belong under ignored `.local/`, never in source control.

## TClaw Terminology

TClaw is the company's internal OpenClaw deployment on Alibaba Cloud. It deeply integrates with Feishu (documents, Base, calendars, tasks, and messages), supports AI change tracking, Git integration, and development-context recovery, runs scheduled reminders and checks, and remembers work context across sessions.

## Build, Test, and Development Commands

- `npm test` runs the complete `node:test` suite; there is no separate build step.
- `npm run dashboard` serves the local dashboard at `http://127.0.0.1:3847`.
- `npm run watch:all` starts the notification, UI-prompt, record, and health watchers.
- `npm run health:status` prints a read-only health snapshot.
- `npm run records:dry-run` and `npm run commits:dry-run` preview queued webhook payloads without delivery.

Use a current Node.js release with ESM and the built-in test runner. The Windows integration also requires PowerShell.

## Coding Style & Naming Conventions

Follow the existing JavaScript style: two-space indentation, double quotes, semicolons, trailing commas only where already used, and named ESM imports/exports. Use `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for exported constants, and kebab-case filenames such as `health-alerts.mjs`. Keep platform-specific behavior isolated in the PowerShell or listener modules. No formatter or linter is configured, so match neighboring code and keep diffs focused.

## Testing Guidelines

Write tests with `node:test` and `node:assert/strict`. Name files `test/<feature>.test.mjs` and use behavior-focused test descriptions. Prefer temporary directories and injected environment values over touching `.local/` or real webhooks. Run `npm test` before submitting changes; add regression coverage for fixes and tests for new state transitions or queue behavior.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit-style subjects, including `feat:`, `fix(records):`, and `docs(README):`. Use an imperative, focused subject and add a scope when it clarifies the affected subsystem. Pull requests should explain the user-visible change, list validation performed, link related issues, and include screenshots for dashboard changes. Call out new environment variables or Windows permission requirements explicitly.

## Security & Configuration

Copy `.env.example` to `.env.local` for local configuration. Never commit webhook URLs, bearer tokens, `.env*` secrets, or `.local/` queue contents. Use dry-run commands when validating delivery changes.
