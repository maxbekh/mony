# AI Agent Instructions

This file is the repository-wide instruction entrypoint for any AI coding assistant working on **mony**.

The canonical policy lives in [GEMINI.md](./GEMINI.md). Its rules apply unchanged to all assistants, regardless of vendor or model.

Minimum required workflow:

1. Run `git status`, `git branch`, and `git log -n 5` before starting.
2. Work on a descriptive branch, never directly on `main`.
3. Keep changes small and logically scoped.
4. Use Conventional Commits.
5. Commit completed logical changes before handover.

If this file and `GEMINI.md` ever diverge, `GEMINI.md` must be updated and this file brought back in sync immediately.
