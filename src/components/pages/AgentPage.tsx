/**
 * AgentPage — Página del agente conversacional.
 *
 * Interfaz de chat que permite al usuario hacer consultas en lenguaje
 * natural sobre datos de reconciliación. Muestra historial de mensajes,
 * indicador de carga y datos estructurados cuando están disponibles.
 *
 * Requisitos: 8.1, 11.4
 */
import { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  IconButton,
  Paper,
  CircularProgress,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Card,
  CardContent,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PersonIcon from '@mui/icons-material/Person';
import { ConversationalAgentService } from '../../services/conversational-agent';
import type { ConversationMessage } from '../../types/conversational';
import type { Discrepancy } from '../../types/comparison';
import type { Finding } from '../../types/ai-analysis';

/** Etiquetas legibles para tipos de discrepancia. */
const DISCREPANCY_TYPE_LABELS: Record<string, string> = {
  missing_invoice: 'Factura perdida',
  total_difference: 'Diferencia de total',
  item_count_difference: 'Diferencia de ítems',
  missing_item: 'Ítem perdido',
};

/** Etiquetas legibles para etapas. */
const STAGE_LABELS: Record<string, string> = {
  geopos_local: 'Geopos Local',
  geopos_central: 'Geopos Central',
  integracion: 'Integración',
  ps_ck_intfc_vtapos: 'PS CK',
};

export default function AgentPage() {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const serviceRef = useRef(ConversationalAgentService.getInstance());

  // Cargar historial existente al montar
  useEffect(() => {
    const history = serviceRef.current.getConversationHistory();
    if (history.length > 0) {
      setMessages(history);
    }
  }, []);

  // Auto-scroll al último mensaje
  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  /** Enviar consulta al agente conversacional. */
  const handleSend = async () => {
    const query = input.trim();
    if (!query || loading) return;

    setInput('');
    setLoading(true);

    try {
      await serviceRef.current.processQuery(query);
      // Actualizar mensajes desde el historial del servicio
      setMessages(serviceRef.current.getConversationHistory());
    } catch {
      // Agregar mensaje de error como respuesta del asistente
      setMessages((prev) => [
        ...prev,
        {
          role: 'user' as const,
          content: query,
          timestamp: new Date().toISOString(),
        },
        {
          role: 'assistant' as const,
          content: 'Ocurrió un error al procesar tu consulta. Por favor intenta de nuevo.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  /** Manejar envío con Enter. */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }} role="region" aria-label="Agente conversacional">
      <Typography variant="h4" component="h1" gutterBottom>
        Agente Conversacional
      </Typography>

      {/* Área de mensajes */}
      <Paper
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
          mb: 2,
          bgcolor: 'background.default',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
        role="log"
        aria-label="Historial de conversación"
      >
        {messages.length === 0 && !loading && (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <SmartToyIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
            <Typography color="text.secondary">
              Escribe una consulta para comenzar. Puedo ayudarte con facturas,
              discrepancias, hallazgos y más.
            </Typography>
          </Box>
        )}

        {messages.map((msg, index) => (
          <MessageBubble key={index} message={msg} />
        ))}

        {loading && (
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
            role="status"
            aria-label="Procesando consulta"
          >
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              Procesando consulta…
            </Typography>
          </Box>
        )}

        <div ref={messagesEndRef} />
      </Paper>

      {/* Input de texto */}
      <Paper sx={{ p: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          fullWidth
          placeholder="Escribe tu consulta aquí…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          size="small"
          aria-label="Consulta al agente"
          slotProps={{
            input: {
              sx: { borderRadius: 2 },
            },
          }}
        />
        <IconButton
          onClick={handleSend}
          disabled={!input.trim() || loading}
          color="primary"
          aria-label="Enviar consulta"
        >
          <SendIcon />
        </IconButton>
      </Paper>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Burbuja de mensaje                                                */
/* ------------------------------------------------------------------ */

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user';

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        gap: 1,
      }}
    >
      {!isUser && (
        <SmartToyIcon sx={{ color: 'primary.main', mt: 0.5 }} />
      )}
      <Box sx={{ maxWidth: '75%' }}>
        <Paper
          elevation={1}
          sx={{
            p: 1.5,
            bgcolor: isUser ? 'primary.main' : 'background.paper',
            color: isUser ? 'primary.contrastText' : 'text.primary',
            borderRadius: 2,
          }}
        >
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {message.content}
          </Typography>
        </Paper>

        {/* Datos estructurados del asistente */}
        {!isUser && message.data && (
          <StructuredData data={message.data} />
        )}

        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ mt: 0.5, display: 'block', textAlign: isUser ? 'right' : 'left' }}
        >
          {formatTimestamp(message.timestamp)}
        </Typography>
      </Box>
      {isUser && (
        <PersonIcon sx={{ color: 'text.secondary', mt: 0.5 }} />
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Datos estructurados                                               */
/* ------------------------------------------------------------------ */

function StructuredData({ data }: { data: unknown }) {
  const d = data as Record<string, unknown>;

  // Discrepancias
  if (d.discrepancies && Array.isArray(d.discrepancies) && d.discrepancies.length > 0) {
    return <DiscrepanciesTable discrepancies={d.discrepancies as Discrepancy[]} />;
  }

  // Ítems perdidos
  if (d.missingItems && Array.isArray(d.missingItems) && d.missingItems.length > 0) {
    return <DiscrepanciesTable discrepancies={d.missingItems as Discrepancy[]} />;
  }

  // Hallazgos
  if (d.findings && Array.isArray(d.findings) && d.findings.length > 0) {
    return <FindingsCards findings={d.findings as Finding[]} />;
  }

  // Resultados de calidad
  if (d.qualityResults && typeof d.qualityResults === 'object') {
    return <QualityResultsCard data={d.qualityResults as Record<string, unknown>} />;
  }

  return null;
}

/** Tabla de discrepancias. */
function DiscrepanciesTable({ discrepancies }: { discrepancies: Discrepancy[] }) {
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
      <Table size="small" aria-label="Discrepancias encontradas">
        <TableHead>
          <TableRow>
            <TableCell>Factura</TableCell>
            <TableCell>Tipo</TableCell>
            <TableCell>Origen</TableCell>
            <TableCell>Destino</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {discrepancies.map((disc) => (
            <TableRow key={disc.discrepancyId}>
              <TableCell>{disc.invoice}</TableCell>
              <TableCell>
                <Chip
                  label={DISCREPANCY_TYPE_LABELS[disc.type] ?? disc.type}
                  size="small"
                  color={disc.type === 'missing_invoice' || disc.type === 'missing_item' ? 'error' : 'warning'}
                />
              </TableCell>
              <TableCell>{STAGE_LABELS[disc.sourceStage] ?? disc.sourceStage}</TableCell>
              <TableCell>{STAGE_LABELS[disc.targetStage] ?? disc.targetStage}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** Tarjetas de hallazgos. */
function FindingsCards({ findings }: { findings: Finding[] }) {
  return (
    <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {findings.map((finding, idx) => (
        <Card key={idx} variant="outlined">
          <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
            <Typography variant="subtitle2" color="primary.main">
              Hallazgo {idx + 1}
            </Typography>
            <Typography variant="body2">{finding.explanation}</Typography>
            <Typography variant="body2" color="text.secondary">
              Causa: {finding.probableCause}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Recomendación: {finding.recommendation}
            </Typography>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

/** Tarjeta de resultados de calidad. */
function QualityResultsCard({ data }: { data: Record<string, unknown> }) {
  const totalRules = (data.totalRules as number) ?? 0;
  const passed = (data.passed as number) ?? 0;
  const failed = (data.failed as number) ?? 0;

  return (
    <Card variant="outlined" sx={{ mt: 1 }}>
      <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
        <Typography variant="subtitle2" color="primary.main">
          Resultados de Calidad
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
          <Chip label={`Total: ${totalRules}`} size="small" />
          <Chip label={`Pasaron: ${passed}`} size="small" color="success" />
          <Chip label={`Fallaron: ${failed}`} size="small" color="error" />
        </Box>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Utilidades                                                        */
/* ------------------------------------------------------------------ */

/** Formatear timestamp ISO a hora legible. */
function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
