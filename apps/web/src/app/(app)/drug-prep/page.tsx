'use client';

import { PageHeader } from '@/components/shell';
import { useT } from '@/lib/language';
import { AssistantChat } from '@/components/assistant-chat';

export default function DrugPrepPage() {
  const t = useT();
  return (
    <>
      <PageHeader
        title={t('drugPrepTitle')}
        subtitle={t('drugPrepSubtitle')}
      />
      <AssistantChat
        assistantType="DRUG_PREPARATION"
        placeholder={t('drugPrepPlaceholder')}
      />
    </>
  );
}
