/**
 * AIAnalysisService — motor de IA para análisis de discrepancias
 * usando Amazon Bedrock.
 *
 * Funcionalidades:
 *  - analyzeDiscrepancy: analiza una discrepancia y genera un Finding
 *    con explicación, causa probable y recomendación
 *  - detectAnomalies: detecta patrones anómalos en un conjunto de
 *    discrepancias y genera alertas con severidad
 *  - saveFinding: persiste hallazgos en la tabla Findings de DynamoDB
 *  - getFindings: consulta hallazgos por discrepancyId
 *
 * Implementa reintentos con backoff exponencial para timeouts de Bedrock.
 * Usa Amplify Data (generateClient) para operaciones DynamoDB.
 */

import { generateClient } from 'aws-amplify/data';

import type { Schema } from '../../amplify/data/resource';
import type { Discrepancy, DiscrepancySeverity } from '../types/comparison';
import type {
  Finding,
  ItemFinding,
  AnomalyAlert,
  AnalysisContext,
} from '../types/ai-analysis';

/** Cliente Amplify Data tipado con nuestro esquema. */
const client = generateClient<Schema>();

/** Configuración de reintentos con backoff exponencial. */
interface RetryConfig {
  /** Número máximo de reintentos. */
  maxRetries: number;
  /** Delay base en milisegundos. */
  baseDelayMs: number;
  /** Factor multiplicador para backoff exponencial. */
  backoffFactor: number;
}

/** Configuración por defecto de reintentos. */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  backoffFactor: 2,
};

export class AIAnalysisService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: AIAnalysisService;
  private retryConfig: RetryConfig;

  protected constructor(retryConfig?: Partial<RetryConfig>) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  static getInstance(): AIAnalysisService {
    if (!AIAnalysisService.instance) {
      AIAnalysisService.instance = new AIAnalysisService();
    }
    return AIAnalysisService.instance;
  }

  /** Crear instancia independiente para tests (sin singleton). */
  static createForTesting(retryConfig?: Partial<RetryConfig>): AIAnalysisService {
    return new AIAnalysisService(retryConfig);
  }

  /* ------------------------------------------------------------------ */
  /*  Análisis de discrepancia con Bedrock                              */
  /* ------------------------------------------------------------------ */

  /**
   * Analizar una discrepancia usando Amazon Bedrock.
   *
   * Envía la discrepancia con contexto al modelo, obtiene explicación,
   * causa probable y recomendación. Genera ItemFindings cuando la
   * discrepancia involucra múltiples ítems.
   */
  async analyzeDiscrepancy(
    discrepancy: Discrepancy,
    context?: AnalysisContext,
  ): Promise<Finding> {
    const prompt = this.buildAnalysisPrompt(discrepancy, context);
    const bedrockResponse = await this.invokeBedrockWithRetry(prompt);
    const now = new Date().toISOString();

    // Generar hallazgos a nivel de ítem cuando aplique
    const itemFindings = this.generateItemFindings(discrepancy, bedrockResponse);

    const finding: Finding = {
      findingId: crypto.randomUUID(),
      discrepancyId: discrepancy.discrepancyId,
      explanation: bedrockResponse.explanation,
      probableCause: bedrockResponse.probableCause,
      recommendation: bedrockResponse.recommendation,
      severity: discrepancy.severity,
      itemFindings,
      createdAt: now,
    };

    return finding;
  }

  /* ------------------------------------------------------------------ */
  /*  Detección de anomalías                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Detectar patrones anómalos en un conjunto de discrepancias.
   *
   * Analiza agrupaciones por tipo, factura y etapa para identificar
   * patrones recurrentes que requieran atención especial.
   */
  async detectAnomalies(discrepancies: Discrepancy[]): Promise<AnomalyAlert[]> {
    if (discrepancies.length === 0) return [];

    const alerts: AnomalyAlert[] = [];
    const now = new Date().toISOString();

    // Patrón 1: Facturas con múltiples tipos de discrepancia
    const invoiceDiscrepancies = this.groupByInvoice(discrepancies);
    for (const [invoice, discs] of invoiceDiscrepancies.entries()) {
      const uniqueTypes = new Set(discs.map((d) => d.type));
      if (uniqueTypes.size >= 3) {
        alerts.push({
          alertId: crypto.randomUUID(),
          pattern: 'multiple_discrepancy_types',
          severity: 'critical',
          affectedInvoices: [invoice],
          message: `Factura ${invoice} presenta ${uniqueTypes.size} tipos distintos de discrepancia, lo que sugiere un problema sistémico.`,
          detectedAt: now,
        });
      }
    }

    // Patrón 2: Alta concentración de discrepancias del mismo tipo
    const typeGroups = this.groupByType(discrepancies);
    for (const [type, discs] of typeGroups.entries()) {
      const threshold = Math.max(3, Math.ceil(discrepancies.length * 0.5));
      if (discs.length >= threshold) {
        const affectedInvoices = [...new Set(discs.map((d) => d.invoice))];
        alerts.push({
          alertId: crypto.randomUUID(),
          pattern: 'high_concentration',
          severity: 'high',
          affectedInvoices,
          message: `Se detectaron ${discs.length} discrepancias de tipo "${type}", afectando ${affectedInvoices.length} facturas.`,
          detectedAt: now,
        });
      }
    }

    // Patrón 3: Discrepancias críticas repetidas en la misma etapa
    const stageGroups = this.groupByStageAndSeverity(discrepancies, 'critical');
    for (const [stagePair, discs] of stageGroups.entries()) {
      if (discs.length >= 2) {
        const affectedInvoices = [...new Set(discs.map((d) => d.invoice))];
        alerts.push({
          alertId: crypto.randomUUID(),
          pattern: 'critical_stage_pattern',
          severity: 'critical',
          affectedInvoices,
          message: `Se detectaron ${discs.length} discrepancias críticas en la transición ${stagePair}.`,
          detectedAt: now,
        });
      }
    }

    return alerts;
  }

  /* ------------------------------------------------------------------ */
  /*  Persistencia en DynamoDB                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Guardar un hallazgo en la tabla Findings de DynamoDB.
   */
  async saveFinding(finding: Finding): Promise<void> {
    try {
      await client.models.Finding.create({
        discrepancyId: finding.discrepancyId,
        findingId: finding.findingId,
        explanation: finding.explanation,
        probableCause: finding.probableCause,
        recommendation: finding.recommendation,
        severity: finding.severity as 'low' | 'medium' | 'high' | 'critical',
        itemDetails: finding.itemFindings,
        analyzedAt: finding.createdAt,
      });
    } catch (error) {
      console.error(
        `Error al guardar hallazgo ${finding.findingId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Consultar hallazgos por discrepancyId.
   */
  async getFindings(discrepancyId: string): Promise<Finding[]> {
    try {
      const { data } = await client.models.Finding.list({
        discrepancyId,
      });

      return (data ?? []).map((item) => {
        const itemFindings: ItemFinding[] = item.itemDetails
          ? JSON.parse(item.itemDetails as string)
          : [];

        return {
          findingId: item.findingId,
          discrepancyId: item.discrepancyId,
          explanation: item.explanation,
          probableCause: item.probableCause,
          recommendation: item.recommendation,
          severity: item.severity as DiscrepancySeverity,
          itemFindings,
          createdAt: item.analyzedAt,
        };
      });
    } catch (error) {
      console.error(
        `Error al consultar hallazgos para discrepancia ${discrepancyId}:`,
        error,
      );
      return [];
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Invocación a Bedrock con reintentos                               */
  /* ------------------------------------------------------------------ */

  /**
   * Invocar Amazon Bedrock con reintentos y backoff exponencial.
   *
   * En caso de timeout o error transitorio, reintenta hasta maxRetries
   * veces con delay exponencial.
   */
  async invokeBedrockWithRetry(
    prompt: string,
  ): Promise<BedrockAnalysisResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await this.invokeBedrock(prompt);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // No reintentar si no es un error transitorio
        if (!this.isRetryableError(lastError)) {
          throw lastError;
        }

        // Si ya agotamos los reintentos, lanzar el último error
        if (attempt === this.retryConfig.maxRetries) {
          break;
        }

        // Esperar con backoff exponencial antes del siguiente intento
        const delay =
          this.retryConfig.baseDelayMs *
          Math.pow(this.retryConfig.backoffFactor, attempt);
        await this.sleep(delay);
      }
    }

    throw lastError ?? new Error('Error desconocido al invocar Bedrock');
  }

  /**
   * Placeholder para invocación real a Amazon Bedrock.
   *
   * En producción, esto usará el SDK de AWS para invocar el modelo
   * Claude/Titan vía Bedrock Runtime. Por ahora retorna una respuesta
   * simulada basada en el prompt.
   */
  protected async invokeBedrock(
    _prompt: string,
  ): Promise<BedrockAnalysisResponse> {
    // Placeholder: simular respuesta de Bedrock
    return {
      explanation:
        'Análisis generado por IA: se detectó una inconsistencia en los datos entre las etapas de la cascada de reconciliación.',
      probableCause:
        'La causa más probable es un error en la sincronización de datos entre los sistemas origen y destino.',
      recommendation:
        'Se recomienda verificar los registros de sincronización y validar los datos en el sistema origen.',
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers internos                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Construir el prompt de análisis para Bedrock.
   */
  private buildAnalysisPrompt(
    discrepancy: Discrepancy,
    context?: AnalysisContext,
  ): string {
    let prompt = `Analiza la siguiente discrepancia detectada en el proceso de reconciliación de datos:\n\n`;
    prompt += `Tipo: ${discrepancy.type}\n`;
    prompt += `Factura: ${discrepancy.invoice}\n`;
    prompt += `Etapa origen: ${discrepancy.sourceStage}\n`;
    prompt += `Etapa destino: ${discrepancy.targetStage}\n`;
    prompt += `Severidad: ${discrepancy.severity}\n`;
    prompt += `Detalle: ${discrepancy.details.message}\n`;

    if (discrepancy.details.expectedValue) {
      prompt += `Valor esperado: ${discrepancy.details.expectedValue}\n`;
    }
    if (discrepancy.details.actualValue) {
      prompt += `Valor encontrado: ${discrepancy.details.actualValue}\n`;
    }
    if (discrepancy.details.itemId) {
      prompt += `Ítem afectado: ${discrepancy.details.itemId}\n`;
    }

    if (context) {
      prompt += `\nContexto adicional:\n`;
      if (context.previousDiscrepancies !== undefined) {
        prompt += `Discrepancias previas para esta factura: ${context.previousDiscrepancies}\n`;
      }
      if (context.sourceFileName) {
        prompt += `Archivo fuente: ${context.sourceFileName}\n`;
      }
      if (context.additionalInfo) {
        prompt += `Info adicional: ${context.additionalInfo}\n`;
      }
    }

    prompt += `\nProporciona:\n1. Explicación clara de la discrepancia\n2. Causa probable\n3. Recomendación de acción correctiva`;

    return prompt;
  }

  /**
   * Generar hallazgos a nivel de ítem cuando la discrepancia involucra
   * múltiples ítems (missing_item o item_count_difference).
   */
  private generateItemFindings(
    discrepancy: Discrepancy,
    _bedrockResponse: BedrockAnalysisResponse,
  ): ItemFinding[] {
    // Solo generar ItemFindings para discrepancias que involucran ítems
    if (
      discrepancy.type !== 'missing_item' &&
      discrepancy.type !== 'item_count_difference'
    ) {
      return [];
    }

    const itemFindings: ItemFinding[] = [];

    if (discrepancy.type === 'missing_item' && discrepancy.details.itemId) {
      itemFindings.push({
        itemId: discrepancy.details.itemId,
        explanation: `Ítem ${discrepancy.details.itemId} presente en ${discrepancy.sourceStage} pero ausente en ${discrepancy.targetStage}.`,
        suggestedAction: `Verificar si el ítem ${discrepancy.details.itemId} fue excluido intencionalmente o si se trata de un error de sincronización.`,
      });
    }

    if (discrepancy.type === 'item_count_difference') {
      itemFindings.push({
        itemId: 'aggregate',
        explanation: `La cantidad de ítems difiere entre ${discrepancy.sourceStage} (${discrepancy.details.expectedValue}) y ${discrepancy.targetStage} (${discrepancy.details.actualValue}).`,
        suggestedAction: `Comparar la lista de ítems entre ambas etapas para identificar los ítems faltantes o adicionales.`,
      });
    }

    return itemFindings;
  }

  /**
   * Agrupar discrepancias por número de factura.
   */
  private groupByInvoice(
    discrepancies: Discrepancy[],
  ): Map<string, Discrepancy[]> {
    const map = new Map<string, Discrepancy[]>();
    for (const d of discrepancies) {
      const existing = map.get(d.invoice) ?? [];
      existing.push(d);
      map.set(d.invoice, existing);
    }
    return map;
  }

  /**
   * Agrupar discrepancias por tipo.
   */
  private groupByType(
    discrepancies: Discrepancy[],
  ): Map<string, Discrepancy[]> {
    const map = new Map<string, Discrepancy[]>();
    for (const d of discrepancies) {
      const existing = map.get(d.type) ?? [];
      existing.push(d);
      map.set(d.type, existing);
    }
    return map;
  }

  /**
   * Agrupar discrepancias por par de etapas filtrando por severidad.
   */
  private groupByStageAndSeverity(
    discrepancies: Discrepancy[],
    severity: DiscrepancySeverity,
  ): Map<string, Discrepancy[]> {
    const map = new Map<string, Discrepancy[]>();
    for (const d of discrepancies) {
      if (d.severity !== severity) continue;
      const key = `${d.sourceStage} → ${d.targetStage}`;
      const existing = map.get(key) ?? [];
      existing.push(d);
      map.set(key, existing);
    }
    return map;
  }

  /**
   * Determinar si un error es transitorio y se puede reintentar.
   */
  private isRetryableError(error: Error): boolean {
    const retryableMessages = [
      'timeout',
      'throttl',
      'too many requests',
      'service unavailable',
      'internal server error',
      'ECONNRESET',
      'ETIMEDOUT',
    ];
    const msg = error.message.toLowerCase();
    return retryableMessages.some((keyword) => msg.includes(keyword));
  }

  /**
   * Esperar un tiempo determinado (para backoff exponencial).
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Respuesta parseada del modelo de Bedrock. */
export interface BedrockAnalysisResponse {
  /** Explicación de la discrepancia. */
  explanation: string;
  /** Causa probable. */
  probableCause: string;
  /** Recomendación de acción. */
  recommendation: string;
}

/** Instancia singleton por defecto. */
export const aiAnalysisService = AIAnalysisService.getInstance();
