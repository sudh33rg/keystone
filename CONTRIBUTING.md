# Contributing to Keystone

Thank you for your interest in contributing to Keystone! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Commit Convention](#commit-convention)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Linting & Formatting](#linting--formatting)

## Development Setup

### Prerequisites

- **Node.js** >= 20
- **VS Code** ^1.95.0
- **npm** (comes with Node.js)

### Getting Started

```sh
# Clone the repository
git clone https://github.com/your-org/keystone.git
cd keystone

# Install dependencies
npm install

# Build the extension and webview
npm run build

# Open in VS Code
code .
```

To run the extension, press `F5` in VS Code to launch the Extension Development Host.

## Project Structure

```
src/
├── core/              # Domain services and business logic
├── extension/         # VS Code adapter implementations
├── shared/            # Shared contracts, types, logging, errors
├── ui/                # React/Vite Webview application
└── workers/           # Background workers
tests/
├── unit/              # Unit tests
├── extension/         # Extension integration tests
├── integration/       # Integration tests
└── ui/                # UI component tests
```

## Coding Standards

- **Language**: TypeScript with strict type checking enabled
- **Imports**: Use `consistent-type-imports` for type-only imports
- **Promises**: All promises must be handled (no floating promises)
- **Complexity**: Functions should not exceed cyclomatic complexity of 15
- **File length**: Files should not exceed 500 lines (excluding blanks and comments)
- **Nesting**: Maximum depth of 4 levels, maximum 4 nested callbacks
- **Parameters**: Maximum 5 parameters per function

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Commit messages are enforced via commitlint.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type       | Description                                      |
|------------|--------------------------------------------------|
| `feat`     | A new feature                                    |
| `fix`      | A bug fix                                        |
| `docs`     | Documentation only changes                       |
| `style`    | Changes that do not affect the meaning of code   |
| `refactor` | A code change that neither fixes nor adds feature|
| `perf`     | A code change that improves performance          |
| `test`     | Adding missing or correcting existing tests      |
| `chore`    | Changes to build process or auxiliary tools      |
| `ci`       | Changes to CI configuration files and scripts    |

### Examples

```
feat(intelligence): add semantic graph builder
fix(workflows): handle null state in workflow transition
docs: update API documentation
test(copilot): add delegation service tests
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes following the coding standards
3. Write or update tests as needed
4. Ensure all checks pass: `npm run verify`
5. Submit a pull request with a clear description of changes
6. Ensure the PR title follows the commit convention

### PR Checklist

- [ ] Code follows coding standards
- [ ] Tests added/updated and passing
- [ ] Documentation updated if needed
- [ ] Changes are covered by existing or new tests
- [ ] No new lint warnings or errors

## Testing

### Running Tests

```sh
# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run extension tests (requires build first)
npm run test:extension

# Run full verification suite
npm run verify
```

### Writing Tests

- Place unit tests in `tests/unit/` mirroring the `src/` structure
- Place UI tests in `tests/ui/`
- Place integration tests in `tests/integration/`
- Aim for at least 70% code coverage across all metrics

## Linting & Formatting

```sh
# Run ESLint
npm run lint

# Run type checking
npm run typecheck

# Full verification (typecheck + lint + test + build)
npm run verify
```

Linting and formatting are automatically enforced via pre-commit hooks using lint-staged. Code formatting uses Prettier.

## Questions?

If you have questions, feel free to open a GitHub Discussion or reach out to the maintainers.