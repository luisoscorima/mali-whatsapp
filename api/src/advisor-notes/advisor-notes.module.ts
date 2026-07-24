import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdvisorNotesController } from './advisor-notes.controller';
import { AdvisorNotesService } from './advisor-notes.service';

@Module({
  imports: [AuthModule],
  controllers: [AdvisorNotesController],
  providers: [AdvisorNotesService],
})
export class AdvisorNotesModule {}
