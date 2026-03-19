/**
 * ComparisonService — motor de comparación progresiva entre etapas
 * consecutivas de la cascada de reconciliación.
 *
 * Compara datos transformados de dos etapas (source → target) y detecta
 * cuatro tipos de discrepancia:
 *  - missing_invoice:       factura presente en source pero ausente en target
 *  - total_difference:      misma factura con totalFactura diferente
 *  - item_count_difference: misma factura con cantidad de ítems diferente
 *  - missing_item:          ítem presente en source pero ausente en target
 *
 * Persiste las discrepancias en DynamoDB (tabla Discrepancies) y permite
 * consultar por factura usando el GSI invoice-index.
 *
 * Usa Amplify Data (generateClient) para operaciones DynamoDB.
 */

import { generateClient } from 'aws-amplify/data';

import type { Schema } from '../../amplify/data/resource';
import type { TransformedData, TransformedInvoice } from './transform/types';
import type {
  Discrepancy,
  DiscrepancyDetails,
  DiscrepancySeverity,
  DiscrepancyType,
  ComparisonResult,
  ComparisonSummary,
} from '../types/comparison';

/** Cliente Amplify Data tipado con nuestro esquema. */
const client = generateClient<Schema>();

export class ComparisonService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: ComparisonService;

  private constructor() {}

  static getInstance(): ComparisonService {
    if (!ComparisonService.instance) {
      ComparisonService.instance = new ComparisonService();
    }
    return ComparisonService.instance;
  }

  /** Crear instancia independiente para tests (sin singleton). */
  static createForTesting(): ComparisonService {
    return new ComparisonService();
  }

  /* ------------------------------------------------------------------ */
  /*  Comparación entre etapas                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Comparar datos transformados de dos etapas consecutivas.
   *
   * Recorre las facturas del source y detecta discrepancias contra el target.
   * Retorna un resultado consolidado con todas las discrepancias y un resumen.
   */
  compareStages(
    sourceData: TransformedData,
    targetData: TransformedData,
  ): ComparisonResult {
    const discrepancies: Discrepancy[] = [];
    const now = new Date().toISOString();

    // Indexar facturas del target por número de factura para búsqueda O(1)
    const targetMap = new Map<string, TransformedInvoice>();
    for (const inv of targetData.invoices) {
      targetMap.set(inv.invoice, inv);
    }

    // Recorrer facturas del source y comparar contra target
    for (const sourceInvoice of sourceData.invoices) {
      const targetInvoice = targetMap.get(sourceInvoice.invoice);

      if (!targetInvoice) {
        // Factura presente en source pero ausente en target
        discrepancies.push(
          this.createDiscrepancy(
            sourceData.stage,
            targetData.stage,
            sourceInvoice.invoice,
            'missing_invoice',
            {
              expectedValue: sourceInvoice.invoice,
              message: `Factura ${sourceInvoice.invoice} presente en ${sourceData.stage} pero ausente en ${targetData.stage}`,
            },
            'high',
            now,
          ),
        );
        continue;
      }

      // Comparar totales
      if (sourceInvoice.totalFactura !== targetInvoice.totalFactura) {
        discrepancies.push(
          this.createDiscrepancy(
            sourceData.stage,
            targetData.stage,
            sourceInvoice.invoice,
            'total_difference',
            {
              expectedValue: String(sourceInvoice.totalFactura),
              actualValue: String(targetInvoice.totalFactura),
              message: `Total difiere para factura ${sourceInvoice.invoice}: esperado ${sourceInvoice.totalFactura}, encontrado ${targetInvoice.totalFactura}`,
            },
            this.determineSeverityForTotalDiff(
              sourceInvoice.totalFactura,
              targetInvoice.totalFactura,
            ),
            now,
          ),
        );
      }

      // Comparar cantidad de ítems
      if (sourceInvoice.itemCount !== targetInvoice.itemCount) {
        discrepancies.push(
          this.createDiscrepancy(
            sourceData.stage,
            targetData.stage,
            sourceInvoice.invoice,
            'item_count_difference',
            {
              expectedValue: String(sourceInvoice.itemCount),
              actualValue: String(targetInvoice.itemCount),
              message: `Cantidad de ítems difiere para factura ${sourceInvoice.invoice}: esperado ${sourceInvoice.itemCount}, encontrado ${targetInvoice.itemCount}`,
            },
            'medium',
            now,
          ),
        );
      }

      // Comparar ítems individuales: detectar ítems faltantes en target
      const targetItemIds = new Set(
        targetInvoice.items.map((item) => item.itemId),
      );
      for (const sourceItem of sourceInvoice.items) {
        if (!targetItemIds.has(sourceItem.itemId)) {
          discrepancies.push(
            this.createDiscrepancy(
              sourceData.stage,
              targetData.stage,
              sourceInvoice.invoice,
              'missing_item',
              {
                itemId: sourceItem.itemId,
                expectedValue: sourceItem.itemId,
                message: `Ítem ${sourceItem.itemId} presente en ${sourceData.stage} pero ausente en ${targetData.stage} para factura ${sourceInvoice.invoice}`,
              },
              'high',
              now,
            ),
          );
        }
      }
    }

    // Calcular total de facturas comparadas (unión de ambas etapas)
    const allInvoiceIds = new Set<string>();
    for (const inv of sourceData.invoices) allInvoiceIds.add(inv.invoice);
    for (const inv of targetData.invoices) allInvoiceIds.add(inv.invoice);

    const summary = this.buildSummary(discrepancies);

    return {
      sourceStage: sourceData.stage,
      targetStage: targetData.stage,
      totalInvoicesCompared: allInvoiceIds.size,
      discrepancies,
      summary,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Persistencia en DynamoDB                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Guardar un arreglo de discrepancias en la tabla Discrepancies de DynamoDB.
   *
   * Cada discrepancia se persiste con un sessionId generado para agrupar
   * las discrepancias de una misma ejecución de comparación.
   */
  async saveDiscrepancies(
    discrepancies: Discrepancy[],
    sessionId?: string,
  ): Promise<void> {
    const sid = sessionId ?? crypto.randomUUID();

    for (const disc of discrepancies) {
      try {
        await client.models.Discrepancy.create({
          sessionId: sid,
          discrepancyId: disc.discrepancyId,
          invoice: disc.invoice,
          type: disc.type,
          sourceStage: disc.sourceStage,
          targetStage: disc.targetStage,
          expectedValue: disc.details.expectedValue,
          actualValue: disc.details.actualValue,
          detectedAt: disc.detectedAt,
          details: disc.details,
        });
      } catch (error) {
        console.error(
          `Error al guardar discrepancia ${disc.discrepancyId}:`,
          error,
        );
      }
    }
  }

  /**
   * Consultar discrepancias por número de factura usando el GSI invoice-index.
   */
  async getDiscrepanciesByInvoice(
    invoice: string,
  ): Promise<Discrepancy[]> {
    try {
      const { data } = await client.models.Discrepancy.listDiscrepancyByInvoiceAndDetectedAt(
        { invoice },
      );

      return (data ?? []).map((item) => {
        const details: DiscrepancyDetails = item.details
          ? (item.details as unknown as DiscrepancyDetails)
          : { message: '' };

        return {
          discrepancyId: item.discrepancyId,
          sourceStage: item.sourceStage as Discrepancy['sourceStage'],
          targetStage: item.targetStage as Discrepancy['targetStage'],
          invoice: item.invoice,
          type: item.type as DiscrepancyType,
          details,
          severity: this.inferSeverity(item.type as DiscrepancyType),
          detectedAt: item.detectedAt,
        };
      });
    } catch (error) {
      console.error(
        `Error al consultar discrepancias para factura ${invoice}:`,
        error,
      );
      return [];
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers internos                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Crear un objeto Discrepancy con un ID único.
   */
  private createDiscrepancy(
    sourceStage: Discrepancy['sourceStage'],
    targetStage: Discrepancy['targetStage'],
    invoice: string,
    type: DiscrepancyType,
    details: DiscrepancyDetails,
    severity: DiscrepancySeverity,
    detectedAt: string,
  ): Discrepancy {
    return {
      discrepancyId: crypto.randomUUID(),
      sourceStage,
      targetStage,
      invoice,
      type,
      details,
      severity,
      detectedAt,
    };
  }

  /**
   * Determinar severidad para diferencia de total basada en el porcentaje
   * de desviación respecto al valor esperado.
   */
  private determineSeverityForTotalDiff(
    expected: number,
    actual: number,
  ): DiscrepancySeverity {
    if (expected === 0) return 'high';
    const pctDiff = Math.abs(expected - actual) / Math.abs(expected);
    if (pctDiff > 0.2) return 'critical';
    if (pctDiff > 0.1) return 'high';
    if (pctDiff > 0.05) return 'medium';
    return 'low';
  }

  /**
   * Inferir severidad a partir del tipo de discrepancia (para datos leídos de DynamoDB).
   */
  private inferSeverity(type: DiscrepancyType): DiscrepancySeverity {
    switch (type) {
      case 'missing_invoice':
        return 'high';
      case 'total_difference':
        return 'medium';
      case 'item_count_difference':
        return 'medium';
      case 'missing_item':
        return 'high';
      default:
        return 'medium';
    }
  }

  /**
   * Construir resumen de conteos por tipo de discrepancia.
   */
  private buildSummary(discrepancies: Discrepancy[]): ComparisonSummary {
    return {
      missingInvoices: discrepancies.filter((d) => d.type === 'missing_invoice').length,
      totalDifferences: discrepancies.filter((d) => d.type === 'total_difference').length,
      itemCountDifferences: discrepancies.filter((d) => d.type === 'item_count_difference').length,
      missingItems: discrepancies.filter((d) => d.type === 'missing_item').length,
    };
  }
}

/** Instancia singleton por defecto. */
export const comparisonService = ComparisonService.getInstance();
