import { Empty, PageHeader } from "@/components/ui";

export function ThesisDefensePage() {
  return (
    <>
      <PageHeader title="Thesis defense mode" />
      <Empty title="This workspace is not installed in this build" message="Its page module has not been built yet." />
    </>
  );
}
