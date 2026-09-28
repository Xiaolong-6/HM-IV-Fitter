import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FRONTEND_SRC = ROOT / "frontend" / "src"
SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx"}


def frontend_source_files():
    return sorted(
        path
        for path in FRONTEND_SRC.rglob("*")
        if path.is_file() and path.suffix in SOURCE_SUFFIXES
    )


def test_frontend_source_is_english_only():
    failures = []
    cjk = re.compile(r"[\u3400-\u9fff]")
    for path in frontend_source_files():
        text = path.read_text(encoding="utf-8")
        if cjk.search(text):
            failures.append(str(path.relative_to(ROOT)))
    assert not failures, "CJK text remains in frontend source: " + ", ".join(failures)


def test_frontend_has_no_chinese_language_runtime_branch():
    failures = []
    for path in frontend_source_files():
        text = path.read_text(encoding="utf-8")
        if 'language === "zh"' in text or 'language === \'zh\'' in text:
            failures.append(str(path.relative_to(ROOT)))
    assert not failures, "Chinese language runtime branches remain: " + ", ".join(failures)
