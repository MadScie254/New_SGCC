import { Empty, PageHeader } from "@/components/ui";

export function DigitalTwinPage() {
  return (
    <>
      <PageHeader eyebrow="GridSentinel X" title="3D digital twin" />
      <Empty title="This workspace is not installed in this build" message="Its page module has not been built yet." />
    </>
  );
}
