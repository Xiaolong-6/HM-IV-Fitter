# Release privacy checklist

Before publishing a release, verify that notes, manifests, logs, screenshots, artifacts, and commit messages do not expose private/local context.

## Block before release

- local home paths such as `C:\Users\...` or `/home/...`;
- personal email addresses that are not intentional public project contacts;
- workstation/lab account names;
- temporary local folders;
- private network addresses;
- secrets, tokens, API keys, or passwords.

## Wording discipline

- State exactly which tests ran.
- State exactly which tests did not run.
- Do not claim browser, build, numerical-parity, or deployment validation unless the corresponding check passed.
- Redact raw local error logs before putting them in public release notes.
