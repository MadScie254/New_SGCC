import { Empty, PageHeader } from "@/components/ui";

export function FeatureStudioPage() {
  return (
    <>
      <PageHeader title="Feature engineering studio" />
      <Empty title="This workspace is not installed in this build" message="Its page module has not been built yet." />
    </>
  );
}
