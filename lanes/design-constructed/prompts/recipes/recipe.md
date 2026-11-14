You are in a fresh Linux VM. An open-source web app is checked out at /work/app, at a pinned commit. Your job is to work out how to install, seed, build and start it here, and to write that down as /work/recipe.json.

The VM has no internet. It reaches only package mirrors: npm, PyPI, Ubuntu apt, and a Docker Hub pull-through cache. They are already configured for npm, pip, apt and docker. Nothing else is reachable, so the app must run with no outside service: no outside auth provider, no hosted database, no hosted API.

Write /work/recipe.json as one JSON object with these fields:

- "install": a shell command, run in /work/app, that installs the app's dependencies from the mirrors.
- "seed": a shell command, run in /work/app after install, that creates any local data the screens need. Use "" if none is needed.
- "build": a shell command, run in /work/app, that builds the app.
- "start": a shell command, run in /work/app, that starts the app and keeps running in the foreground.
- "base_url": the address the started app serves, on http://localhost or http://127.0.0.1 with its port.
- "routes": at least 3 distinct paths of the app's own pages that show real content once seeded, such as "/projects" or "/tickets/1". Use the app's own routes, not error or login pages.
- "services" (optional): local services the app needs, each {"name": ..., "image": ..., "ports": [...], "env": {...}}, with images from Docker Hub, such as "postgres:16". They start before install.
- "login" (optional): when the pages need a signed-in user, a local test user that your seed command creates, as {"route": ..., "username": ..., "password": ..., "username_selector": ..., "password_selector": ..., "submit_selector": ...}. The controller fills the form at that route, submits it, and then loads the routes. Never use a real account or an outside sign-in.

The recipe runs later from a clean copy of the checkout, so it must work on the code exactly as it is at /work/app. Don't rely on files you changed or added in /work/app.

Check each command here before you write it down: install, seed, build, start, then load each route and confirm it shows the app's content. When you are done, /work/recipe.json must exist and be valid JSON.
