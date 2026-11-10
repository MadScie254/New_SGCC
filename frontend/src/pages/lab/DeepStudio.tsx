import { Empty, PageHeader } from "@/components/ui";

export function DeepStudioPage() {
  return (
    <>
      <PageHeader eyebrow="GridSentinel X" title="Deep learning and ensemble studio" />
      <Empty title="This workspace is not installed in this build" message="Its page module has not been built yet." />
    </>
  );
}
