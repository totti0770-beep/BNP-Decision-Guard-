import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Global so any domain service can send mail without re-importing the module. */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
