# Three.js Fun

[![GitHub last commit](https://img.shields.io/github/last-commit/manuu-r/threejs-projects)](https://github.com/manuu-r/threejs-projects/commits/main)
[![GitHub repo size](https://img.shields.io/github/repo-size/manuu-r/threejs-projects)](https://github.com/manuu-r/threejs-projects)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fmeme.sparcd.com&label=meme.sparcd.com)](https://meme.sparcd.com)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fpunch.sparcd.com&label=punch.sparcd.com)](https://punch.sparcd.com)

> Three.js experiments, one repo, many happy frame bugs and 3D surprises.

This repo is a **single vinext/Next.js app shell** that hosts multiple browser-based
interactive demos with shared infra at the root:

- shared build/test/tooling config
- a single worker and runtime boundary
- shared dependencies and scripts
- shared asset pipeline and public asset hosting

Each feature lives in `projects/` and is wired through a route in `app/`.

It was vibecoded with **three.js**, **Codex**, **qwen mm-plugin**, and **Blender**.
Translation: WebGL, agent-assisted iteration, tool-generated visuals, and
modeling/iteration support that makes “rough idea” become “playable scene.”

## Live links

- [meme.sparcd.com](https://meme.sparcd.com)  
- [punch.sparcd.com](https://punch.sparcd.com)

## Demo videos (GIF)

- [![Interactable Memes demo](./demo-videos/nonsense-lab.gif)](./demo-videos/nonsense-lab.gif)
- [![Punch Power demo](./demo-videos/punch-power.gif)](./demo-videos/punch-power.gif)

## Projects in the stack

- `/interactable-memes`  
  A tactile 3D meme deck with pointer/touch interactions and remixable “mood”
  states.

- `/punch-power`  
  A camera-tracked heavy-bag challenge using MediaPipe hand landmarks, cannon-es
  physics, and Three.js scene composition.

## Local setup

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Open:

- `http://localhost:3000/interactable-memes`
- `http://localhost:3000/punch-power`

## Architecture notes (so future-you can debug faster than future-you)

This repo is intentionally structured as:

- `app/` — route entry points (thin, project-specific imports only).
- `projects/` — experiment code, scene logic, behavior, and styles.
- `public/` — static assets used by the browser runtime.
- `worker/` — edge-like runtime wrapper/entry as configured by `vinext`.
- shared root config files for lint/build/types/tests.

No major API keys or credentials are embedded in source; config and environment
secrets belong outside the repo (and should remain outside git history).

## Verification

Run before pushing:

```bash
npm run build
npm run lint
npm run test
npx tsc --noEmit
```

## Add a new experiment

1. Add code/styles under `projects/<project-name>/`.
2. Add a thin route at `app/<project-name>/page.tsx` importing the new project.
3. Add any static assets under `public/<project-name>/`.

If it boots and tests, it ships.
