import { describe, expect, it } from "vitest";
import { t, type Language, type TranslationKey } from "../i18n";

describe("English-only UI text", () => {
  it("exposes English as the only supported language type at runtime", () => {
    const language: Language = "en";
    expect(language).toBe("en");
    expect(t(language, "runFit")).toBe("Run fit");
  });

  it("returns non-empty strings for representative UI keys", () => {
    const keys: TranslationKey[] = [
      "readyNoFit",
      "fitSetup",
      "voltageRange",
      "modelBuilder",
      "solverModeHelp",
    ];
    for (const key of keys) {
      expect(t("en", key)).toEqual(expect.any(String));
      expect(t("en", key).length).toBeGreaterThan(0);
    }
  });
});
