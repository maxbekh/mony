# AI Assistance Instructions (GEMINI.md)

This file contains foundational mandates for any AI agent collaborating on the **mony** project.

## Development Workflow

- **Iterative Development**: Work on one feature or sub-feature at a time. Do not try to implement the entire application in one go.
- **Small Commits**: Each change should be minimal and focused. Avoid massive diffs.
- **Commit Conventions**: Use [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- **Proactive Testing**: Every feature must be accompanied by relevant tests. A feature is not complete until it's verified.
- **Clean Code**: Adhere to SOLID principles and keep the codebase easy to reason about.

## Security & Privacy Guidelines

- **Security by Design**: Always consider the security implications of any code change (e.g., input validation, authentication, data encryption).
- **No Secrets**: Never hardcode credentials, API keys, or any sensitive data. Use environment variables and `.env` files (ensuring they are ignored by Git).
- **Local First**: Prioritize local processing and storage. Avoid external dependencies unless strictly necessary and verified for security.

## Communication

- Be concise and direct.
- Explain the "why" behind significant architectural decisions.
- Stop and ask for clarification if a requirement is ambiguous.
