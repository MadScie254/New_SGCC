import { Empty, PageHeader } from "@/components/ui";

export function ResearchOverviewPage() {
  return (
    <>
      <PageHeader eyebrow="GridSentinel X" title="Research overview" />
      <Empty title="This workspace is not installed in this build" message="Its page module has not been built yet." />
    </>
  );
}
