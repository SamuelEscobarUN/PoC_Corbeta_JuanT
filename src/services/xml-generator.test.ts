/**
 * Tests unitarios para XmlGeneratorService.
 *
 * Se mockea uploadData de Amplify Storage para que los tests
 * corran sin servicios AWS reales.
 *
 * Verificamos:
 *  - generateCorrectionXml genera XML con estructura correcta
 *  - generateCorrectionXml incluye todos los campos requeridos
 *  - generateCorrectionXml escapa caracteres especiales XML
 *  - generateCorrectionXml maneja correctedValues con múltiples campos
 *  - generateCorrectionXml maneja item vacío
 *  - saveCorrectionXml sube XML a S3 en la ruta correcta
 *  - saveCorrectionXml usa contentType application/xml
 *  - saveCorrectionXml lanza error cuando S3 falla
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks de Amplify Storage antes de importar el servicio            */
/* ------------------------------------------------------------------ */
const mockUploadResult = vi.hoisted(() => vi.fn());

vi.mock('aws-amplify/storage', () => ({
  uploadData: vi.fn(() => ({
    result: mockUploadResult(),
  })),
}));

import { uploadData } from 'aws-amplify/storage';
import { XmlGeneratorService } from './xml-generator';
import type { Correction } from '../types/remediation';

/* ------------------------------------------------------------------ */
/*  Helper para construir corrección de prueba                        */
/* ------------------------------------------------------------------ */

function makeCorrection(overrides?: Partial<Correction>): Correction {
  return {
    correctionId: 'corr-001',
    discrepancyId: 'disc-001',
    findingId: 'finding-001',
    invoice: 'INV-001',
    item: 'ITEM-A',
    originStage: 'geopos_local',
    correctedValues: { total: 1500 },
    status: 'approved',
    proposedBy: 'operator@test.com',
    proposedAt: '2024-01-15T10:00:00.000Z',
    approvedBy: 'admin@test.com',
    reviewedAt: '2024-01-15T12:00:00.000Z',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T12:00:00.000Z',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('XmlGeneratorService', () => {
  let service: XmlGeneratorService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadResult.mockResolvedValue({});
    service = new XmlGeneratorService();
  });

  /* ---- generateCorrectionXml ------------------------------------- */

  describe('generateCorrectionXml', () => {
    it('genera XML con declaración y elemento raíz correction', () => {
      const xml = service.generateCorrectionXml(makeCorrection());

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<correction>');
      expect(xml).toContain('</correction>');
    });

    it('incluye correctionId, invoice, item y originStage', () => {
      const xml = service.generateCorrectionXml(makeCorrection());

      expect(xml).toContain('<correctionId>corr-001</correctionId>');
      expect(xml).toContain('<invoice>INV-001</invoice>');
      expect(xml).toContain('<item>ITEM-A</item>');
      expect(xml).toContain('<originStage>geopos_local</originStage>');
    });

    it('incluye correctedValues como elementos field', () => {
      const xml = service.generateCorrectionXml(makeCorrection());

      expect(xml).toContain('<correctedValues>');
      expect(xml).toContain('<field name="total">1500</field>');
      expect(xml).toContain('</correctedValues>');
    });

    it('incluye metadata con approvedBy, approvedAt, discrepancyId, findingId', () => {
      const xml = service.generateCorrectionXml(makeCorrection());

      expect(xml).toContain('<metadata>');
      expect(xml).toContain('<approvedBy>admin@test.com</approvedBy>');
      expect(xml).toContain('<approvedAt>2024-01-15T12:00:00.000Z</approvedAt>');
      expect(xml).toContain('<discrepancyId>disc-001</discrepancyId>');
      expect(xml).toContain('<findingId>finding-001</findingId>');
      expect(xml).toContain('</metadata>');
    });

    it('maneja múltiples correctedValues', () => {
      const correction = makeCorrection({
        correctedValues: { total: 2000, sku: 'ABC-123', quantity: 5 },
      });

      const xml = service.generateCorrectionXml(correction);

      expect(xml).toContain('<field name="total">2000</field>');
      expect(xml).toContain('<field name="sku">ABC-123</field>');
      expect(xml).toContain('<field name="quantity">5</field>');
    });

    it('maneja item vacío (undefined)', () => {
      const correction = makeCorrection({ item: undefined });

      const xml = service.generateCorrectionXml(correction);

      expect(xml).toContain('<item></item>');
    });

    it('escapa caracteres especiales XML en valores', () => {
      const correction = makeCorrection({
        invoice: 'INV<001>&"test"',
        correctedValues: { note: "valor con <tags> & 'comillas'" },
      });

      const xml = service.generateCorrectionXml(correction);

      expect(xml).toContain('<invoice>INV&lt;001&gt;&amp;&quot;test&quot;</invoice>');
      expect(xml).toContain(
        '<field name="note">valor con &lt;tags&gt; &amp; &apos;comillas&apos;</field>',
      );
    });

    it('maneja correctedValues vacío', () => {
      const correction = makeCorrection({ correctedValues: {} });

      const xml = service.generateCorrectionXml(correction);

      expect(xml).toContain('<correctedValues>');
      expect(xml).toContain('</correctedValues>');
      expect(xml).not.toContain('<field');
    });

    it('maneja metadata sin approvedBy ni reviewedAt', () => {
      const correction = makeCorrection({
        approvedBy: undefined,
        reviewedAt: undefined,
      });

      const xml = service.generateCorrectionXml(correction);

      expect(xml).toContain('<approvedBy></approvedBy>');
      expect(xml).toContain('<approvedAt></approvedAt>');
    });
  });

  /* ---- saveCorrectionXml ----------------------------------------- */

  describe('saveCorrectionXml', () => {
    it('sube XML a S3 en la ruta corrections/{correctionId}/correction.xml', async () => {
      const correction = makeCorrection();

      const s3Key = await service.saveCorrectionXml(correction);

      expect(s3Key).toBe('corrections/corr-001/correction.xml');
    });

    it('llama uploadData con path, data XML y contentType correcto', async () => {
      const correction = makeCorrection();

      await service.saveCorrectionXml(correction);

      expect(uploadData).toHaveBeenCalledTimes(1);
      const callArg = (uploadData as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArg.path).toBe('corrections/corr-001/correction.xml');
      expect(callArg.data).toContain('<correction>');
      expect(callArg.data).toContain('<correctionId>corr-001</correctionId>');
      expect(callArg.options.contentType).toBe('application/xml');
    });

    it('lanza error cuando S3 falla', async () => {
      mockUploadResult.mockRejectedValue(new Error('S3 upload error'));

      await expect(
        service.saveCorrectionXml(makeCorrection()),
      ).rejects.toThrow('S3 upload error');
    });

    it('genera XML individual por cada corrección', async () => {
      const corr1 = makeCorrection({ correctionId: 'corr-A' });
      const corr2 = makeCorrection({ correctionId: 'corr-B', invoice: 'INV-002' });

      const key1 = await service.saveCorrectionXml(corr1);
      const key2 = await service.saveCorrectionXml(corr2);

      expect(key1).toBe('corrections/corr-A/correction.xml');
      expect(key2).toBe('corrections/corr-B/correction.xml');
      expect(uploadData).toHaveBeenCalledTimes(2);

      // Verificar que cada XML tiene su propio correctionId
      const call1Data = (uploadData as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
      const call2Data = (uploadData as ReturnType<typeof vi.fn>).mock.calls[1][0].data;
      expect(call1Data).toContain('<correctionId>corr-A</correctionId>');
      expect(call2Data).toContain('<correctionId>corr-B</correctionId>');
      expect(call2Data).toContain('<invoice>INV-002</invoice>');
    });
  });
});
