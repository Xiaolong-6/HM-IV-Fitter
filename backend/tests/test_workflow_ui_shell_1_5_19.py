from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read_repo_file(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_workflow_navigation_is_four_step_top_shell():
    nav = read_repo_file("frontend/src/components/WorkflowTopNav.tsx")
    shell = read_repo_file("frontend/src/pages/FittingPage.tsx")

    assert 'export type WorkflowStep = "data" | "model" | "fitting" | "report"' in nav
    for label in ["Import data", "Model builder", "Fit", "Report"]:
        assert label in nav

    assert "WorkflowTopNav" in shell
    assert "WorkflowSidebar" not in shell
    assert "StartHerePage" not in shell
    assert "UserDocumentationPage" not in shell


def test_default_page_is_import_data_and_four_task_pages_exist():
    page = read_repo_file("frontend/src/pages/FittingPage.tsx")
    layout_hook = read_repo_file("frontend/src/pages/hooks/useWorkflowLayoutState.ts")
    workflow_sections = read_repo_file("frontend/src/pages/components/WorkflowSections.tsx")
    report_page = read_repo_file("frontend/src/pages/components/ReportWorkflowPage.tsx")

    assert 'useState<WorkflowStep>("data")' in layout_hook
    assert 'activeView === "data"' in page
    assert 'activeView === "model"' in page
    assert 'activeView === "fitting"' in page

    assert "function ModelWorkflowPage" in workflow_sections
    assert "function FittingWorkflowPage" in workflow_sections
    assert "function ReportWorkflowPage" in report_page


def test_existing_components_are_kept_on_task_specific_pages():
    page = read_repo_file("frontend/src/pages/FittingPage.tsx")
    workflow_sections = read_repo_file("frontend/src/pages/components/WorkflowSections.tsx")
    report_page = read_repo_file("frontend/src/pages/components/ReportWorkflowPage.tsx")

    assert "DataImportWorkspace" in page
    assert "ModelBuilder" in workflow_sections
    assert "EquationPreview" in workflow_sections
    assert "FitConfigPanel" in workflow_sections
    assert "PlotWorkspace" in workflow_sections
    assert "ParameterTable" in workflow_sections
    assert "FitProcessDiagnostics" in report_page


def test_four_step_shell_is_centered_and_has_no_global_utilities():
    nav = read_repo_file("frontend/src/components/WorkflowTopNav.tsx")
    page = read_repo_file("frontend/src/pages/FittingPage.tsx")
    layout_hook = read_repo_file("frontend/src/pages/hooks/useWorkflowLayoutState.ts")
    css = read_repo_file("frontend/src/styles/four-step-shell.css")

    assert "onLanguageChange" not in nav
    assert "zoomControl" not in nav
    assert "workflow-version" not in nav
    assert "中文" not in nav
    assert "four-step-app" in page
    assert "four-step-workspace" in page
    assert "sidebarCollapsed" not in layout_hook
    assert "language" not in layout_hook
    assert "grid-template-columns: repeat(4" in css
    assert "justify-content: center" in css
    assert "workflow-top-utilities" not in css


def test_report_page_exports_are_present():
    report_page = read_repo_file("frontend/src/pages/components/ReportWorkflowPage.tsx")
    client = read_repo_file("frontend/src/api/client.ts")

    assert "Download report CSV" in report_page
    assert "Download HTML report" in report_page
    assert "Download parameter CSV" not in report_page
    assert "Download diagnostics JSON" not in report_page
    assert "export-parameters-csv" not in client
    assert "export-diagnostics-json" not in client
