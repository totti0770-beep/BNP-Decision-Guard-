import { ConfidenceLevel, Permission, RoleName, permissionsForRoles } from '@bnp/shared';
import { ChatService } from './chat.service';
import { AuthenticatedUser } from '../common/decorators';

const RAG_RESULT = {
  refused: true,
  shortAnswer: 'refusal',
  steps: [],
  warnings: [],
  confidence: ConfidenceLevel.NONE,
  citations: [],
  model: 'test',
  diagnostics: {
    candidateCount: 3,
    bestScore: 0.19,
    threshold: 0.25,
    refusedAt: 'BELOW_THRESHOLD' as const,
  },
};

function makeService() {
  const repo = {
    save: jest.fn(async (x: unknown) => ({ id: 'id-1', ...(x as object) })),
    create: jest.fn((x: unknown) => x),
  };
  return new ChatService(
    repo as never,
    repo as never,
    { ask: jest.fn().mockResolvedValue(RAG_RESULT) } as never,
    { record: jest.fn() } as never,
  );
}

const actor = (role: RoleName): AuthenticatedUser => ({
  userId: 'u1',
  email: 'x@bnp.health',
  fullName: 'X',
  roles: [role],
  permissions: permissionsForRoles([role]),
});

describe('Refusal diagnostics exposure', () => {
  it('withholds diagnostics from a nurse', async () => {
    const res = await makeService().ask({ question: 'q' }, actor(RoleName.NURSE_USER));
    expect(res.refused).toBe(true);
    expect(res).not.toHaveProperty('diagnostics');
  });

  it('returns diagnostics to a knowledge manager', async () => {
    const res = await makeService().ask(
      { question: 'q' },
      actor(RoleName.NURSING_KNOWLEDGE_MANAGER),
    );
    expect((res as { diagnostics?: unknown }).diagnostics).toEqual(
      RAG_RESULT.diagnostics,
    );
  });

  it('pins the gating permission: nurses lack analytics:read, managers have it', () => {
    expect(permissionsForRoles([RoleName.NURSE_USER])).not.toContain(
      Permission.ANALYTICS_READ,
    );
    expect(
      permissionsForRoles([RoleName.NURSING_KNOWLEDGE_MANAGER]),
    ).toContain(Permission.ANALYTICS_READ);
  });
});
