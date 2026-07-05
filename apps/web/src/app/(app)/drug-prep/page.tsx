import { PageHeader } from '@/components/shell';
import { AssistantChat } from '@/components/assistant-chat';

export default function DrugPrepPage() {
  return (
    <>
      <PageHeader
        title="Drug Preparation Assistant"
        subtitle="Retrieval is restricted to approved medication documents."
      />
      <AssistantChat
        assistantType="DRUG_PREPARATION"
        placeholder="e.g. How do I prepare IV paracetamol for a dose below 1000 mg?"
      />
    </>
  );
}
