import { Empty, PageHeader } from "@/components/ui";

export function RegistryPage() {
  return (
    <>
      <PageHeader eyebrow="GridSentinel X" title="Model registry and provenance" />
      <Empty title="This workspace is not installed in this build" message="Its page module has not been built yet." />
    </>
  );
}
