# Invite-gated signup; first user becomes Instance Owner

Signup is gated by a single-use **SignupCode**, with one exception: the very first account on a fresh instance (zero existing users) bypasses the gate and is granted the Better Auth global `admin` role, becoming the **Instance Owner** who then mints codes for everyone else.

We deliberately rejected an `INSTANCE_OWNER_EMAIL` env var for designating the owner. A self-hoster sets env by hand and can easily misconfigure it, use a different value than expected on first startup, or not know the value at all — a silent failure mode. "Whoever registers first on a fresh instance" has no such failure mode and matches the familiar self-hosted pattern (GitLab, Sentry, Grafana).

## Consequences

- There is a small race window between the instance going live and the owner registering, during which someone who knows the URL could claim the owner account. Acceptable for a small friends instance where the operator registers immediately after deploy. If it ever matters, an optional `INSTANCE_OWNER_EMAIL` guard on the zero-users path can be added without reworking anything.
