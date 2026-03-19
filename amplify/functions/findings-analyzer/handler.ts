import type { Schema } from '../../data/resource';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_BEDROCK_REGION ?? 'us-east-1',
});
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'amazon.nova-premier-v1:0';

interface DiscrepancyInput {
  discrepancyId: string;
  invoice: string;
  type: string;
  sourceStage: string;
  targetStage: string;
  expectedValue?: string;
  actualValue?: string;
}

interface FindingOutput {
  discrepancyId: string;
  explanation: string;
  probableCause: string;
  recommendation: string;
  severity: string;
}

/**
 * Handler: receives an array of discrepancies, sends them in batches
 * to Nova Premier via Bedrock Converse API, returns findings.
 */
export const handler: Schema['analyzeFindings']['functionHandler'] = async (event) => {
  const discrepancies: DiscrepancyInput[] = JSON.parse(event.arguments.discrepancies);

  if (!discrepancies || discrepancies.length === 0) {
    return JSON.stringify([]);
  }

  // Process in batches of 20 to avoid token limits
  const BATCH_SIZE = 20;
  const allFindings: FindingOutput[] = [];

  for (let i = 0; i < discrepancies.length; i += BATCH_SIZE) {
    const batch = discrepancies.slice(i, i + BATCH_SIZE);
    const findings = await analyzeBatch(batch);
    allFindings.push(...findings);
  }

  return JSON.stringify(allFindings);
};

async function analyzeBatch(discrepancies: DiscrepancyInput[]): Promise<FindingOutput[]> {
  const discList = discrepancies
    .map(
      (d, i) =>
        `${i + 1}. [${d.discrepancyId}] Factura: ${d.invoice}, Tipo: ${d.type}, ` +
        `Origen: ${d.sourceStage}, Destino: ${d.targetStage}, ` +
        `Esperado: ${d.expectedValue ?? 'N/A'}, Encontrado: ${d.actualValue ?? 'N/A'}`,
    )
    .join('\n');

  const systemPrompt =
    'Eres un analista experto en reconciliación de datos financieros para una empresa de retail. ' +
    'Analizas discrepancias entre 4 etapas de datos: Geopos Local (punto de venta), ' +
    'Geopos Central (consolidado central), Integración (sistema ERP) y PS_CK (contabilidad). ' +
    'Responde SIEMPRE en español. Sé conciso y directo.';

  const userPrompt =
    'Analiza las siguientes discrepancias y genera un hallazgo para CADA una.\n\n' +
    'Discrepancias:\n' +
    discList +
    '\n\n' +
    'Para CADA discrepancia, responde en formato JSON array con objetos que tengan:\n' +
    '- discrepancyId: el ID de la discrepancia\n' +
    '- explanation: explicación clara del problema (1-2 oraciones)\n' +
    '- probableCause: causa probable (1-2 oraciones)\n' +
    '- recommendation: acción correctiva recomendada (1-2 oraciones)\n' +
    '- severity: "low", "medium", "high" o "critical"\n\n' +
    'Responde SOLO con el JSON array, sin texto adicional ni markdown.';

  try {
    const command = new ConverseCommand({
      modelId: MODEL_ID,
      messages: [
        {
          role: 'user',
          content: [{ text: userPrompt }],
        },
      ],
      system: [{ text: systemPrompt }],
      inferenceConfig: {
        maxTokens: 4096,
        temperature: 0.2,
      },
    });

    const response = await bedrockClient.send(command);
    const responseText =
      response.output?.message?.content?.[0]?.text ?? '[]';

    // Parse the JSON response, handling potential markdown wrapping
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed: FindingOutput[] = JSON.parse(cleaned);
    return parsed;
  } catch (error) {
    console.error('Bedrock invocation error:', error);
    // Fallback: generate deterministic findings
    return discrepancies.map((d) => ({
      discrepancyId: d.discrepancyId,
      explanation: getFallbackExplanation(d),
      probableCause: getFallbackCause(d),
      recommendation: getFallbackRecommendation(d),
      severity: d.type === 'missing_invoice' ? 'high' : 'medium',
    }));
  }
}


function getFallbackExplanation(d: DiscrepancyInput): string {
  switch (d.type) {
    case 'missing_invoice':
      return `La factura ${d.invoice} está presente en ${d.sourceStage} pero no aparece en ${d.targetStage}.`;
    case 'total_difference':
      return `El total de la factura ${d.invoice} difiere: ${d.expectedValue ?? '?'} en origen vs ${d.actualValue ?? '?'} en destino.`;
    default:
      return `Discrepancia detectada en factura ${d.invoice} entre ${d.sourceStage} y ${d.targetStage}.`;
  }
}

function getFallbackCause(d: DiscrepancyInput): string {
  switch (d.type) {
    case 'missing_invoice':
      return 'Error en la transmisión de datos entre etapas o retraso en el procesamiento.';
    case 'total_difference':
      return 'Diferencia en el cálculo de impuestos, descuentos o redondeo entre sistemas.';
    default:
      return 'Causa no determinada — requiere revisión manual.';
  }
}

function getFallbackRecommendation(d: DiscrepancyInput): string {
  switch (d.type) {
    case 'missing_invoice':
      return 'Verificar el proceso de sincronización entre etapas y reprocesar la factura.';
    case 'total_difference':
      return 'Revisar las reglas de cálculo de totales en ambas etapas y corregir la diferencia.';
    default:
      return 'Revisar manualmente la discrepancia y documentar la causa raíz.';
  }
}
