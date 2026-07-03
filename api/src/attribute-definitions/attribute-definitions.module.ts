import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttributeDefinitionsController } from './attribute-definitions.controller';
import { AttributeDefinitionsService } from './attribute-definitions.service';

@Module({
  imports: [AuthModule],
  controllers: [AttributeDefinitionsController],
  providers: [AttributeDefinitionsService],
  exports: [AttributeDefinitionsService],
})
export class AttributeDefinitionsModule {}
