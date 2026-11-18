# Project conventions

- Read `docs/ARCHITECTURE.md` first for the current stack, entry points and verification commands.
- Multiplayer is scoped to three players in one local network. `Start.cmd` runs the LAN launcher directly.

- Use TypeScript. Keep the UI and README in Ukrainian.
- Client features use MVVM: views -> viewmodels -> model interfaces/domain.
- Views must not fetch HTTP, access Colyseus or contain puzzle rules.
- ViewModels must not import React, PixiJS or concrete infrastructure adapters.
- Wire dependencies in apps/client/src/app.
- Keep per-frame PixiJS rendering outside React state.
- Shared domain must stay independent of frameworks, network and database.
- Server uses domain/application/ports with infrastructure and transport adapters.
- Server is authoritative for group ownership and snapping. Lock entire groups.
- Never send the full 1000-piece state on every pointer movement.
- Keep credentials in ignored environment files. Use migrations for database changes.
- Keep all current work inside this project. Do not modify earlier coursework.
- Run npm.cmd run typecheck and npm.cmd run build after code changes.

## Design sources

- For UI design work, read and apply `.agents/skills/unslop/SKILL.md` and the references required by that workflow. Preserve its attribution and license.
- Unslop by Damir Sokolovsky (@heydamir), CC BY 4.0: https://github.com/heydamir/unslop
- Use Gentleface (https://gentleface.com/) as the UI icon set, including puzzle controls. The user's choice overrides the skill's fallback to Lucide.
- Use one consistent line style and native pixel grid; default to 16px controls. Keep icon styling behind client/shared/ui components.
- Gentleface supplies UI icons. Photos/artwork used as puzzle images require separate assets and licensing.
- See docs/DESIGN.md for scope and design-source details. Source adoption alone does not approve a new visual direction or add new features.

## Puzzle size

- Support integer piece counts from 1 through 3000 inclusive. The default and primary design/performance scenario is 1000.
- Use shared constants and validators; do not duplicate limits in views or server handlers.
- Piece count is canonical in PuzzleDefinition. A fixed rectangular grid must not silently round arbitrary requested counts. Exact-count geometry is implemented in `packages/shared/src/domain/geometry.ts`; preserve matching reverse seams and test prime counts.

## Additional local skills

- See docs/SKILLS.md for installed skill provenance and scope.
- For explicit security review or secure-by-default implementation requests, use .agents/skills/security-best-practices/SKILL.md and the references matching React/TypeScript/Express.
- For explicit threat-modeling requests, use .agents/skills/security-threat-model/SKILL.md. Do not trigger it for ordinary feature work or infer that installation is a completed security review.
- Existing project rules, user instructions, browser tooling constraints, and authorization requirements take precedence. These optional skills do not authorize deployment, commits, external transmissions, or unrelated changes.
