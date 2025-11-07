# Repository Guidelines

## Project Structure & Module Organization
- `backend/` hosts the Express API; run all Node tooling from this directory.
- `backend/src/index.ts` defines HTTP routes (health + Firestore) and serves both dev and production entrypoints.
- `backend/src/firebase.ts` centralizes Firebase Admin setup; extend helpers here instead of reinitializing the SDK.
- `backend/dist/` is produced by `npm run build`; treat compiled output as disposable.
- `agent/mas.md` documents the Python agent service; mirror any contract changes between this spec and backend handlers.

## Build, Test, and Development Commands
- `npm install` (run in `backend/`) installs runtime dependencies and TypeScript tooling.
- `npm run dev` launches the server with `ts-node` for quick iteration.
- `npm run build` compiles to `dist/` and surfaces type errors via `tsc`.
- `npm run start` runs the compiled server and mirrors production.

## Coding Style & Naming Conventions
- Match existing TypeScript style: 4-space indent, single quotes, trailing commas; add a Prettier config if automation is required.
- Use `camelCase` for variables/functions, `PascalCase` for types/classes, and descriptive route names (e.g., `firestoreLookupHandler`).
- Centralize Firestore access in helpers, favor `async/await`, and rely on the shared error middleware for consistent responses.

## Testing Guidelines
- Do not write any test

## Commit & Pull Request Guidelines
- Do not make and push any commit

## Security & Configuration Tips
- Load secrets from `.env` files locally and lean on Cloud Run or Firebase-managed service accounts in production; never commit credentials.
- Update `firebase.json`, `deploy.sh`, and this guide together whenever deployment behavior or configuration changes.
