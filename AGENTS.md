# AGENTS.md

## Code comments

If you need a paragraph-long comment to justify why the workaround is OK, the code is wrong. Fix the code.

After every code comment you write, ask yourself: "Is this information the next Claude would spend multiple tool calls trying to understand?" If the answer isn't clearly yes, the comment is noise. Delete it.

## Git

Never open a pull request unless the developer explicitly asks you to.

Conventional commit titles, plain language, scoped to the workspace (`web`, `server`, `api`, `auth`, `db`, `env`, `ui`; no scope for repo-wide changes): `fix(web): joining a second voice channel no longer leaves the first seat occupied`.

Body: the problem in a sentence or two, then how you fixed it.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `zeNn-G/konus-la`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: root `GLOSSARY-MAP.md` points at one `GLOSSARY.md` per workspace; ADRs in `docs/adr/`. See `docs/agents/domain.md`.
