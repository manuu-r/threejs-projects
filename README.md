# Three.js Fun

One shared vinext/Three.js app containing small browser experiments. Framework
configuration, dependencies, the worker, tests, and public assets live once at
the repository root. Each folder under `projects/` contains only the code and
styles unique to that experiment.

## Projects

- `/interactable-memes` — a tactile 3D meme deck
- `/punch-power` — a camera-tracked 3D heavy-bag challenge

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Open `http://localhost:3000/interactable-memes` or
`http://localhost:3000/punch-power`.

## Add another experiment

1. Put its component and styles in `projects/<project-name>/`.
2. Add a thin route in `app/<project-name>/` that imports them.
3. Put browser-served assets under `public/<project-name>/`.

Use `npm run build`, `npm test`, and `npm run lint` from the root for the whole
collection.
