# Human developer setup

The end-user product is the static browser application. FastAPI/Vite local servers are retained for development and numerical-oracle work.

## Requirements

- Python 3.12.x
- Node.js LTS
- Git

## First-time setup on Windows

```powershell
.\scripts\setup_dev.ps1
```

This creates/reuses the root `.venv`, installs Python dependencies, and installs frontend dependencies.

## Static browser development

Build the same architecture used for Pages:

```powershell
npm run build:static
```

Serve `frontend/dist` over HTTP. Direct `file://` execution is not supported because Web Worker/WASM/module loading depends on normal browser HTTP(S) rules.

## Development server mode

FastAPI remains useful for API inspection and CPython-oracle comparisons:

```powershell
.\scripts\run_backend.ps1
```

Vite development server:

```powershell
.\scripts\run_frontend.ps1
```

Run both:

```powershell
.\scripts\run_dev.ps1
```

## Tests

Backend:

```powershell
.\scripts\test_backend.ps1
```

Frontend:

```powershell
npm --prefix frontend run test -- --reporter=dot
```

Static production build:

```powershell
npm run build:static
```

## Windows helper sequence

The root numbered scripts are developer helpers:

```text
00_validate_scripts.bat
01_check_environment.bat
02_setup_dev.bat
03_test_backend.bat
04_run_dev.bat
05_release_build.bat
```
