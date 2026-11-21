# CI

`ci/github-actions-ci.yml` is the GitHub Actions workflow (install → reproducible contract compile → lint → typecheck →
vitest → hosted build → `next start` → Playwright desktop+mobile against the local server).

**Why it is not in `.github/workflows/` yet:** the box's GitHub token has scopes `repo, gist, read:org, delete_repo` but not
`workflow`, and GitHub rejects any push that creates a workflow file without it
(`refusing to allow an OAuth App to create or update workflow .github/workflows/ci.yml without workflow scope`).
To enable it (owner, one time):

```bash
gh auth refresh -h github.com -s workflow      # device-code login in the browser
git mv ci/github-actions-ci.yml .github/workflows/ci.yml && git commit -m "CI: enable workflow" && git push
gh run watch                                    # wait for green
```

Until then `scripts/ci/local-ci.sh` runs exactly the same steps on the box; its latest log is `evidence/ci/local-ci.log`.
