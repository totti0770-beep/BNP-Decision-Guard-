import { PageHeader } from '@/components/shell';
import { AssistantChat } from '@/components/assistant-chat';

export default function AssistantPage() {
  return (
    <>
      <PageHeader
        title="AI Nursing Assistant"
        subtitle="Ask about policies, procedures, protocols and medications — answers cite approved documents only."
      />
      <AssistantChat
        assistantType="NURSING"
        placeholder="e.g. How long should I rub my hands with alcohol-based hand rub?"
      />
    </>
  );
}
