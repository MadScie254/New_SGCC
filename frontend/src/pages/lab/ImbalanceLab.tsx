import { Empty, PageHeader } from "@/components/ui";

export function ImbalanceLabPage() {
  return (
    <>
      <PageHeader eyebrow="GridSentinel X" title="Class imbalance laboratory" />
      <Empty title="This workspace is not installed in this build" message="Its page module has not been built yet." />
    </>
  );
}
