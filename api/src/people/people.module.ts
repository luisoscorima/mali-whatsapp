import { Module } from '@nestjs/common';
import { PersonResolverService } from './person-resolver.service';

@Module({
  providers: [PersonResolverService],
  exports: [PersonResolverService],
})
export class PeopleModule {}
