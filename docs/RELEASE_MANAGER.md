# Release maintenance

The normal product deployment is GitHub Pages from tested `main`.

The application no longer exposes an in-app release/update panel. Release-page operations are maintainer-only.

## Audit a GitHub release

```bash
python tools/audit_release_page.py \
  --repo Xiaolong-6/HM-IV-Fitter \
  --tag v<version>
```

The audit checks release metadata and common privacy/packaging mistakes.

## Update a release

Use `tools/update_github_release.py` only in a maintainer environment with an explicit GitHub token.

Always use dry-run first:

```bash
python tools/update_github_release.py \
  --repo Xiaolong-6/HM-IV-Fitter \
  --tag v<version> \
  --artifact release/hm-iv-fitter-static-v<version>.zip \
  --notes CHANGELOG.md \
  --dry-run
```

Do not place GitHub write credentials in frontend/runtime code.

## Product deployment

GitHub Pages is deployed only after **Static browser CI** succeeds on `main`. The Pages workflow checks out `main`, rebuilds the static site, audits the expected payload files, and deploys `frontend/dist`.

There is no supported desktop/PyInstaller release artifact.
