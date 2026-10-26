import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PeopleModule } from '../people/people.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

@Module({
  imports: [AuthModule, PeopleModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
