import { expect, test } from "@playwright/test";

test.setTimeout(180_000);

test("static browser runtime imports, fits, and exports without FastAPI", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");
  await expect(page.locator("#root")).toBeVisible();

  const result = await page.evaluate(async () => {
    const worker = new Worker(
      new URL("browser-runtime.worker.js", window.location.href),
      { type: "module" },
    );
    let nextId = 1;

    const call = <T,>(method: string, payload: unknown): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const id = nextId++;

        const onMessage = (event: MessageEvent) => {
          const message = event.data;
          if (message?.id !== id) return;
          worker.removeEventListener("message", onMessage);

          if (message.ok) {
            resolve(message.result as T);
            return;
          }
          reject(new Error(message.error || "Static browser runtime failed."));
        };

        worker.addEventListener("message", onMessage);
        worker.postMessage({
          id,
          method,
          payload,
          baseUrl: new URL("./", window.location.href).toString(),
        });
      });

    const registry = await call<Array<{ function_type: string }>>(
      "component_registry",
      null,
    );

    const imported = await call<{
      traces: Array<{
        trace: {
          voltage_V: number[];
          current_A: number[];
          trace_id: string;
          metadata: Record<string, unknown>;
        };
      }>;
    }>("import_csv_text_multi", {
      text: "Voltage_V,Current_A\n-1,-0.001\n-0.5,-0.0005\n0,0\n0.5,0.0005\n1,0.001\n",
      trace_id: "static-smoke",
    });

    const model = {
      core: [],
      series: [],
      parallel: [
        {
          id: "Rsh",
          location: "parallel",
          function_type: "shunt",
          law_id: "ohmic",
          evaluation_form: "current_branch",
          placement: "parallel_current_branch",
          params: {
            Rsh_ohm: {
              value: 600,
              lower: 1,
              upper: 1e9,
              fit: true,
              unit: "ohm",
            },
          },
        },
      ],
      temperature_K: 300,
      version: "static-browser-smoke",
    };

    const validation = await call<
      Array<{ code: string; severity: string; message: string }>
    >("validate_model", {
      core: [],
      series: [],
      parallel: [],
      temperature_K: 0,
      version: "static-browser-invalid-model",
    });

    const fit = await call<{
      success: boolean;
      parameters: Record<string, { value: number }>;
      curves: { current_fit_A: number[] };
    }>("fit", {
      trace: imported.traces[0].trace,
      model,
      config: {
        weighting: "linear",
        loss: "linear",
        fit_speed: "standard",
        exclude_compliance: false,
        max_nfev: 200,
        multistart_enabled: false,
        run_timeout_s: 0,
        solver_mode: "legacy_composite",
      },
    });

    const failedModel = structuredClone(model);
    failedModel.parallel[0].params.Rsh_ohm.value = 0;
    failedModel.parallel[0].params.Rsh_ohm.lower = 1;
    const failedFit = await call<{
      success: boolean;
      warnings: Array<{ code: string; severity: string }>;
    }>("fit", {
      trace: imported.traces[0].trace,
      model: failedModel,
      config: {
        weighting: "linear",
        loss: "linear",
        fit_speed: "standard",
        exclude_compliance: false,
        max_nfev: 20,
        multistart_enabled: false,
        run_timeout_s: 5,
        solver_mode: "legacy_composite",
      },
    });

    const report = await call<{ markdown: string }>("export_report", fit);
    const reportCsv = await call<{ text: string }>("export_report_csv", fit);

    worker.terminate();

    return {
      hasDiode: registry.some((item) => item.function_type === "diode"),
      importedPoints: imported.traces[0].trace.voltage_V.length,
      invalidModelRejected: validation.some(
        (warning) =>
          warning.code === "nonpositive_temperature" &&
          warning.severity === "error",
      ),
      fitSuccess: fit.success,
      failedFitRejected: !failedFit.success && failedFit.warnings.some(
        (warning) => warning.severity === "error",
      ),
      fittedResistance: fit.parameters["Rsh.Rsh_ohm"]?.value,
      fittedPoints: fit.curves.current_fit_A.length,
      reportHeading: report.markdown.includes("# IV-fitter Web report"),
      reportCsvHasParameter: reportCsv.text.includes("Rsh.Rsh_ohm"),
    };
  });

  expect(result.hasDiode).toBe(true);
  expect(result.importedPoints).toBe(5);
  expect(result.invalidModelRejected).toBe(true);
  expect(result.fitSuccess).toBe(true);
  expect(result.failedFitRejected).toBe(true);
  expect(Math.abs((result.fittedResistance ?? 0) - 1000)).toBeLessThan(0.1);
  expect(result.fittedPoints).toBe(5);
  expect(result.reportHeading).toBe(true);
  expect(result.reportCsvHasParameter).toBe(true);
});


test("static UI uses four-step workflow and imports bundled HappyMeasure sample", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("http://127.0.0.1:4173/");

  const workflow = page.getByRole("navigation", { name: "Analysis workflow" });
  await expect(workflow.getByRole("button", { name: "1 Import data" })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(workflow.getByRole("button", { name: "2 Model builder" })).toBeVisible();
  await expect(workflow.getByRole("button", { name: "3 Fit" })).toBeVisible();
  await expect(workflow.getByRole("button", { name: "4 Report" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Help" })).toHaveCount(0);
  await expect(page.locator(".workflow-top-utilities")).toHaveCount(0);
  await expect(page.locator(".workflow-language-control")).toHaveCount(0);
  await expect(page.locator(".workflow-zoom-control")).toHaveCount(0);
  await expect(page.locator(".workflow-version")).toHaveCount(0);

  await workflow.getByRole("button", { name: "4 Report" }).click();
  await expect(page.getByText("No completed fit yet.")).toBeVisible();
  await expect(page.getByText("No critical issue detected")).toHaveCount(0);
  await expect(page.getByText("Warnings and diagnostics")).toHaveCount(0);
  await workflow.getByRole("button", { name: "1 Import data" }).click();

  await page.getByRole("button", { name: "Sample data" }).click();
  await page.getByRole("button", { name: "Load sample data" }).click();

  await expect(
    page.getByText(/Sample HappyMeasure data loaded\. \(14 traces\)/),
  ).toBeVisible({ timeout: 180_000 });
  const importSummary = page.getByRole("region", { name: "Import summary" });
  await expect(importSummary.getByText(/14 traces · 1330 points/)).toBeVisible();

  await page.screenshot({
    path: "test-results/four-step-import.png",
    fullPage: true,
  });

  await workflow.getByRole("button", { name: "3 Fit" }).click();
  await expect(page.locator(".fitting-page-one-column")).toBeVisible();
  const emptyRunFit = page.getByRole("button", { name: "Run fit" });
  await expect(emptyRunFit).toBeDisabled();
  await expect(page.getByText("No runnable model.")).toBeVisible();

  await workflow.getByRole("button", { name: "2 Model builder" }).click();
  await expect(page.locator(".mbv3-direct-page")).toBeVisible();
  await page.getByRole("button", { name: "Model presets" }).click();
  await page.getByText("Single diode model", { exact: true }).click();
  const useModel = page.getByRole("button", { name: "Use model for fitting" });
  await expect(useModel).toBeEnabled();
  await page.screenshot({
    path: "test-results/four-step-model.png",
    fullPage: true,
  });
  await useModel.click();

  await expect(page.locator(".fitting-page-one-column")).toBeVisible();
  const runFit = page.getByRole("button", { name: "Run fit" });
  await expect(runFit).toBeEnabled();
  await page.screenshot({
    path: "test-results/four-step-fit.png",
    fullPage: true,
  });

  await workflow.getByRole("button", { name: "4 Report" }).click();
  await expect(page.locator(".scientific-report-page")).toBeVisible();
  await expect(page.getByText("No completed fit yet.")).toBeVisible();
  await page.screenshot({
    path: "test-results/four-step-report.png",
    fullPage: true,
  });

  await workflow.getByRole("button", { name: "3 Fit" }).click();
  await page.evaluate(() => {
    (window as unknown as { __ivfitterStopClicked?: boolean }).__ivfitterStopClicked = false;
    const clickStopWhenAvailable = () => {
      const stop = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Stop fit"),
      ) as HTMLButtonElement | undefined;
      if (!stop) return false;
      stop.click();
      (window as unknown as { __ivfitterStopClicked?: boolean }).__ivfitterStopClicked = true;
      return true;
    };
    const observer = new MutationObserver(() => {
      if (clickStopWhenAvailable()) observer.disconnect();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    clickStopWhenAvailable();
  });
  await runFit.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Boolean(
            (window as unknown as { __ivfitterStopClicked?: boolean })
              .__ivfitterStopClicked,
          ),
      ),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: "Run fit" })).toBeVisible();
  await expect(page.getByText(/Cancelled ·/)).toBeVisible();

  await page.getByRole("button", { name: "Advanced" }).click();
  await page
    .getByLabel("Assembly/solver mode")
    .selectOption("legacy_composite");
  const timeoutInput = page.getByLabel("Run timeout (s)");
  await timeoutInput.fill("3");
  await timeoutInput.press("Enter");
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Run fit" }).click();
  const terminalStatus = page.locator(".fit-status-compact");
  await expect
    .poll(async () => (await terminalStatus.textContent()) ?? "", {
      timeout: 15_000,
    })
    .toMatch(/Converged|Timeout|Error/);
  await expect(
    page.getByRole("button", { name: /Run fit|Run again/ }),
  ).toBeEnabled();

  const traceSelect = page.locator(".plot-trace-select select");
  await expect(traceSelect.locator("option")).toHaveCount(14);
  const originalTrace = await traceSelect.inputValue();
  const options = await traceSelect.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLOptionElement).value),
  );
  const replacementTrace = options.find((value) => value !== originalTrace);
  expect(replacementTrace).toBeTruthy();
  await traceSelect.selectOption(replacementTrace!);

  await expect(page.getByRole("button", { name: "Run fit" })).toBeVisible();
  await workflow.getByRole("button", { name: "4 Report" }).click();
  await expect(page.getByText("No completed fit yet.")).toBeVisible();
  await expect(page.getByText("No critical issue detected")).toHaveCount(0);
});

test("successful synthetic fit exports reports and model changes invalidate it", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("http://127.0.0.1:4173/");

  const workflow = page.getByRole("navigation", { name: "Analysis workflow" });
  await workflow.getByRole("button", { name: "2 Model builder" }).click();
  await expect(page.locator(".mbv3-direct-page")).toBeVisible();

  await page.getByRole("button", { name: "Model presets" }).click();
  await page.getByText("Single diode model", { exact: true }).click();
  const useModel = page.getByRole("button", { name: "Use model for fitting" });
  await expect(useModel).toBeEnabled();

  await page.getByRole("button", { name: "Simulate IV" }).click();
  await expect(page.getByText("Synthetic IV", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Generate and import" }).click();
  await expect(page.getByText("Synthetic trace generated and imported.")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Simulate IV" }).click();

  await useModel.click();
  await expect(page.locator(".fitting-page-one-column")).toBeVisible();

  await page.getByRole("button", { name: "Advanced" }).click();
  await page.getByLabel("Assembly/solver mode").selectOption("legacy_composite");
  const timeoutInput = page.getByLabel("Run timeout (s)");
  await timeoutInput.fill("20");
  await timeoutInput.press("Enter");
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Run fit" }).click();
  await expect(page.getByRole("button", { name: "Run again" })).toBeVisible({
    timeout: 60_000,
  });

  await workflow.getByRole("button", { name: "4 Report" }).click();
  await expect(page.getByText("No completed fit yet.")).toHaveCount(0);
  await expect(page.locator(".scientific-report-page")).toBeVisible();

  const htmlButton = page.getByRole("button", { name: /Download .*HTML/ });
  const csvButton = page.getByRole("button", { name: /Download .*CSV/ });
  await expect(htmlButton).toBeEnabled();
  await expect(csvButton).toBeEnabled();

  const [htmlDownload] = await Promise.all([
    page.waitForEvent("download"),
    htmlButton.click(),
  ]);
  expect(htmlDownload.suggestedFilename()).toMatch(/\.html$/);

  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    csvButton.click(),
  ]);
  expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/);

  await workflow.getByRole("button", { name: "2 Model builder" }).click();
  await page.getByRole("button", { name: "Model presets" }).click();
  await page.getByText("Two diode model", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Use model for fitting" })).toBeEnabled();

  await workflow.getByRole("button", { name: "4 Report" }).click();
  await expect(page.getByText("No completed fit yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Download .*HTML/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Download .*CSV/ })).toHaveCount(0);
});

test("four-step navigation remains usable on a narrow viewport", async ({ page }) => {
  await page.route("https://cdn.jsdelivr.net/pyodide/**", async (route) => {
    await route.abort("failed");
  });
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto("http://127.0.0.1:4173/");

  const workflow = page.getByRole("navigation", { name: "Analysis workflow" });
  for (const name of [
    "Import data",
    "Model builder",
    "Fit",
    "Report",
  ]) {
    const button = workflow.getByRole("button", { name: new RegExp(name) });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(420);
  }

  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(Math.max(overflow.body, overflow.html)).toBeLessThanOrEqual(1);
});

test("static UI reports browser runtime bootstrap failure and offers retry", async ({ page }) => {
  await page.route("https://cdn.jsdelivr.net/pyodide/**", async (route) => {
    await route.abort("failed");
  });

  await page.goto("http://127.0.0.1:4173/");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Local fitting engine failed to start", {
    timeout: 30_000,
  });
  await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
});
