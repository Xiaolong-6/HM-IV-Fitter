import { describe, expect, it } from "vitest";
import {
  componentEquation,
  componentPhysicalRole,
  componentZoneLabel,
  componentRoleBadge,
  parameterMeaning,
  aggregateVoltageEquation,
  aggregateCurrentEquation,
  seriesDropLatex,
  branchCurrentLatex,
  totalCurrentLatex,
  concreteLatex,
  residualLatex,
  componentPlainRoleText,
  beginnerBranchMeaning,
  termToComponentSpec,
} from "../modelDisplaySemantics";
import type { ComponentSpec } from "../types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeComp(overrides: Partial<ComponentSpec> & { function_type: string; location: "series" | "parallel" | "core" }): ComponentSpec {
  return {
    id: overrides.id ?? overrides.function_type,
    location: overrides.location,
    function_type: overrides.function_type,
    law_id: overrides.law_id ?? overrides.function_type,
    evaluation_form: overrides.evaluation_form ?? (overrides.location === "series" ? "voltage_drop" : "current_branch"),
    placement: overrides.placement ?? (overrides.location === "series" ? "series_voltage_drop" : "junction_current_branch"),
    polarity: overrides.polarity ?? null,
    params: overrides.params ?? {},
    metadata: overrides.metadata ?? { nickname: overrides.id ?? overrides.function_type },
  };
}

// ---------------------------------------------------------------------------
// Rs (Ohmic series resistance, main path)
// ---------------------------------------------------------------------------

describe("Rs (Ohmic series, main path)", () => {
  const rs = makeComp({
    id: "ohmic_1",
    function_type: "constant_rs",
    law_id: "ohmic",
    location: "series",
    evaluation_form: "voltage_drop",
    placement: "series_voltage_drop",
    metadata: { nickname: "Rs" },
  });

  it("equation uses ΔV and I notation (voltage drop)", () => {
    const eq = componentEquation(rs);
    expect(eq).toContain("\\Delta V");
    expect(eq).toContain("R_s");
    expect(eq).toContain("I\\,R_s");
  });

  it("equation uses V_j (not V_i)", () => {
    const eq = componentEquation(rs);
    expect(eq).not.toContain("V_i");
  });

  it("role label describes main-path voltage drop", () => {
    const role = componentPhysicalRole(rs, "en");
    expect(role.en).toContain("main-path");
    expect(role.en).toContain("series resistance");
  });

  it("zone label is Main path", () => {
    expect(componentZoneLabel(rs, "en")).toBe("Main path");
  });

  it("role badge is ΔV", () => {
    expect(componentRoleBadge(rs)).toBe("ΔV");
  });

  it("is NOT rendered as a current branch", () => {
    const eq = componentEquation(rs);
    expect(eq).not.toMatch(/^I_{/);
    expect(eq).not.toContain("= \\frac{V_j}");
  });
});

// ---------------------------------------------------------------------------
// Rsh (Ohmic branch, parallel)
// ---------------------------------------------------------------------------

describe("Rsh (Ohmic branch, parallel)", () => {
  const rsh = makeComp({
    id: "ohmic_2",
    function_type: "constant_rs",
    law_id: "ohmic",
    location: "parallel",
    evaluation_form: "current_branch",
    placement: "parallel_current_branch",
    metadata: { nickname: "Rsh" },
  });

  it("equation uses I = Vj/R notation (current branch)", () => {
    const eq = componentEquation(rsh);
    expect(eq).toContain("I_{R_{sh}}");
    expect(eq).toContain("\\frac{V_j}{R_{sh}}");
  });

  it("equation uses V_j (not V_i)", () => {
    const eq = componentEquation(rsh);
    expect(eq).not.toContain("V_i");
  });

  it("role label describes branch current", () => {
    const role = componentPhysicalRole(rsh, "en");
    expect(role.en).toContain("leakage");
    expect(role.en).toContain("shunt");
  });

  it("zone label is Branch", () => {
    expect(componentZoneLabel(rsh, "en")).toBe("Branch");
  });

  it("role badge is I(Vj)", () => {
    expect(componentRoleBadge(rsh)).toBe("I(Vj)");
  });

  it("is NOT rendered as a voltage drop", () => {
    const eq = componentEquation(rsh);
    expect(eq).not.toContain("\\Delta V");
  });
});

// ---------------------------------------------------------------------------
// D1 (Shockley diode, branch)
// ---------------------------------------------------------------------------

describe("D1 (Shockley diode, branch)", () => {
  const d1 = makeComp({
    id: "D1",
    function_type: "diode",
    law_id: "shockley_diode",
    location: "core",
    evaluation_form: "current_branch",
    placement: "junction_current_branch",
    polarity: "forward",
    metadata: { nickname: "D1" },
  });

  it("equation uses diode current formula", () => {
    const eq = componentEquation(d1);
    expect(eq).toContain("I_0");
    expect(eq).toContain("\\exp");
    expect(eq).toContain("nV_T");
  });

  it("equation uses V_j (not V_i)", () => {
    const eq = componentEquation(d1);
    expect(eq).not.toContain("V_i");
  });

  it("role label describes Shockley diode", () => {
    const role = componentPhysicalRole(d1, "en");
    expect(role.en).toContain("Shockley diode");
    expect(role.en).toContain("exponential");
  });

  it("is NOT rendered as a voltage drop", () => {
    const eq = componentEquation(d1);
    expect(eq).not.toContain("\\Delta V");
    expect(eq).not.toContain("I\\,R");
  });
});

// ---------------------------------------------------------------------------
// D2 (second diode)
// ---------------------------------------------------------------------------

describe("D2 (second diode, branch)", () => {
  const d2 = makeComp({
    id: "D2",
    function_type: "diode",
    law_id: "shockley_diode",
    location: "core",
    evaluation_form: "current_branch",
    placement: "junction_current_branch",
    polarity: "reverse",
    metadata: { nickname: "D2" },
  });

  it("equation uses diode current formula with D2 token", () => {
    const eq = componentEquation(d2);
    expect(eq).toContain("D_{2}");
    expect(eq).toContain("I_0");
  });

  it("role label describes Shockley diode", () => {
    const role = componentPhysicalRole(d2, "en");
    expect(role.en).toContain("Shockley diode");
  });
});

// ---------------------------------------------------------------------------
// Photocurrent
// ---------------------------------------------------------------------------

describe("Photocurrent (branch)", () => {
  const photo = makeComp({
    id: "ph1",
    function_type: "photocurrent_constant",
    law_id: "photocurrent_constant",
    location: "parallel",
    evaluation_form: "current_branch",
    placement: "parallel_current_branch",
    metadata: { nickname: "Iph" },
  });

  it("equation uses photocurrent notation", () => {
    const eq = componentEquation(photo);
    expect(eq).toContain("I_{Iph}");
    expect(eq).toContain("I_{ph}");
  });

  it("role label describes photocurrent", () => {
    const role = componentPhysicalRole(photo, "en");
    expect(role.en).toContain("photocurrent");
  });

  it("is NOT rendered as a voltage drop", () => {
    const eq = componentEquation(photo);
    expect(eq).not.toContain("\\Delta V");
  });
});

// ---------------------------------------------------------------------------
// Bias-dependent photocurrent
// ---------------------------------------------------------------------------

describe("Bias-dependent photocurrent (branch)", () => {
  const biasPhoto = makeComp({
    id: "bias_ph1",
    function_type: "bias_dependent_current",
    law_id: "bias_dependent_current",
    location: "parallel",
    evaluation_form: "current_branch",
    placement: "parallel_current_branch",
    metadata: { nickname: "Iaux" },
  });

  it("equation includes bias-dependent terms", () => {
    const eq = componentEquation(biasPhoto);
    expect(eq).toContain("I_{Iaux}");
    expect(eq).toContain("softplus");
  });

  it("role label describes bias-dependent current", () => {
    const role = componentPhysicalRole(biasPhoto, "en");
    expect(role.en).toContain("bias-dependent");
  });
});

// ---------------------------------------------------------------------------
// Custom branch
// ---------------------------------------------------------------------------

describe("Custom branch", () => {
  const custom = makeComp({
    id: "custom1",
    function_type: "custom",
    law_id: "custom_expression",
    location: "parallel",
    evaluation_form: "current_branch",
    placement: "parallel_current_branch",
    metadata: { nickname: "Custom", expression: "s*A*softplus(u)**m" },
  });

  it("equation uses custom expression", () => {
    const eq = componentEquation(custom);
    expect(eq).toContain("I_{Custom}");
    expect(eq).toContain("softplus");
  });

  it("role label describes custom branch term", () => {
    const role = componentPhysicalRole(custom, "en");
    expect(role.en).toContain("custom");
    expect(role.en).toContain("branch");
  });
});

// ---------------------------------------------------------------------------
// Custom main-path
// ---------------------------------------------------------------------------

describe("Custom main-path", () => {
  const customMain = makeComp({
    id: "custom_main",
    function_type: "custom",
    law_id: "custom_expression",
    location: "series",
    evaluation_form: "voltage_drop",
    placement: "series_voltage_drop",
    metadata: { nickname: "Xm", expression: "A*softplus(u)" },
  });

  it("equation uses custom expression with ΔV", () => {
    const eq = componentEquation(customMain);
    expect(eq).toContain("\\Delta V_{Xm}");
    expect(eq).toContain("softplus");
  });

  it("role label describes custom main-path term", () => {
    const role = componentPhysicalRole(customMain, "en");
    expect(role.en).toContain("custom");
    expect(role.en).toContain("main-path");
  });
});

// ---------------------------------------------------------------------------
// Negative tests: branch components must NOT be rendered as voltage-drop
// ---------------------------------------------------------------------------

describe("Negative: branch components are NOT voltage-drop", () => {
  const branchCases: Array<{ name: string; comp: ComponentSpec }> = [
    { name: "Rsh (ohmic branch)", comp: makeComp({ id: "Rsh", function_type: "constant_rs", law_id: "ohmic", location: "parallel", metadata: { nickname: "Rsh" } }) },
    { name: "D1 (diode branch)", comp: makeComp({ id: "D1", function_type: "diode", law_id: "shockley_diode", location: "core", metadata: { nickname: "D1" } }) },
    { name: "Iph (photocurrent)", comp: makeComp({ id: "Iph", function_type: "photocurrent_constant", law_id: "photocurrent_constant", location: "parallel", metadata: { nickname: "Iph" } }) },
    { name: "Custom branch", comp: makeComp({ id: "X1", function_type: "custom", law_id: "custom", location: "parallel", metadata: { nickname: "X1" } }) },
  ];

  branchCases.forEach(({ name, comp }) => {
    it(`${name}: equation does NOT contain ΔV`, () => {
      const eq = componentEquation(comp);
      expect(eq).not.toContain("\\Delta V");
    });

    it(`${name}: zone badge is I(Vj)`, () => {
      expect(componentRoleBadge(comp)).toBe("I(Vj)");
    });
  });
});

// ---------------------------------------------------------------------------
// Aggregate equations
// ---------------------------------------------------------------------------

describe("Aggregate equations", () => {
  it("voltage equation uses V_i = V_ext - Σ ΔV", () => {
    const eq = aggregateVoltageEquation();
    expect(eq).toContain("V_i = V_{ext}");
    expect(eq).toContain("\\sum_k");
    expect(eq).toContain("\\Delta V_k");
  });

  it("current equation uses I = Σ I_m", () => {
    const eq = aggregateCurrentEquation();
    expect(eq).toContain("I = ");
    expect(eq).toContain("\\sum_m");
  });
});

// ---------------------------------------------------------------------------
// Parameter meanings
// ---------------------------------------------------------------------------

describe("Parameter meanings", () => {
  const rs = makeComp({ id: "Rs", function_type: "constant_rs", law_id: "ohmic", location: "series", params: { Rs_ohm: { value: 10, label: "Rs" } }, metadata: { nickname: "Rs" } });

  it("n parameter has ideality factor description", () => {
    const meaning = parameterMeaning(rs, "n", "en");
    expect(meaning.en).toContain("Ideality factor");
  });

  it("I0 parameter has saturation current description", () => {
    const meaning = parameterMeaning(rs, "I0_A", "en");
    expect(meaning.en).toContain("Saturation current");
  });

  it("Rs_ohm parameter has series resistance description", () => {
    const meaning = parameterMeaning(rs, "Rs_ohm", "en");
    expect(meaning.en).toContain("Series resistance");
  });

  it("series resistance meaning is available in English", () => {
    const meaning = parameterMeaning(rs, "Rs_ohm", "en");
    expect(meaning.en).toContain("Series resistance");
  });
});

// ---------------------------------------------------------------------------
// Bilingual consistency
// ---------------------------------------------------------------------------

describe("English display consistency", () => {
  const d1 = makeComp({ id: "D1", function_type: "diode", law_id: "shockley_diode", location: "core", metadata: { nickname: "D1" } });

  it("role text mentions the component name", () => {
    const role = componentPhysicalRole(d1, "en");
    expect(role.en).toContain("D1");
  });

  it("zone label is available", () => {
    expect(componentZoneLabel(d1, "en")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// termToComponentSpec adapter
// ---------------------------------------------------------------------------

describe("termToComponentSpec", () => {
  it("converts ohmic series term", () => {
    const comp = termToComponentSpec({ nick: "Rs", law: "ohmic", form: "voltage_drop", placement: "series_voltage_drop" });
    expect(comp.function_type).toBe("constant_rs");
    expect(comp.location).toBe("series");
  });

  it("converts diode branch term", () => {
    const comp = termToComponentSpec({ nick: "D1", law: "shockley_diode", form: "current_branch", placement: "junction_current_branch" });
    expect(comp.function_type).toBe("diode");
    expect(comp.location).toBe("parallel");
  });

  it("converted term can be used with componentEquation", () => {
    const comp = termToComponentSpec({ nick: "Rs", law: "ohmic", form: "voltage_drop", placement: "series_voltage_drop" });
    const eq = componentEquation(comp);
    expect(eq).toContain("\\Delta V");
  });
});

// ---------------------------------------------------------------------------
// Custom law builder tests
// ---------------------------------------------------------------------------

describe("Custom law builder", () => {
  describe("custom main-path law", () => {
    const customMain = makeComp({
      id: "custom_main",
      function_type: "custom",
      law_id: "custom_expression",
      location: "series",
      evaluation_form: "voltage_drop",
      placement: "series_voltage_drop",
      metadata: { nickname: "Xm", expression: "A * I" },
    });

    it("equation shows custom expression, not generic fallback", () => {
      const eq = componentEquation(customMain);
      expect(eq).toContain("\\Delta V_{Xm}");
      expect(eq).toContain("A\\,I");
      expect(eq).not.toContain("f_{");
    });

    it("role label describes custom main-path term", () => {
      const role = componentPhysicalRole(customMain, "en");
      expect(role.en).toContain("custom");
      expect(role.en).toContain("main-path");
    });

    it("is NOT rendered as a current branch", () => {
      const eq = componentEquation(customMain);
      expect(eq).not.toMatch(/^I_{/);
    });
  });

  describe("custom branch law", () => {
    const customBranch = makeComp({
      id: "custom_branch",
      function_type: "custom",
      law_id: "custom_expression",
      location: "parallel",
      evaluation_form: "current_branch",
      placement: "parallel_current_branch",
      metadata: { nickname: "Xb", expression: "A * Vi" },
    });

    it("equation shows custom expression, not generic fallback", () => {
      const eq = componentEquation(customBranch);
      expect(eq).toContain("I_{Xb}");
      expect(eq).toContain("A\\,V_i");
      expect(eq).not.toContain("f_{");
    });

    it("role label describes custom branch term", () => {
      const role = componentPhysicalRole(customBranch, "en");
      expect(role.en).toContain("custom");
      expect(role.en).toContain("branch");
    });

    it("is NOT rendered as a voltage drop", () => {
      const eq = componentEquation(customBranch);
      expect(eq).not.toContain("\\Delta V");
    });
  });

  describe("custom law with softplus expression", () => {
    const customSoftplus = makeComp({
      id: "custom_sp",
      function_type: "custom",
      law_id: "custom_expression",
      location: "parallel",
      evaluation_form: "current_branch",
      placement: "parallel_current_branch",
      metadata: { nickname: "Sp", expression: "A*softplus(u)**m" },
    });

    it("equation renders the actual softplus expression", () => {
      const eq = componentEquation(customSoftplus);
      expect(eq).toContain("I_{Sp}");
      expect(eq).toContain("softplus");
    });
  });

  describe("custom law nickname preservation", () => {
    it("preserves user-edited nickname", () => {
      const comp = makeComp({
        id: "custom1",
        function_type: "custom",
        law_id: "custom_expression",
        location: "series",
        metadata: { nickname: "MyCustomTerm" },
      });
      const eq = componentEquation(comp);
      expect(eq).toContain("MyCustomTerm");
    });
  });
});
