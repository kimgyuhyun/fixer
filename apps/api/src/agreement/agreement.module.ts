import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AgreementController } from './agreement.controller';
import { AgreementService } from './agreement.service';
import { LocalFileStore } from './local-file.store';
import { PdfLibMerger } from './pdf-lib.merger';
import {
  PrismaAgreementStore,
  PrismaAgreementTemplateStore,
} from './prisma-agreement.store';

/**
 * 동의서 도메인. (이슈 #7)
 *
 * 파일 저장소를 여기서 꽂으므로 S3로 옮길 때 이 파일 한 줄만 고친다 (ADR-AGR-3).
 */
@Module({
  imports: [PrismaModule],
  controllers: [AgreementController],
  providers: [
    PrismaAgreementTemplateStore,
    PrismaAgreementStore,
    PdfLibMerger,
    {
      provide: LocalFileStore,
      useFactory: (c: ConfigService) => new LocalFileStore(c),
      inject: [ConfigService],
    },
    {
      provide: AgreementService,
      useFactory: (
        templates: PrismaAgreementTemplateStore,
        agreements: PrismaAgreementStore,
        files: LocalFileStore,
        merger: PdfLibMerger,
      ) => new AgreementService(templates, agreements, files, merger),
      inject: [
        PrismaAgreementTemplateStore,
        PrismaAgreementStore,
        LocalFileStore,
        PdfLibMerger,
      ],
    },
  ],
  exports: [AgreementService],
})
export class AgreementModule {}
