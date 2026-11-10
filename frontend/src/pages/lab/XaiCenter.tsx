import { Empty, PageHeader } from "@/components/ui";

export function XaiCenterPage() {
  return (
    <>
      <PageHeader eyebrow="GridSentinel X" title="Explainable AI center" />
      <Empty title="This workspace is not installed in this build" message="Its page module has not been built yet." />
    </>
  );
}
