# Pace Bros Visuals — Vanilla Site

This is a framework-free rebuild of the original Pace Bros Visuals landing page. It preserves the original visual direction and interactions while removing React, Tailwind, Vite, TanStack Start, and Lovable-specific project files.

## Run it locally

Because this is a static site, open `index.html` in a modern browser or serve this folder with any simple local web server. No package installation or build command is required.

## Project structure

- `index.html` — semantic page structure and metadata
- `css/main.css` — visual system, responsive layout, and cinematic effects
- `js/main.js` — page content, intro transition, scroll reveals, particles, and process interaction
- `assets/images/` — the original logo and image assets copied unchanged from the Lovable export

## Important next steps

1. Replace placeholder featured-film copy and stills with real released work.
2. Add a short muted MP4 preview to each film only when those clips are ready. The existing hover treatment is kept intact; native video can be layered into each film card without changing the overall structure.
3. Use GitHub as the source repository and deploy this static folder through GitHub Pages or another static host.
4. Build the future admin, storage, scheduling, and authentication system separately. A static site can later fetch published film data from that service.

## What is intentionally not included

The original archive did not contain an admin panel, database, authentication, storage, video files, or preview-video feature. Those are future features, not removed functionality.
