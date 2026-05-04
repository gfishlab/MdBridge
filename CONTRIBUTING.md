# Contributing to MDBridge

## Development Setup

1. Clone the repo
2. `npm install`
3. `npm run tauri dev`

## Running Tests

```bash
# Frontend tests
npm test

# Rust tests
cargo test --manifest-path src-tauri/Cargo.toml

# Lint
npm run lint
```

## Code Style

- TypeScript: ESLint rules
- Rust: rustfmt + clippy

## Pull Request Process

1. Create a feature branch from `main`
2. Make changes with tests
3. Ensure CI passes
4. Request review
