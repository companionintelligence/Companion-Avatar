# Spatial Companion BFF (ci-spatial-companion-proxy) — CI marketplace sidecar.
# Streams chat from a runtime-configured upstream (Ollama / OpenAI-compatible / CI-Server).
# Published as ghcr.io/companionintelligence/ci-spatial-companion-proxy.
#
# Build context is the repo root (pnpm workspace).
#
# Runs under Deno (`deno run`, via its npm/Node compat mode — see
# apps/proxy/deno.json) rather than Node, as part of an org-wide Node→Deno
# migration. The BFF's own source is untouched: @hono/node-server's `serve()`
# runs on Deno's node:http compat exactly as it does on Node. `deno compile`
# is deliberately not used for either stage — it isn't reliable against
# pnpm's symlinked node_modules layout — so this stays `deno run` in a
# container, matching how the sidecar was already deployed.
#
# Multi-arch: .github/workflows/publish-proxy.yml publishes this image for
# linux/amd64 and linux/arm64, so arm64 Hubs can run the sidecar. Every base
# image below is published for both. The runtime image receives only plain
# JavaScript: the proxy's tsc output and its production node_modules
# (`pnpm deploy --prod` from pnpm-lock.yaml, checked below for anything built
# for one CPU). So every RUN step runs on the builder's own platform
# ($BUILDPLATFORM), and the runtime stage only copies that output onto the
# target platform's Deno image. A cross-build therefore emulates nothing, and
# both architectures get the same dependency tree from the one lockfile. The
# build stage's workspace install does fetch native build tools (esbuild,
# rollup) for the builder, which is where they run; none of them reach the
# runtime image.

# ---- deno binary for the build stage ----
# Official "bin" image variant, meant to be copied from — see
# https://github.com/denoland/deno_docker. Pinned to the same Deno version
# this migration was developed and tested against. A named stage on
# $BUILDPLATFORM, so the binary always matches the build stage that runs it.
FROM --platform=$BUILDPLATFORM denoland/deno:bin-2.9.5 AS deno-bin

# ---- build stage ----
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
COPY --from=deno-bin /deno /usr/local/bin/deno
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# `deno task build` runs the same `tsc` this package always built with (see
# apps/proxy/deno.json), against the node_modules pnpm just installed above —
# just invoked through Deno instead of a Node binary.
RUN deno task --cwd apps/proxy build
# The proxy's production dependencies, at the versions pinned in
# pnpm-lock.yaml: `pnpm deploy --prod` installs only the proxy's
# `dependencies`, from the lockfile, into /prod/proxy. node-linker=hoisted
# lays them out as a flat, npm-style node_modules with no symlinks. pnpm 10
# derives the deploy's lockfile from the workspace one only when
# inject-workspace-packages is on; it is set for this command alone, and the
# proxy has no workspace dependencies for it to affect.
RUN pnpm --filter @ci-avatar/proxy --prod \
      --config.inject-workspace-packages=true --config.node-linker=hoisted \
      deploy --frozen-lockfile /prod/proxy

# ---- production dependencies ----
# Only the proxy's `dependencies` (hono, @hono/node-server, @sentry/node,
# livekit-server-sdk), whose whole tree is plain JavaScript, exactly as pinned
# in pnpm-lock.yaml (the `pnpm deploy` above). `--prod` is what keeps the tree
# plain: devDependencies such as tsx and vitest would bring esbuild and vite's
# bundler, whose native binaries are picked for the machine running the build
# (the check below rejects them).
FROM --platform=$BUILDPLATFORM denoland/deno:2.9.5 AS deps
WORKDIR /app
COPY apps/proxy/package.json ./package.json
COPY apps/proxy/deno.json ./deno.json
COPY --from=build /prod/proxy/node_modules ./node_modules
# This node_modules is copied unchanged into every architecture's image, so no
# package in it may be built for one CPU. Such a package (a prebuilt binary
# that declares "cpu" in its package.json) is picked for the machine running
# the build, not for the target, so fail the build rather than ship one. A
# runtime dependency that needs one has to be installed per target instead
# (for example with pnpm's supportedArchitectures setting).
RUN found="$(grep -rlE --include=package.json '"cpu"[[:space:]]*:' node_modules)"; \
    status=$?; \
    if [ "$status" -eq 0 ]; then \
      printf '%s\n' "These npm packages are built for one CPU and cannot be shared across architectures:" "$found" >&2; \
      exit 1; \
    fi; \
    [ "$status" -eq 1 ]

# ---- runtime stage ----
# The target platform's Deno image. There is no RUN from here on, so building
# this stage for another architecture needs no emulation. With a package.json
# in /app, Deno's nodeModulesDir defaults to "manual"
# (https://docs.deno.com/runtime/reference/deno_json/): it uses the
# node_modules copied below as installed and does not install anything itself.
FROM denoland/deno:2.9.5 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app ./
COPY --from=build /app/apps/proxy/dist ./dist
# Error reporting (Sentry) is opt-out and read entirely at RUNTIME — set
# SENTRY_DSN and reporting is on unless a kill switch below turns it off; with
# SENTRY_DSN unset nothing initialises and the process makes no outbound call.
# All optional:
#   SENTRY_DSN=https://<key>@o<org>.ingest.us.sentry.io/<id>
#   SENTRY_ENV / APP_ENVIRONMENT / SENTRY_RELEASE / APP_VERSION
#   CI_TELEMETRY=off      — kill switch; also gates the browser via /api/config/telemetry
#                           (unset is NOT off: it leaves the DSN in charge)
#   CI_LOCAL_ONLY=true    — local-only mode: zero phone-home, beats everything
# See docs/operations/error-reporting.md.
#
# The DSN is read from the process env, so it COULD be supplied purely at run
# time — but nothing supplies it: the marketplace runs this published sidecar
# as-is, which is why the proxy has reported nothing. Released images are built
# with `--build-arg SENTRY_DSN=…` and it is re-exported as ENV here, so a
# marketplace install reports out of the box. Built without the arg the ARG
# default is empty, which resolveTelemetrySettings already treats as unset
# ("no-dsn") — nothing initialises and no outbound call is made.
#
# Both kill switches above are separate runtime vars and still beat a baked-in
# DSN, and a runtime `-e SENTRY_DSN=…` still overrides this value.
ARG SENTRY_DSN=""
ARG SENTRY_RELEASE=""
ENV SENTRY_DSN=${SENTRY_DSN} \
    SENTRY_RELEASE=${SENTRY_RELEASE}
EXPOSE 8787
CMD ["deno", "run", "-A", "dist/server.js"]
