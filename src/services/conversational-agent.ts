/**
 * ConversationalAgentService — agente conversacional para consultas
 * en lenguaje natural sobre datos de reconciliación.
 *
 * Funcionalidades:
 *  - processQuery: clasifica la intención, consulta datos relevantes
 *    y genera una respuesta usando Amazon Bedrock (placeholder)
 *  - getConversationHistory: retorna el historial de mensajes
 *
 * Intenciones soportadas:
 *  - invoice_search: búsqueda de facturas por número
 *  - discrepancy_query: discrepancias entre etapas para una factura
 *  - item_tracking: etapa donde se perdió un ítem
 *  - incident_summary: resumen de incidentes por período
 *  - finding_explanation: explicación de hallazgos de IA
 *  - quality_query: reglas de calidad fallidas por archivo/dataset
 *  - general: consultas generales
 *
 * Requisitos: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import type {
  QueryIntent,
  ConversationMessage,
  QueryResult,
} from '../types/conversational';
import type { Discrepancy } from '../types/comparison';
import type { Finding } from '../types/ai-analysis';
import type { ReconciliationSummary, QualityResultsSummary } from '../types/dashboard';

import { ComparisonService } from './comparison';
import { AIAnalysisService } from './ai-analysis';
import { DashboardService } from './dashboard';

export class ConversationalAgentService {
  /* ------------------------------------------------------------------ */
  /*  Singleton                                                         */
  /* ------------------------------------------------------------------ */
  private static instance: ConversationalAgentService;

  /** Historial de conversación en memoria. */
  private conversationHistory: ConversationMessage[] = [];

  /** Servicios inyectados para consultas de datos. */
  private comparisonService: ComparisonService;
  private aiAnalysisService: AIAnalysisService;
  private dashboardService: DashboardService;

  constructor(
    comparisonService?: ComparisonService,
    aiAnalysisService?: AIAnalysisService,
    dashboardService?: DashboardService,
  ) {
    this.comparisonService = comparisonService ?? ComparisonService.getInstance();
    this.aiAnalysisService = aiAnalysisService ?? AIAnalysisService.getInstance();
    this.dashboardService = dashboardService ?? DashboardService.getInstance();
  }

  static getInstance(): ConversationalAgentService {
    if (!ConversationalAgentService.instance) {
      ConversationalAgentService.instance = new ConversationalAgentService();
    }
    return ConversationalAgentService.instance;
  }

  /** Crear instancia independiente para tests (sin singleton). */
  static createForTesting(
    comparisonService?: ComparisonService,
    aiAnalysisService?: AIAnalysisService,
    dashboardService?: DashboardService,
  ): ConversationalAgentService {
    return new ConversationalAgentService(
      comparisonService,
      aiAnalysisService,
      dashboardService,
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Procesamiento de consultas                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Procesar una consulta en lenguaje natural.
   *
   * 1. Clasifica la intención de la consulta por palabras clave.
   * 2. Consulta los datos relevantes según la intención.
   * 3. Genera una respuesta en lenguaje natural (placeholder Bedrock).
   * 4. Almacena el mensaje del usuario y la respuesta en el historial.
   */
  async processQuery(query: string): Promise<QueryResult> {
    const now = new Date().toISOString();

    // Registrar mensaje del usuario en el historial
    this.conversationHistory.push({
      role: 'user',
      content: query,
      timestamp: now,
    });

    // Clasificar intención
    const intent = this.classifyIntent(query);

    // Obtener datos relevantes según la intención
    let result: QueryResult;

    switch (intent) {
      case 'invoice_search':
        result = await this.handleInvoiceSearch(query, intent);
        break;
      case 'discrepancy_query':
        result = await this.handleDiscrepancyQuery(query, intent);
        break;
      case 'item_tracking':
        result = await this.handleItemTracking(query, intent);
        break;
      case 'incident_summary':
        result = await this.handleIncidentSummary(intent);
        break;
      case 'finding_explanation':
        result = await this.handleFindingExplanation(query, intent);
        break;
      case 'quality_query':
        result = await this.handleQualityQuery(intent);
        break;
      default:
        result = await this.handleGeneralQuery(query, intent);
        break;
    }

    // Registrar respuesta del asistente en el historial
    this.conversationHistory.push({
      role: 'assistant',
      content: result.response,
      timestamp: new Date().toISOString(),
      data: result.data,
    });

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Historial de conversación                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Obtener el historial completo de la conversación.
   */
  getConversationHistory(): ConversationMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Limpiar el historial de conversación.
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /* ------------------------------------------------------------------ */
  /*  Clasificación de intención por palabras clave                     */
  /* ------------------------------------------------------------------ */

  /**
   * Clasificar la intención de la consulta basándose en palabras clave.
   *
   * Analiza el texto normalizado (minúsculas, sin acentos) para
   * determinar qué tipo de consulta está realizando el usuario.
   */
  classifyIntent(query: string): QueryIntent {
    const normalized = this.normalizeText(query);

    // Rastreo de ítem perdido (antes de invoice_search porque puede contener "factura")
    if (this.matchesItemTracking(normalized)) {
      return 'item_tracking';
    }

    // Explicación de hallazgos (antes de discrepancy_query porque puede contener "discrepancia")
    if (this.matchesFindingExplanation(normalized)) {
      return 'finding_explanation';
    }

    // Consulta de discrepancias entre etapas (antes de invoice_search)
    if (this.matchesDiscrepancyQuery(normalized)) {
      return 'discrepancy_query';
    }

    // Resumen de incidentes por período
    if (this.matchesIncidentSummary(normalized)) {
      return 'incident_summary';
    }

    // Reglas de calidad fallidas
    if (this.matchesQualityQuery(normalized)) {
      return 'quality_query';
    }

    // Búsqueda de factura por número (más genérica, al final)
    if (this.matchesInvoiceSearch(normalized)) {
      return 'invoice_search';
    }

    return 'general';
  }

  /* ------------------------------------------------------------------ */
  /*  Matchers de intención                                             */
  /* ------------------------------------------------------------------ */

  /** Detectar búsqueda de factura por número. */
  private matchesInvoiceSearch(text: string): boolean {
    const keywords = ['factura', 'invoice', 'buscar factura', 'busca factura', 'numero de factura'];
    // También detectar patrones como "INV-123" o "factura 123"
    const invoicePattern = /\b(inv[-_]?\d+|\d{3,})\b/i;
    return keywords.some((kw) => text.includes(kw)) || invoicePattern.test(text);
  }

  /** Detectar consulta de discrepancias entre etapas. */
  private matchesDiscrepancyQuery(text: string): boolean {
    const keywords = [
      'discrepancia', 'discrepancias', 'diferencia', 'diferencias',
      'comparacion', 'comparar', 'entre etapas', 'etapa',
    ];
    return keywords.some((kw) => text.includes(kw));
  }

  /** Detectar rastreo de ítem perdido. */
  private matchesItemTracking(text: string): boolean {
    const keywords = [
      'item perdido', 'item faltante', 'donde se perdio',
      'perdio el item', 'rastrear item', 'rastreo',
      'missing item', 'lost item', 'perdido',
    ];
    return keywords.some((kw) => text.includes(kw));
  }

  /** Detectar resumen de incidentes por período. */
  private matchesIncidentSummary(text: string): boolean {
    const keywords = [
      'resumen', 'incidentes', 'periodo', 'reporte',
      'summary', 'estadisticas', 'metricas',
    ];
    // Requiere al menos 2 keywords para evitar falsos positivos
    const matchCount = keywords.filter((kw) => text.includes(kw)).length;
    return matchCount >= 2 || text.includes('resumen de incidentes') || text.includes('resumen del periodo');
  }

  /** Detectar consulta de explicación de hallazgos. */
  private matchesFindingExplanation(text: string): boolean {
    const keywords = [
      'hallazgo', 'hallazgos', 'finding', 'findings',
      'explicacion', 'explicar', 'causa', 'analisis',
      'por que', 'porque',
    ];
    return keywords.some((kw) => text.includes(kw));
  }

  /** Detectar consulta de reglas de calidad fallidas. */
  private matchesQualityQuery(text: string): boolean {
    const keywords = [
      'calidad', 'quality', 'regla', 'reglas',
      'fallida', 'fallidas', 'failed', 'validacion',
    ];
    return keywords.some((kw) => text.includes(kw));
  }

  /* ------------------------------------------------------------------ */
  /*  Handlers por intención                                            */
  /* ------------------------------------------------------------------ */

  /** Manejar búsqueda de factura por número. */
  private async handleInvoiceSearch(
    query: string,
    intent: QueryIntent,
  ): Promise<QueryResult> {
    const invoiceNumber = this.extractInvoiceNumber(query);

    if (!invoiceNumber) {
      return {
        intent,
        response: 'No pude identificar un número de factura en tu consulta. ¿Podrías indicar el número de factura que deseas buscar?',
      };
    }

    try {
      const discrepancies = await this.comparisonService.getDiscrepanciesByInvoice(invoiceNumber);

      if (discrepancies.length === 0) {
        return {
          intent,
          response: `No se encontraron discrepancias para la factura ${invoiceNumber}. La factura podría no tener problemas o no estar registrada en el sistema.`,
          data: { invoice: invoiceNumber, discrepancies: [] },
        };
      }

      const summary = this.summarizeDiscrepancies(discrepancies);
      return {
        intent,
        response: `Factura ${invoiceNumber}: se encontraron ${discrepancies.length} discrepancia(s). ${summary}`,
        data: { invoice: invoiceNumber, discrepancies },
      };
    } catch (error) {
      return {
        intent,
        response: `Error al buscar la factura ${invoiceNumber}. Por favor intenta de nuevo.`,
      };
    }
  }

  /** Manejar consulta de discrepancias entre etapas. */
  private async handleDiscrepancyQuery(
    query: string,
    intent: QueryIntent,
  ): Promise<QueryResult> {
    const invoiceNumber = this.extractInvoiceNumber(query);

    if (!invoiceNumber) {
      // Consulta general de discrepancias por etapa
      try {
        const stageDiscrepancies = await this.dashboardService.getDiscrepanciesByStage();
        const totalDisc = stageDiscrepancies.reduce((sum, s) => sum + s.count, 0);

        const stageDetails = stageDiscrepancies
          .filter((s) => s.count > 0)
          .map((s) => `${s.stagePair.source} → ${s.stagePair.target}: ${s.count}`)
          .join('; ');

        return {
          intent,
          response: `Se encontraron ${totalDisc} discrepancias en total. ${stageDetails || 'Sin discrepancias activas.'}`,
          data: { stageDiscrepancies },
        };
      } catch {
        return {
          intent,
          response: 'Error al consultar las discrepancias por etapa. Por favor intenta de nuevo.',
        };
      }
    }

    // Consulta de discrepancias para una factura específica
    try {
      const discrepancies = await this.comparisonService.getDiscrepanciesByInvoice(invoiceNumber);
      const summary = this.summarizeDiscrepancies(discrepancies);

      return {
        intent,
        response: discrepancies.length > 0
          ? `Discrepancias para factura ${invoiceNumber}: ${summary}`
          : `No se encontraron discrepancias para la factura ${invoiceNumber}.`,
        data: { invoice: invoiceNumber, discrepancies },
      };
    } catch {
      return {
        intent,
        response: `Error al consultar discrepancias para la factura ${invoiceNumber}.`,
      };
    }
  }

  /** Manejar rastreo de ítem perdido. */
  private async handleItemTracking(
    query: string,
    intent: QueryIntent,
  ): Promise<QueryResult> {
    const invoiceNumber = this.extractInvoiceNumber(query);

    if (!invoiceNumber) {
      return {
        intent,
        response: 'Para rastrear un ítem perdido necesito el número de factura. ¿Podrías indicarlo?',
      };
    }

    try {
      const discrepancies = await this.comparisonService.getDiscrepanciesByInvoice(invoiceNumber);
      const missingItems = discrepancies.filter((d) => d.type === 'missing_item');

      if (missingItems.length === 0) {
        return {
          intent,
          response: `No se encontraron ítems perdidos para la factura ${invoiceNumber}.`,
          data: { invoice: invoiceNumber, missingItems: [] },
        };
      }

      const itemDetails = missingItems.map((d) => {
        const itemId = d.details.itemId ?? 'desconocido';
        return `Ítem ${itemId} se perdió entre ${d.sourceStage} y ${d.targetStage}`;
      }).join('. ');

      return {
        intent,
        response: `Factura ${invoiceNumber}: se encontraron ${missingItems.length} ítem(s) perdido(s). ${itemDetails}.`,
        data: { invoice: invoiceNumber, missingItems },
      };
    } catch {
      return {
        intent,
        response: `Error al rastrear ítems para la factura ${invoiceNumber}.`,
      };
    }
  }

  /** Manejar resumen de incidentes por período. */
  private async handleIncidentSummary(
    intent: QueryIntent,
  ): Promise<QueryResult> {
    try {
      const summary: ReconciliationSummary = await this.dashboardService.getReconciliationSummary(0);

      const typeBreakdown = Object.entries(summary.countByType)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => `${type}: ${count}`)
        .join(', ');

      return {
        intent,
        response: `Resumen de incidentes: ${summary.invoicesWithDiscrepancies} factura(s) con discrepancias. Desglose por tipo: ${typeBreakdown || 'sin discrepancias registradas'}.`,
        data: { summary },
      };
    } catch {
      return {
        intent,
        response: 'Error al generar el resumen de incidentes. Por favor intenta de nuevo.',
      };
    }
  }

  /** Manejar consulta de explicación de hallazgos. */
  private async handleFindingExplanation(
    query: string,
    intent: QueryIntent,
  ): Promise<QueryResult> {
    // Intentar extraer un ID de discrepancia de la consulta
    const discrepancyId = this.extractDiscrepancyId(query);

    if (!discrepancyId) {
      // Intentar buscar por factura
      const invoiceNumber = this.extractInvoiceNumber(query);
      if (invoiceNumber) {
        try {
          const discrepancies = await this.comparisonService.getDiscrepanciesByInvoice(invoiceNumber);
          if (discrepancies.length === 0) {
            return {
              intent,
              response: `No se encontraron discrepancias para la factura ${invoiceNumber}, por lo tanto no hay hallazgos disponibles.`,
            };
          }

          // Buscar hallazgos para la primera discrepancia
          const findings = await this.aiAnalysisService.getFindings(discrepancies[0].discrepancyId);
          return this.formatFindingsResponse(intent, findings, invoiceNumber);
        } catch {
          return {
            intent,
            response: `Error al consultar hallazgos para la factura ${invoiceNumber}.`,
          };
        }
      }

      return {
        intent,
        response: 'Para consultar hallazgos necesito un número de factura o ID de discrepancia. ¿Podrías proporcionarlo?',
      };
    }

    try {
      const findings: Finding[] = await this.aiAnalysisService.getFindings(discrepancyId);
      return this.formatFindingsResponse(intent, findings);
    } catch {
      return {
        intent,
        response: `Error al consultar hallazgos para la discrepancia ${discrepancyId}.`,
      };
    }
  }

  /** Manejar consulta de reglas de calidad fallidas. */
  private async handleQualityQuery(
    intent: QueryIntent,
  ): Promise<QueryResult> {
    try {
      const qualityResults: QualityResultsSummary = await this.dashboardService.getQualityResults();

      if (qualityResults.failed === 0) {
        return {
          intent,
          response: `Todas las ${qualityResults.totalRules} reglas de calidad pasaron exitosamente. No hay reglas fallidas.`,
          data: { qualityResults },
        };
      }

      const datasetDetails = qualityResults.byDataset
        .filter((ds) => ds.failed > 0)
        .map((ds) => `Dataset ${ds.uploadId} (${ds.stage}): ${ds.failed} fallida(s)`)
        .join('; ');

      return {
        intent,
        response: `Resultados de calidad: ${qualityResults.failed} de ${qualityResults.totalRules} reglas fallaron. ${datasetDetails}`,
        data: { qualityResults },
      };
    } catch {
      return {
        intent,
        response: 'Error al consultar los resultados de calidad. Por favor intenta de nuevo.',
      };
    }
  }

  /** Manejar consulta general. */
  private async handleGeneralQuery(
    query: string,
    intent: QueryIntent,
  ): Promise<QueryResult> {
    // Placeholder: en producción se enviaría a Bedrock para respuesta libre
    return {
      intent,
      response: `Entiendo tu consulta: "${query}". Puedo ayudarte con: búsqueda de facturas, consulta de discrepancias entre etapas, rastreo de ítems perdidos, resumen de incidentes, explicación de hallazgos y reglas de calidad fallidas. ¿Podrías reformular tu pregunta?`,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers internos                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Normalizar texto: minúsculas y sin acentos comunes.
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Extraer número de factura de la consulta.
   * Soporta formatos: INV-123, INV_123, FAC-123, o números de 3+ dígitos.
   */
  extractInvoiceNumber(query: string): string | null {
    // Patrón para formatos tipo INV-123, FAC-456, etc.
    const invoicePattern = /\b((?:inv|fac|fact)[-_]?\d+)\b/i;
    const match = query.match(invoicePattern);
    if (match) return match[1].toUpperCase();

    // Patrón para números de factura puros (3+ dígitos precedidos de contexto)
    const numberPattern = /(?:factura|invoice|numero|#)\s*(\d{3,})/i;
    const numMatch = query.match(numberPattern);
    if (numMatch) return numMatch[1];

    return null;
  }

  /**
   * Extraer ID de discrepancia de la consulta.
   */
  private extractDiscrepancyId(query: string): string | null {
    // Patrón para UUIDs o IDs tipo disc-XXX
    const uuidPattern = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
    const match = query.match(uuidPattern);
    if (match) return match[1];

    const discPattern = /\b(disc[-_]\w+)\b/i;
    const discMatch = query.match(discPattern);
    if (discMatch) return discMatch[1];

    return null;
  }

  /**
   * Generar resumen textual de un conjunto de discrepancias.
   */
  private summarizeDiscrepancies(discrepancies: Discrepancy[]): string {
    if (discrepancies.length === 0) return 'Sin discrepancias.';

    const byType = new Map<string, number>();
    for (const d of discrepancies) {
      byType.set(d.type, (byType.get(d.type) ?? 0) + 1);
    }

    const parts: string[] = [];
    for (const [type, count] of byType) {
      parts.push(`${type}: ${count}`);
    }

    return `Tipos: ${parts.join(', ')}.`;
  }

  /**
   * Formatear respuesta de hallazgos.
   */
  private formatFindingsResponse(
    intent: QueryIntent,
    findings: Finding[],
    invoiceNumber?: string,
  ): QueryResult {
    if (findings.length === 0) {
      const context = invoiceNumber ? ` para la factura ${invoiceNumber}` : '';
      return {
        intent,
        response: `No se encontraron hallazgos de análisis${context}. Es posible que aún no se haya ejecutado el análisis de IA.`,
        data: { findings: [] },
      };
    }

    const findingDetails = findings.map((f) =>
      `Hallazgo: ${f.explanation}. Causa probable: ${f.probableCause}. Recomendación: ${f.recommendation}`
    ).join(' | ');

    return {
      intent,
      response: `Se encontraron ${findings.length} hallazgo(s). ${findingDetails}`,
      data: { findings },
    };
  }
}

/** Instancia singleton por defecto. */
export const conversationalAgentService = ConversationalAgentService.getInstance();
