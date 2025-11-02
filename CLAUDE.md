# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Actual is a local-first personal finance tool written in NodeJS with a synchronization component. The codebase is organized as a **Yarn monorepo** with multiple interconnected packages.

## Key Commands

### Development

```bash
# Start browser development mode (most common)
yarn start
# or explicitly:
yarn start:browser

# Start desktop Electron development
yarn start:desktop

# Start sync server with browser client
yarn start:server-dev
```

### Building

```bash
# Build browser version
yarn build:browser

# Build desktop Electron app
yarn build:desktop

# Build sync server
yarn build:server

# Build API package
yarn build:api
```

### Testing

```bash
# Run all tests across packages
yarn test

# Run tests with debug mode
yarn test:debug

# Run browser E2E tests
yarn e2e

# Run desktop E2E tests
yarn e2e:desktop

# Run visual regression tests
yarn vrt

# Run visual regression tests in Docker
yarn vrt:docker

# Run a single test file in a package
cd packages/loot-core && yarn test:node path/to/test.test.ts
cd packages/desktop-client && yarn test path/to/test.test.tsx
```

The project uses **Vitest** for unit tests and **Playwright** for E2E tests.

### Linting and Type Checking

```bash
# Run linter and prettier
yarn lint

# Fix linting issues
yarn lint:fix

# Type check all packages
yarn typecheck
```

Pre-commit hooks run `yarn lint-staged` automatically via Husky.

### Internationalization

```bash
# Generate i18n files
yarn generate:i18n
```

## Package Architecture

The monorepo contains these key packages:

### `loot-core`
- **Purpose**: Core application logic that runs on any platform
- **Location**: `packages/loot-core/`
- **Key directories**:
  - `src/server/` - Backend logic including budgets, accounts, sync, rules, importers
  - `src/platform/` - Platform-specific abstractions for client/server
  - `src/shared/` - Shared utilities and types
  - `src/types/` - TypeScript type definitions
- **Build targets**:
  - Browser: `yarn build:browser` or `yarn watch:browser`
  - Node/Desktop: `yarn build:node` or `yarn watch:node`
- **Tests**: `yarn test:node` and `yarn test:web`

### `desktop-client` (published as `@actual-app/web`)
- **Purpose**: Frontend web UI for both browser and desktop
- **Location**: `packages/desktop-client/`
- **Key directories**:
  - `src/components/` - React components organized by feature
  - `src/queries/` - Data query logic
  - `src/prefs/` - Preferences management
- **Tech stack**: React 19, Redux Toolkit, Vite
- **Start dev**: `yarn start:browser` or `yarn watch`
- **Tests**: `yarn test` (Vitest), `yarn e2e` (Playwright)

### `desktop-electron`
- **Purpose**: Electron wrapper for offline desktop usage
- **Location**: `packages/desktop-electron/`
- **Start dev**: `yarn watch` (run from root with `yarn start:desktop`)
- **Build**: `yarn build` (creates installers for macOS, Windows, Linux)
- **Tests**: `yarn e2e` (desktop-specific Playwright tests)

### `sync-server` (published as `@actual-app/sync-server`)
- **Purpose**: Synchronization server for multi-device sync
- **Location**: `packages/sync-server/`
- **Dependencies**: Includes `@actual-app/web` as workspace dependency
- **Start**: `yarn start` or `yarn start-monitor` (with auto-reload)
- **Scripts**:
  - `yarn db:migrate` / `yarn db:downgrade` - Database migrations
  - `yarn reset-password` - User management
  - `yarn health-check` - Server health

### `api` (published as `@actual-app/api`)
- **Purpose**: Node.js API for programmatic access to Actual
- **Location**: `packages/api/`
- **Build**: `yarn build:api` (from root)

### `component-library` (published as `@actual-app/components`)
- **Purpose**: Shared React component library
- **Location**: `packages/component-library/`
- **Exports**: Icons, UI primitives, hooks

### `plugins-service`
- **Purpose**: Plugin architecture for extending Actual
- **Location**: `packages/plugins-service/`
- **Build**: `yarn build` or `yarn build-dev`

### `crdt` (published as `@actual-app/crdt`)
- **Purpose**: CRDT (Conflict-free Replicated Data Type) implementation for sync
- **Location**: `packages/crdt/`

## Build System

- **Build tool**: Vite (for desktop-client and loot-core browser builds)
- **TypeScript**: TypeScript 5.9+ with incremental compilation
- **Package manager**: Yarn 4.10.3+ (required)
- **Node version**: Node 22+ (required)
- **Path aliases**:
  - `loot-core/*` → `packages/loot-core/src/*`
  - `@desktop-client/*` → `packages/desktop-client/src/*`

## Platform-Specific Code

loot-core uses conditional exports for platform-specific implementations:
- `.web.ts` - Browser implementation
- `.electron.ts` - Electron/desktop implementation
- `.api.ts` - API-specific implementation

Example: `src/platform/client/fetch/index.ts` (Node) vs `index.browser.ts` (Web)

## Data Flow Architecture

1. **Client Layer** (`desktop-client`):
   - React components dispatch Redux actions
   - Components query data via hooks from `loot-core/client`

2. **Core Layer** (`loot-core`):
   - Server-side logic handles budgets, transactions, rules
   - CRDT-based sync for conflict-free multi-device updates
   - SQLite database (better-sqlite3 on Node, sql.js in browser)

3. **Sync Layer** (`sync-server`):
   - Express server manages device synchronization
   - Authentication via OpenID or local accounts

## Code Organization Patterns

### Server-side code (`loot-core/src/server/`)
Organized by domain:
- `accounts/` - Account management
- `budget/` - Budgeting logic
- `rules/` - Transaction rules engine
- `schedules/` - Recurring transactions
- `importers/` - Bank import parsers (OFX, QIF, etc.)
- `aql/` - Actual Query Language (internal query system)

### Client-side code (`desktop-client/src/components/`)
Organized by feature/page:
- `accounts/` - Account views
- `budget/` - Budget interface
- `modals/` - Modal dialogs
- `settings/` - Settings screens
- `reports/` - Financial reports

## Development Workflow

1. **Feature Development**:
   - Small improvements: Submit PR directly
   - Large features: Open issue first for discussion

2. **Making Changes**:
   - Frontend changes: Usually only touch `desktop-client`
   - Backend/logic changes: Modify `loot-core/src/server/`
   - Cross-platform: Check both `.web.ts` and `.electron.ts` variants

3. **Testing**:
   - Write unit tests alongside code changes
   - Run E2E tests for UI changes: `yarn e2e`
   - Visual changes should pass VRT: `yarn vrt`

4. **Before Committing**:
   - Husky runs `lint-staged` automatically
   - Ensure `yarn lint` and `yarn typecheck` pass
   - Generate release notes: `yarn generate:release-notes`

## Important Notes

- **UI Philosophy**: Minimize settings; use progressive disclosure; avoid "a button for everything"
- **Database**: SQLite-based with CRDT layer for sync
- **Internationalization**: Translations managed via Weblate, stored in separate repo
- **Browser Support**: Targets modern browsers and Electron 35+
- **Migration**: Never modify existing migrations in `packages/loot-core/migrations/`
