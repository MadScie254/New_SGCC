import { Empty, PageHeader } from "@/components/ui";

export function RunDetailPage() {
  return (
    <>
      <PageHeader eyebrow="GridSentinel X" title="Experiment run" />
      <Empty title="This workspace is not installed in this build" message="Its page module has not been built yet." />
    </>
  );
}
