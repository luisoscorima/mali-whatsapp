import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateAdvisorNoteDto, UpdateAdvisorNoteDto } from './dto/advisor-note.dto';

export type AdvisorNoteDto = {
  id: number;
  title: string;
  body: string;
  sort_order: number;
  updated_at: string;
};

@Injectable()
export class AdvisorNotesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: number): Promise<AdvisorNoteDto[]> {
    const rows = await this.prisma.advisor_notes.findMany({
      where: { user_id: userId },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      sort_order: r.sort_order,
      updated_at: r.updated_at.toISOString(),
    }));
  }

  async create(userId: number, dto: CreateAdvisorNoteDto): Promise<AdvisorNoteDto> {
    const title = String(dto.title || '').trim();
    const body = String(dto.body || '').trim();
    if (!title || !body) {
      throw new BadRequestException('Título y texto son obligatorios');
    }
    const maxOrder = await this.prisma.advisor_notes.aggregate({
      where: { user_id: userId },
      _max: { sort_order: true },
    });
    const row = await this.prisma.advisor_notes.create({
      data: {
        user_id: userId,
        title: title.slice(0, 120),
        body: body.slice(0, 4000),
        sort_order: (maxOrder._max.sort_order ?? -1) + 1,
      },
    });
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      sort_order: row.sort_order,
      updated_at: row.updated_at.toISOString(),
    };
  }

  async update(
    userId: number,
    id: number,
    dto: UpdateAdvisorNoteDto,
  ): Promise<AdvisorNoteDto> {
    const existing = await this.prisma.advisor_notes.findFirst({
      where: { id, user_id: userId },
    });
    if (!existing) throw new NotFoundException('Nota no encontrada');

    const data: {
      title?: string;
      body?: string;
      sort_order?: number;
      updated_at: Date;
    } = { updated_at: new Date() };
    if (dto.title != null) {
      const title = String(dto.title).trim();
      if (!title) throw new BadRequestException('Título vacío');
      data.title = title.slice(0, 120);
    }
    if (dto.body != null) {
      const body = String(dto.body).trim();
      if (!body) throw new BadRequestException('Texto vacío');
      data.body = body.slice(0, 4000);
    }
    if (dto.sort_order != null && Number.isInteger(dto.sort_order)) {
      data.sort_order = dto.sort_order;
    }

    const row = await this.prisma.advisor_notes.update({
      where: { id },
      data,
    });
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      sort_order: row.sort_order,
      updated_at: row.updated_at.toISOString(),
    };
  }

  async remove(userId: number, id: number): Promise<void> {
    const result = await this.prisma.advisor_notes.deleteMany({
      where: { id, user_id: userId },
    });
    if (result.count === 0) throw new NotFoundException('Nota no encontrada');
  }
}
