import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { MetaLeadgenService } from './meta-leadgen.service';

@Module({
  imports: [PrismaModule],
  controllers: [LeadsController],
  providers: [LeadsService, MetaLeadgenService],
  exports: [LeadsService, MetaLeadgenService],
})
export class LeadsModule {}
