# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY-MAP.md`** at the repo root: it points at one `GLOSSARY.md` per workspace. Read each one relevant to the topic.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. All ADRs currently live here; if a workspace grows its own `docs/adr/`, check that too.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context repo: each workspace is a context.

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← system-wide decisions
├── apps/
│   ├── server/GLOSSARY.md
│   └── web/GLOSSARY.md
└── packages/
    ├── api/GLOSSARY.md
    ├── auth/GLOSSARY.md
    ├── db/GLOSSARY.md
    ├── env/GLOSSARY.md
    └── ui/GLOSSARY.md
```

A new workspace gets its own `GLOSSARY.md` and a line in `GLOSSARY-MAP.md` once it has vocabulary worth recording.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (voice in-memory rooms), but worth reopening because…_
