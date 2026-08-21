'use client';

import { PageHeader } from '@/components/shell';
import { useT } from '@/lib/language';
import { AssistantChat } from '@/components/assistant-chat';

export default function AssistantPage() {
  const t = useT();
  return (
    <>
      <PageHeader
        title={t('assistantTitle')}
        subtitle={t('assistantSubtitle')}
      />
      <AssistantChat
        assistantType="NURSING"
        placeholder={t('assistantPlaceholder')}
      />
    </>
  );
}
