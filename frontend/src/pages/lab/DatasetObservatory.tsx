import { Empty, PageHeader } from "@/components/ui";

export function DatasetObservatoryPage() {
  return (
    <>
      <PageHeader eyebrow="GridSentinel X" title="Dataset observatory" />
      <Empty title="This workspace is not installed in this build" message="Its page module has not been built yet." />
    </>
  );
}
