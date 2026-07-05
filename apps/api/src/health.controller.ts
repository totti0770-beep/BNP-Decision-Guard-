import { Controller, Get } from '@nestjs/common';
import { PLATFORM_NAME } from '@bnp/shared';
import { Public } from './common/decorators';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', platform: PLATFORM_NAME, time: new Date().toISOString() };
  }
}
