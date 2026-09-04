import { Injectable } from '@nestjs/common';
import { signatureBoxSchema } from '@fixer/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AgreementRecord,
  AgreementStore,
  AgreementTemplateRecord,
  AgreementTemplateStore,
} from './agreement.service';

/** 활성 템플릿을 읽는다. 활성은 하나라는 규칙은 seed가 지킨다 (ADR-AGR-4) */
@Injectable()
export class PrismaAgreementTemplateStore implements AgreementTemplateStore {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(): Promise<AgreementTemplateRecord | null> {
    const row = await this.prisma.agreementTemplate.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!row) return null;

    // signatureBox는 Json이라 모양을 여기서 확인한다. 틀리면 서명이
    // 엉뚱한 곳에 박히므로 조용히 넘기지 않는다.
    return { ...row, signatureBox: signatureBoxSchema.parse(row.signatureBox) };
  }
}

@Injectable()
export class PrismaAgreementStore implements AgreementStore {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string;
    templateVersion: number;
    filePath: string;
    sha256: string;
    ip: string;
    userAgent: string;
  }): Promise<AgreementRecord> {
    return this.prisma.agreement.create({ data: input });
  }

  async findById(id: string): Promise<AgreementRecord | null> {
    return this.prisma.agreement.findUnique({ where: { id } });
  }

  async findLatestByUser(userId: string): Promise<AgreementRecord | null> {
    return this.prisma.agreement.findFirst({
      where: { userId },
      orderBy: { agreedAt: 'desc' },
    });
  }
}
