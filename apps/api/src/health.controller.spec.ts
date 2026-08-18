import { HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';

function makeController(dbOk: boolean, storageOk: boolean) {
  const dataSource = {
    query: dbOk ? jest.fn().mockResolvedValue([{ '?column?': 1 }]) : jest.fn().mockRejectedValue(new Error('down')),
  } as any;
  const storage = { isHealthy: jest.fn().mockResolvedValue(storageOk) } as any;
  return new HealthController(dataSource, storage);
}

function mockRes() {
  return { status: jest.fn().mockReturnThis() } as any;
}

describe('HealthController', () => {
  it('liveness reports ok without touching any dependency', () => {
    const controller = makeController(true, true);
    expect(controller.liveness().status).toBe('ok');
  });

  it('readiness returns 200 when both dependencies are reachable', async () => {
    const controller = makeController(true, true);
    const res = mockRes();
    const body = await controller.readiness(res);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(body).toEqual({
      status: 'ok',
      dependencies: { database: 'ok', objectStorage: 'ok' },
      time: expect.any(String),
    });
  });

  it('readiness returns 503 and pinpoints a down database', async () => {
    const controller = makeController(false, true);
    const res = mockRes();
    const body = await controller.readiness(res);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.status).toBe('degraded');
    expect(body.dependencies).toEqual({ database: 'down', objectStorage: 'ok' });
  });

  it('readiness returns 503 and pinpoints down object storage', async () => {
    const controller = makeController(true, false);
    const res = mockRes();
    const body = await controller.readiness(res);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.dependencies).toEqual({ database: 'ok', objectStorage: 'down' });
  });

  it('readiness returns 503 when both dependencies are down', async () => {
    const controller = makeController(false, false);
    const res = mockRes();
    const body = await controller.readiness(res);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.dependencies).toEqual({ database: 'down', objectStorage: 'down' });
  });
});
