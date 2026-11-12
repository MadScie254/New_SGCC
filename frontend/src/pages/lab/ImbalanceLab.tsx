import { Empty, PageHeader } from "@/components/ui";

export function ImbalanceLabPage() {
  return (
    <>
      <PageHeader title="Class imbalance laboratory" />
      <Empty title="This workspace is not installed in this build" message="Its page module has not been built yet." />
    </>
  );
}
