/**
 * XmlGeneratorService — servicio de generación de XML de corrección.
 *
 * Funcionalidades:
 *  - generateCorrectionXml: construye cadena XML con la estructura definida
 *  - saveCorrectionXml: genera XML y lo sube a S3 en corrections/{correctionId}/correction.xml
 *
 * Usa Amplify Storage (uploadData) para operaciones S3.
 * Requisitos: 9.4, 9.5, 9.6
 */

import { uploadData } from 'aws-amplify/storage';

import type { Correction } from '../types/remediation';
import { StoragePaths } from '../amplify-config';

/** Escapar caracteres especiales de XML. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class XmlGeneratorService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: XmlGeneratorService;

  constructor() {
    // Constructor público para permitir instancias de testing
  }

  static getInstance(): XmlGeneratorService {
    if (!XmlGeneratorService.instance) {
      XmlGeneratorService.instance = new XmlGeneratorService();
    }
    return XmlGeneratorService.instance;
  }

  /* ------------------------------------------------------------------ */
  /*  Generar XML de corrección                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Construir cadena XML con la estructura definida para una corrección.
   *
   * Estructura:
   * <correction>
   *   <correctionId>...</correctionId>
   *   <invoice>...</invoice>
   *   <item>...</item>
   *   <originStage>...</originStage>
   *   <correctedValues>
   *     <field name="...">valor</field>
   *   </correctedValues>
   *   <metadata>
   *     <approvedBy>...</approvedBy>
   *     <approvedAt>...</approvedAt>
   *     <discrepancyId>...</discrepancyId>
   *     <findingId>...</findingId>
   *   </metadata>
   * </correction>
   */
  generateCorrectionXml(correction: Correction): string {
    const lines: string[] = [];

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<correction>');
    lines.push(`  <correctionId>${escapeXml(correction.correctionId)}</correctionId>`);
    lines.push(`  <invoice>${escapeXml(correction.invoice)}</invoice>`);
    lines.push(`  <item>${escapeXml(correction.item ?? '')}</item>`);
    lines.push(`  <originStage>${escapeXml(correction.originStage)}</originStage>`);

    // Valores corregidos como elementos hijos
    lines.push('  <correctedValues>');
    for (const [key, value] of Object.entries(correction.correctedValues)) {
      const strValue = String(value ?? '');
      lines.push(`    <field name="${escapeXml(key)}">${escapeXml(strValue)}</field>`);
    }
    lines.push('  </correctedValues>');

    // Metadata de aprobación y trazabilidad
    lines.push('  <metadata>');
    lines.push(`    <approvedBy>${escapeXml(correction.approvedBy ?? '')}</approvedBy>`);
    lines.push(`    <approvedAt>${escapeXml(correction.reviewedAt ?? '')}</approvedAt>`);
    lines.push(`    <discrepancyId>${escapeXml(correction.discrepancyId)}</discrepancyId>`);
    lines.push(`    <findingId>${escapeXml(correction.findingId)}</findingId>`);
    lines.push('  </metadata>');

    lines.push('</correction>');

    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /*  Guardar XML en S3                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Generar XML de corrección y subirlo a S3.
   *
   * Ruta: corrections/{correctionId}/correction.xml
   */
  async saveCorrectionXml(correction: Correction): Promise<string> {
    const xml = this.generateCorrectionXml(correction);
    const s3Key = StoragePaths.correction(correction.correctionId);

    await uploadData({
      path: s3Key,
      data: xml,
      options: {
        contentType: 'application/xml',
      },
    }).result;

    return s3Key;
  }
}

/** Instancia singleton por defecto. */
export const xmlGeneratorService = XmlGeneratorService.getInstance();
