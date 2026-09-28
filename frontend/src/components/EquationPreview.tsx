import type { EquationSummary, FitResult, ModelSpec } from "../model/types";
import type { Language } from "../model/i18n";
import { t } from "../model/i18n";
import { fmtEng } from "../model/format";
import { parameterValueRows } from "../model/diagnostics";
import { MathFormula } from "./MathFormula";
import { componentPhysicalRole, beginnerBranchMeaning, termToComponentSpec } from "../model/modelDisplaySemantics";

interface Props { equations?: EquationSummary | null; model: ModelSpec; result?: FitResult | null; language: Language; }

type Term = { id: string; nick: string; row: string; law: string; form: string; placement: string; polarity?: string };

function idFromRow(row: string) {
  const beforeColon = row.split(":")[0]?.trim();
  return beforeColon || row.slice(0, 24);
}
function humanId(id: string, law?: string) {
  const source = `${id} ${law ?? ""}`;
  if (/shunt|rsh/i.test(source)) return "Rsh";
  if (/rs|ohmic|series/i.test(source)) return "Rs";
  if (/barrier/i.test(source)) return "Barrier";
  if (/shockley|diode/i.test(source)) return "D1";
  if (/break|leak/i.test(source)) return "Leakage";
  if (/bias|photo/i.test(source)) return "Iaux";
  return id.replace(/[_-]+/g, " ").replace(/\d{3,}$/g, "").trim() || "term";
}
function parseLaw(row: string) {
  const law = row.match(/law=([^;·,\s]+)/)?.[1] ?? row.match(/law_id[:=]\s*([^;·,\s]+)/)?.[1] ?? "unknown";
  const form = row.match(/form=([^;·,\s]+)/)?.[1] ?? "unknown";
  const placement = row.match(/placement=([^;·,\s]+)/)?.[1] ?? "unknown";
  const polarity = row.match(/polarity=([^;·,\s]+)/)?.[1];
  const nick = row.match(/nick=([^;·,]+)/)?.[1]?.trim() || row.match(/nickname=([^;·,]+)/)?.[1]?.trim() || humanId(idFromRow(row), law);
  return { law, form, placement, nick, polarity };
}
function rowsToTerms(rows: string[]): Term[] {
  return rows.map((row) => ({ id: idFromRow(row), row, ...parseLaw(row) }));
}
function isOhmic(term: Term) { return /ohmic|shunt|constant_rs|resistance/i.test(`${term.row} ${term.law}`); }
function isDiode(term: Term) { return /diode|shockley|D\d/i.test(`${term.row} ${term.law} ${term.id}`); }
function isForwardPower(term: Term) { return /forward|power/i.test(`${term.row} ${term.id}`) && !isDiode(term); }
function isBreakdown(term: Term) { return /break|reverse/i.test(`${term.row} ${term.id}`); }
function isPhotocurrentConstant(term: Term) { return /photocurrent_constant/i.test(`${term.row} ${term.law} ${term.id}`); }
function isBiasDependentCurrent(term: Term) { return /bias_dependent_current|photocurrent_voltage_dependent|voltage_dependent_photocurrent/i.test(`${term.row} ${term.law} ${term.id}`); }
function isConductanceModifier(term: Term) { return term.form === "conductance_modifier" || /conductance_modifier|softplus_rs_modifier|series-path modifier/i.test(`${term.row} ${term.law} ${term.id}`); }
function isSeriesPowerDrop(term: Term) { return /softplus_power_law_voltage_drop|series_power_law_drop/i.test(`${term.row} ${term.law} ${term.id}`); }
function isSeriesDiodeBarrier(term: Term) { return /series_diode_barrier|series barrier|barrier/i.test(`${term.row} ${term.law} ${term.id} ${term.nick}`); }
function symbolName(term: Term) {
  const raw = humanId(term.nick || term.id, term.law);
  return raw.replace(/[^A-Za-z0-9]+/g, "") || "term";
}
function symbolFor(term: Term) {
  const safe = symbolName(term);
  if (/^rs$/i.test(term.nick) || /^rs$/i.test(term.id)) return { r: "R_s", i: "I", v: "V_{Rs}" };
  if (/rsh|shunt/i.test(term.nick) || /rsh|shunt/i.test(term.id)) return { r: "R_{sh}", i: "I_{Rsh}", v: "V_j" };
  if (isDiode(term)) return { i: `I_{${safe || "D"}}`, r: "", v: "V_j" };
  if (isPhotocurrentConstant(term)) return { i: `I_{${safe || "ph"}}`, r: "", v: "V_j" };
  if (isBiasDependentCurrent(term)) return { i: `I_{${safe || "bias"}}`, r: "", v: "V_j" };
  if (isForwardPower(term)) return { i: `I_{${safe || "fwd"}}`, r: "", v: "V_j" };
  if (isBreakdown(term)) return { i: `I_{${safe || "br"}}`, r: "", v: "V_j" };
  return { i: `I_{${safe || "branch"}}`, r: `R_{${safe || "x"}}`, v: "V_j" };
}
function seriesDropLatex(series: Term[]) {
  if (!series.length) return "V_j = V_{ext}";
  const drops = series.map((term) => {
    const s = symbolFor(term);
    if (isOhmic(term)) return `I${s.r}`;
    if (isSeriesPowerDrop(term)) return `sA_V\\,\\operatorname{softplus}\\!\\left(\\frac{sI-I_t}{I_s}\\right)^m`;
    if (isConductanceModifier(term)) return `I R_{base}/[1 + A\\,\\operatorname{softplus}(u)]`;
    return `V_{${symbolName(term)}}(I)`;
  });
  return `V_j = V_{ext} - ${drops.join(" - ")}`;
}
function branchCurrentLatex(branch: Term) {
  const s = symbolFor(branch);
  if (isDiode(branch)) return `${s.i} = I_0\\left[\\exp\\!\\left(\\frac{V_j}{nV_T}\\right)-1\\right]`;
  if (isOhmic(branch)) return `${s.i} = \\frac{V_j}{${s.r}}`;
  if (isForwardPower(branch)) return `${s.i} = A_{fwd}\\,\\operatorname{softplus}\\!\\left(\\frac{V_j - V_t}{V_s}\\right)^{m}`;
  if (isBreakdown(branch)) return `${s.i} = I_{br0}\\,\\operatorname{softplus}\\!\\left(\\frac{-V_j - V_{br}}{V_s}\\right)^{m}`;
  if (isBiasDependentCurrent(branch)) return `${s.i} = I_0(1+a|V_j|)+A\\,\\operatorname{softplus}\\!\\left(\\frac{|V_j|-V_t}{V_s}\\right)^m`;
  return `${s.i} = f_{${symbolName(branch)}}(V_j)`;
}
function totalCurrentLatex(branches: Term[]) {
  if (!branches.length) return "I = 0";
  return `I = ${branches.map((b) => symbolFor(b).i).join(" + ")}`;
}
function concreteLatex(series: Term[], branches: Term[]) {
  const rs = series.find((t) => /rs/i.test(t.nick) && isOhmic(t));
  const diode = branches.find(isDiode);
  const rsh = branches.find((t) => /rsh|shunt/i.test(t.nick) && isOhmic(t));
  if (rs && diode && rsh && branches.length === 2 && series.length === 1) {
    return "I = I_0\\left[\\exp\\!\\left(\\frac{V_{ext}-IR_s}{nV_T}\\right)-1\\right] + \\frac{V_{ext}-IR_s}{R_{sh}}";
  }
  const vj = series.length ? "V_j" : "V_{ext}";
  const pieces = branches.map((b) => {
    const s = symbolFor(b);
    if (isDiode(b)) return `I_0\\left[\\exp\\!\\left(\\frac{${vj}}{nV_T}\\right)-1\\right]`;
    if (isOhmic(b)) return `\\frac{${vj}}{${s.r}}`;
    if (isForwardPower(b)) return `A_{fwd}\\,\\operatorname{softplus}\\!\\left(\\frac{${vj}-V_t}{V_s}\\right)^m`;
    if (isBreakdown(b)) return `I_{br0}\\,\\operatorname{softplus}\\!\\left(\\frac{-${vj}-V_{br}}{V_s}\\right)^m`;
    if (isBiasDependentCurrent(b)) return `I_0(1+a|${vj}|)+A\\,\\operatorname{softplus}\\!\\left(\\frac{|${vj}|-V_t}{V_s}\\right)^m`;
    return `f_{${symbolName(b)}}(${vj})`;
  });
  return `I = ${pieces.length ? pieces.join(" + ") : "0"}`;
}
function residualLatex(branches: Term[]) {
  return `F(I;V_{ext}) = I - \\left(${branches.map((b) => symbolFor(b).i).join(" + ") || "0"}\\right) = 0`;
}
function termMeaning(term: Term, language: Language) {
  const compSpec = termToComponentSpec(term);
  return componentPhysicalRole(compSpec, language)["en"];
}
function beginnerBranchMeaningLocal(term: Term, language: Language) {
  const compSpec = termToComponentSpec(term);
  return beginnerBranchMeaning(compSpec, language);
}


function FormulaCards({ series, branches, language }: { series: Term[]; branches: Term[]; language: Language }) {
  const usesSoftplus = [...series, ...branches].some((term) => isSeriesPowerDrop(term) || isConductanceModifier(term) || isForwardPower(term) || isBreakdown(term) || isBiasDependentCurrent(term));
  const zh = language === "zh";
  return <>
    <div className="equation-card formula-card user-facing-global-formula">
      <h3>{zh ? "0. 等效 I–V 模型" : "0. Equivalent I–V model"}</h3>
      <p className="equation-explain">{zh
        ? "外加电压先经过主路压降变成结点电压；各支路在该结点电压下计算电流并求和。"
        : "Applied voltage is converted to junction voltage after main-path drops. Branch currents are evaluated at that junction voltage and summed."}</p>
      <div className="preview-formula-block global-formula-stack">
        <div className="preview-formula-head"><strong>{zh ? "全局结构" : "Global structure"}</strong><span>{zh ? "主路 + 并联支路" : "main path + parallel branches"}</span></div>
        <MathFormula latex={"V_j=V_{ext}-\\sum_k \\Delta V_k(I)"} />
        <MathFormula latex={"I=\\sum_m I_m(V_j;\\theta_m)"} />
        <MathFormula latex={"F(I;V_{ext})=I-\\sum_m I_m(V_j;\\theta_m)=0"} />
      </div>
    </div>
    {usesSoftplus ? <div className="equation-card formula-card softplus-definition-card">
      <h3>{zh ? "Softplus 定义" : "Softplus definition"}</h3>
      <p className="equation-explain">{zh ? "Softplus 是平滑阈值函数。低于阈值时接近零，高于阈值后近似线性增长，因此模型不会出现尖锐折角。" : "Softplus is a smooth threshold function. It stays near zero below the threshold and grows almost linearly above it, so the model avoids a sharp corner."}</p>
      <div className="preview-formula-block">
        <div className="preview-formula-head"><strong>{zh ? "数学定义" : "Mathematical definition"}</strong></div>
        <MathFormula latex={"\\operatorname{softplus}(x)=\\ln(1+\\exp(x))"} />
      </div>
    </div> : null}
    <div className="equation-card formula-card">
      <h3>{zh ? "1. 结点电压" : "1. Junction voltage"}</h3>
      <p className="equation-explain">{zh
        ? "从用户施加的外部电压开始，扣除主路中的串联压降。剩余的结点电压 Vj 是下面所有支路共同看到的电压。"
        : "Start with the externally applied voltage, then subtract main-path voltage losses. The branches below see the remaining junction voltage Vj."}</p>
      <div className="preview-formula-block">
        <div className="preview-formula-head"><strong>{zh ? "支路看到的电压" : "Voltage seen by junction branches"}</strong></div>
        <MathFormula latex={seriesDropLatex(series)} />
      </div>
    </div>
    <div className="equation-card formula-card">
      <h3>{zh ? "2. 支路电流" : "2. Branch currents"}</h3>
      <p className="equation-explain">{zh
        ? "每条支路根据同一个 Vj 计算自己的电流。端口电流是所有有效支路电流的和。"
        : "Each branch calculates a current from Vj. The terminal current is the sum of all active branch currents."}</p>
      <div className="preview-formula-block">
        <div className="preview-formula-head"><strong>{zh ? "总电流" : "Total current"}</strong></div>
        <MathFormula latex={totalCurrentLatex(branches)} />
      </div>
      <div className="branch-formula-list">{branches.map((b) => <div className="preview-formula-block" key={b.id}>
        <div className="preview-formula-head"><strong>{b.nick}</strong><span>{beginnerBranchMeaningLocal(b, language)}</span></div>
        <MathFormula latex={branchCurrentLatex(b)} />
      </div>)}</div>
    </div>
    <div className="equation-card formula-card wide-equation">
      <h3>{zh ? "3. 当前模型的合并方程" : "3. Combined equation for this model"}</h3>
      <p className="equation-explain">{zh
        ? "将支路公式代入总电流关系，得到单方程视图。"
        : "Branch formulas substituted into a single model equation."}</p>
      <div className="preview-formula-block">
        <div className="preview-formula-head"><strong>{zh ? "单方程视图" : "Single-equation view"}</strong></div>
        <MathFormula latex={concreteLatex(series, branches)} />
      </div>
    </div>
  </>;
}
function SolverCard({ series, branches, language }: { series: Term[]; branches: Term[]; language: Language }) {
  return <div className="equation-card solver-card">
    <h3>{"4. Fit residual"}</h3>
    <p className="equation-explain">{"For each applied voltage, the solver finds the current that makes this residual zero."}</p>
    <MathFormula latex={residualLatex(branches)} />
    <div className="chip-row"><strong>{t(language, "mainPath")}</strong>{series.map((s) => <span className="mini-chip" key={s.id}>{s.nick}</span>)}</div>
    <div className="chip-row"><strong>{t(language, "branches")}</strong>{branches.map((b) => <span className="mini-chip" key={b.id}>{b.nick}</span>)}</div>
  </div>;
}
function CurrentValuesCard({ model, result, language }: { model: ModelSpec; result?: FitResult | null; language: Language }) {
  const rows = parameterValueRows(model, result ?? null);
  return <div className="equation-card current-values-card">
    <h3>{"Current parameter values"}</h3>
    <p className="equation-explain">{"These values plug into the formulas above. Before fitting they are initial values; after fitting they are fitted values."}</p>
    <div className="parameter-chip-grid">
      {rows.map((row) => <span className="parameter-chip" key={row.key}>
        <strong>{row.label}</strong>
        <span>{fmtEng(row.value.value, 4)} {"unit" in row.value && row.value.unit ? row.value.unit : ""}</span>
      </span>)}
    </div>
  </div>;
}
function ComponentRows({ terms, language }: { terms: Term[]; language: Language }) {
  return <div className="equation-card component-card">
    <h3>{"Component meaning"}</h3>
    <div className="component-table readable-component-table">
      {terms.map((term) => <div className="component-row readable-component-row" key={`${term.id}-${term.row}`}>
        <span className="component-group"><strong>{term.nick}</strong></span>
        <span className="component-readable"><em>{termMeaning(term, language)}</em><small>{term.polarity ? (`Polarity: ${term.polarity}`) : ("Technical law/form/placement details are available in Help.")}</small></span>
      </div>)}
    </div>
  </div>;
}

export function EquationPreview({ equations, model, result, language }: Props) {
  if (!equations) return <section className="card equation-preview"><h2>{t(language, "equationPreview")}</h2><p className="muted">{t(language, "formulaPreviewEmpty")}</p></section>;
  const series = rowsToTerms(equations.series);
  const branches = rowsToTerms([...equations.core, ...equations.parallel]);
  const terms = [...branches, ...series];
  return <section className="card equation-preview structured-preview"><h2>{t(language, "equationPreview")}</h2>
    <div className="equation-layout">
      <FormulaCards series={series} branches={branches} language={language} />
      <CurrentValuesCard model={model} result={result} language={language} />
      <SolverCard series={series} branches={branches} language={language} />
      <ComponentRows terms={terms} language={language} />
    </div>
  </section>;
}
