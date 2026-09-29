import warnings

import numpy as np
from fastapi.testclient import TestClient

from ivfitter.api import main
from ivfitter.api.main import app
from ivfitter.core.evaluation import softplus


def test_api_token_is_optional_by_default(monkeypatch):
    monkeypatch.delenv("IVFITTER_API_TOKEN", raising=False)
    client = TestClient(app)
    assert client.get("/api/component-registry").status_code == 200


def test_api_token_protects_api_when_configured(monkeypatch):
    monkeypatch.setenv("IVFITTER_API_TOKEN", "test-token")
    client = TestClient(app)

    assert client.get("/api/health").status_code == 200
    assert client.get("/api/component-registry").status_code == 401
    response = client.get("/api/component-registry", headers={"X-IVFITTER-API-Key": "test-token"})
    assert response.status_code == 200


def test_internal_errors_are_sanitized_by_default(monkeypatch):
    monkeypatch.delenv("IVFITTER_API_TOKEN", raising=False)
    monkeypatch.delenv("IVFITTER_DEBUG_ERRORS", raising=False)
    monkeypatch.setattr(main, "suggest_bounds", lambda request: (_ for _ in ()).throw(RuntimeError("sensitive internal detail")))
    client = TestClient(app)

    response = client.post("/api/suggest-bounds", json={"trace": {"voltage_V": [0, 1], "current_A": [0, 1e-9]}, "model": {}, "config": {}})

    assert response.status_code == 500
    assert response.json()["detail"] == "Internal server error. See backend log for details."
    assert "sensitive internal detail" not in response.text


def test_internal_errors_can_be_verbose_in_debug_mode(monkeypatch):
    monkeypatch.delenv("IVFITTER_API_TOKEN", raising=False)
    monkeypatch.setenv("IVFITTER_DEBUG_ERRORS", "1")
    monkeypatch.setattr(main, "suggest_bounds", lambda request: (_ for _ in ()).throw(RuntimeError("debug detail")))
    client = TestClient(app)

    response = client.post("/api/suggest-bounds", json={"trace": {"voltage_V": [0, 1], "current_A": [0, 1e-9]}, "model": {}, "config": {}})

    assert response.status_code == 500
    assert "debug detail" in response.json()["detail"]


def test_softplus_extreme_negative_values_do_not_warn():
    values = np.array([-1000.0, -600.0, -500.0, -1.0, 0.0, 1.0])
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        out = softplus(values)
    assert not caught
    assert out[0] == 0.0
    assert 0.0 < out[1] < 1e-250
    assert np.all(np.isfinite(out))


def test_cors_methods_are_explicit_not_wildcard(monkeypatch):
    monkeypatch.delenv("IVFITTER_API_TOKEN", raising=False)
    client = TestClient(app)
    response = client.options(
        "/api/component-registry",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-ivfitter-api-key",
        },
    )
    assert response.status_code == 200
    allow_methods = response.headers.get("access-control-allow-methods", "")
    assert "POST" in allow_methods
    assert "GET" in allow_methods
    assert "DELETE" not in allow_methods


def test_api_token_uses_constant_time_compare():
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    text = (root / "backend" / "ivfitter" / "api" / "main.py").read_text(encoding="utf-8")
    assert "hmac.compare_digest" in text
    assert "supplied != token" not in text


def test_oversized_import_returns_413_not_sanitized_500(monkeypatch):
    monkeypatch.delenv("IVFITTER_API_TOKEN", raising=False)
    monkeypatch.setattr(main, "MAX_IMPORT_TEXT_CHARS", 4)
    client = TestClient(app)

    response = client.post("/api/import-csv-text", json={"text": "voltage,current\n0,0"})

    assert response.status_code == 413
    assert "too large" in response.json()["detail"]


def test_rate_limit_can_reject_runaway_requests(monkeypatch):
    monkeypatch.delenv("IVFITTER_API_TOKEN", raising=False)
    monkeypatch.setenv("IVFITTER_RATE_LIMIT_PER_MIN", "1")
    main._RATE_LIMIT_BUCKETS.clear()
    client = TestClient(app)

    first = client.get("/api/component-registry")
    second = client.get("/api/component-registry")

    assert first.status_code == 200
    assert second.status_code == 429
    main._RATE_LIMIT_BUCKETS.clear()
    monkeypatch.delenv("IVFITTER_RATE_LIMIT_PER_MIN", raising=False)


def test_cpu_endpoint_slot_returns_503_when_cap_exhausted():
    assert main._CPU_SEMAPHORE.acquire(blocking=False)
    assert main._CPU_SEMAPHORE.acquire(blocking=False)
    try:
        try:
            with main._cpu_endpoint_slot("Fit"):
                raise AssertionError("slot should not be available")
        except Exception as exc:
            assert getattr(exc, "status_code", None) == 503
            assert getattr(exc, "headers", {}).get("Retry-After") == "2"
    finally:
        main._CPU_SEMAPHORE.release()
        main._CPU_SEMAPHORE.release()


def test_v2_api_aliases_keep_legacy_routes_available(monkeypatch):
    monkeypatch.delenv("IVFITTER_API_TOKEN", raising=False)
    client = TestClient(app)
    legacy = client.get("/api/version")
    versioned = client.get("/api/v2/version")
    assert legacy.status_code == 200
    assert versioned.status_code == 200
    assert versioned.json() == legacy.json()

    registry = client.get("/api/v2/component-registry")
    assert registry.status_code == 200
    assert isinstance(registry.json(), list)
