# Windows developer helper scripts

The numbered Windows scripts are developer conveniences. They are not the end-user product path.

The supported product is the static browser application deployed from tested `main`.

## Local development

Recommended order:

1. `00_validate_scripts.bat` — checks helper-script syntax.
2. `01_check_environment.bat` — checks Python/pip.
3. `01a_install_node_lts.bat` — optional Node.js installation helper.
4. `02_setup_dev.bat` — creates/reuses `.venv` and installs development dependencies.
5. `03_test_backend.bat` — runs backend tests.
6. `04_run_dev.bat` — starts FastAPI + Vite for development.

Optional split launchers:

- `04a_run_backend_only.bat`
- `04b_run_frontend_only.bat`
- `04c_run_lan_dev.bat` for LAN browser testing

## Static release build

`05_release_build.bat` validates and packages the static browser build.

It runs the frontend/static build, frontend regression tests, backend tests/compile checks, validates the Pyodide payload, and creates:

```text
release/hm-iv-fitter-static-v<version>.zip
```

The old Windows/PyInstaller portable executable path has been removed.
