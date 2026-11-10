import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/layouts/AppShell";
import { Skeleton } from "@/components/ui";
import { CommandCenterPage } from "@/pages/CommandCenter";
import { CasesPage } from "@/pages/Cases";
import { CaseFilePage } from "@/pages/CaseFile";
import { PipelinePage } from "@/pages/Pipeline";
import { ThresholdStudioPage } from "@/pages/ThresholdStudio";
import { ResearchPage } from "@/pages/Research";
import { ReportsPage } from "@/pages/Reports";
import { SettingsPage } from "@/pages/Settings";

// Research workspaces load on demand: the operations console stays small, and the 3D twin's
// rendering libraries are only downloaded when that page is opened.
const lab = <T extends string>(load: () => Promise<Record<T, () => JSX.Element>>, name: T) =>
  lazy(async () => ({ default: (await load())[name] }));

const ResearchOverviewPage = lab(() => import("@/pages/lab/ResearchOverview"), "ResearchOverviewPage");
const DatasetObservatoryPage = lab(() => import("@/pages/lab/DatasetObservatory"), "DatasetObservatoryPage");
const FeatureStudioPage = lab(() => import("@/pages/lab/FeatureStudio"), "FeatureStudioPage");
const ImbalanceLabPage = lab(() => import("@/pages/lab/ImbalanceLab"), "ImbalanceLabPage");
const ExperimentManagerPage = lab(() => import("@/pages/lab/ExperimentManager"), "ExperimentManagerPage");
const RunDetailPage = lab(() => import("@/pages/lab/RunDetail"), "RunDetailPage");
const DeepStudioPage = lab(() => import("@/pages/lab/DeepStudio"), "DeepStudioPage");
const StatisticalEvaluationPage = lab(() => import("@/pages/lab/StatisticalEvaluation"), "StatisticalEvaluationPage");
const XaiCenterPage = lab(() => import("@/pages/lab/XaiCenter"), "XaiCenterPage");
const DigitalTwinPage = lab(() => import("@/pages/lab/DigitalTwin"), "DigitalTwinPage");
const ThesisDefensePage = lab(() => import("@/pages/lab/ThesisDefense"), "ThesisDefensePage");
const ResearchReportsPage = lab(() => import("@/pages/lab/ResearchReports"), "ResearchReportsPage");
const RegistryPage = lab(() => import("@/pages/lab/Registry"), "RegistryPage");

function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the workspace">
      <Skeleton className="h-12 w-80" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <Routes>
          {/* Research */}
          <Route path="/overview" element={<ResearchOverviewPage />} />
          <Route path="/observatory" element={<DatasetObservatoryPage />} />
          <Route path="/features" element={<FeatureStudioPage />} />
          <Route path="/imbalance" element={<ImbalanceLabPage />} />
          <Route path="/experiments" element={<ExperimentManagerPage />} />
          <Route path="/runs/:runId" element={<RunDetailPage />} />
          <Route path="/deep" element={<DeepStudioPage />} />
          <Route path="/statistics" element={<StatisticalEvaluationPage />} />
          <Route path="/xai" element={<XaiCenterPage />} />
          <Route path="/twin" element={<DigitalTwinPage />} />
          <Route path="/defense" element={<ThesisDefensePage />} />
          <Route path="/research-reports" element={<ResearchReportsPage />} />
          <Route path="/registry" element={<RegistryPage />} />
          <Route path="/research" element={<ResearchPage />} />
          {/* Operations */}
          <Route path="/" element={<CommandCenterPage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/cases/:customerId" element={<CaseFilePage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/threshold" element={<ThresholdStudioPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/admin" element={<SettingsPage />} />
          <Route path="/settings" element={<Navigate to="/admin" replace />} />
          <Route path="/model" element={<Navigate to="/research" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
