# Hosting the reference web client on Hostinger from GitHub

The reference client is a static Vite build (`apps/web/dist`). Two supported paths:

## Path 1 - Hostinger Node.js web app (build on Hostinger)
1. hPanel -> Websites -> Add website -> **Node.js web app** -> **Import Git repository** ->
   connect GitHub and select `therexdev/Open-Social-Protocol`.
2. Branch: the branch you want to publish (e.g. `main` after merging this work).
3. Review build settings (override the auto-detected values):
   * Framework: Vite (or "Other")
   * Node version: 22
   * Install command: `npm install`
   * Build command: `npm run build`
   * Output directory: `apps/web/dist`
   * Root directory: repository root (leave empty). Do not point it at `apps/web`; the
     workspace packages `@osp/proto` and `@osp/sdk` are built by the root build command.
4. Optional environment variables (build time): `VITE_OSP_NETWORK=harbinger`,
   `VITE_OSP_INDEXER_URL=https://...`, `VITE_OSP_SPONSOR_URL=https://...`,
   `VITE_OSP_RPC_URLS=https://harbinger-api.koinos.io`.
5. Deploy. Every push to the selected branch triggers a rebuild.

## Path 2 - static branch (no build on Hostinger)
`.github/workflows/deploy-web.yml` builds the client on every push and force-pushes the
contents of `apps/web/dist` to the `hostinger-static` branch. In hPanel use
Websites -> Git -> Create repository with that branch and `public_html` as the install path,
then enable the auto-deploy webhook shown in hPanel (add its URL as a GitHub webhook on push).
This path works on any Hostinger plan, including plain web hosting.

## SPA routing
The build includes a `.htaccess` rewriting unknown paths to `index.html` so deep links
(`/post/<id>`) work on Apache/LiteSpeed hosting.
