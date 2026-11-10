import { Empty, PageHeader } from "@/components/ui";

export function ExperimentManagerPage() {
  return (
    <>
      <PageHeader eyebrow="GridSentinel X" title="ML experiment manager" />
      <Empty title="This workspace is not installed in this build" message="Its page module has not been built yet." />
    </>
  );
}
