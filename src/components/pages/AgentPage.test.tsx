import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentPage from './AgentPage';
import { ConversationalAgentService } from '../../services/conversational-agent';
import type { ConversationMessage, QueryResult } from '../../types/conversational';

// Mock del servicio conversacional
vi.mock('../../services/conversational-agent', () => {
  const mockInstance = {
    processQuery: vi.fn(),
    getConversationHistory: vi.fn(() => []),
    clearHistory: vi.fn(),
  };
  return {
    ConversationalAgentService: {
      getInstance: vi.fn(() => mockInstance),
    },
  };
});

function getMockService() {
  return ConversationalAgentService.getInstance() as unknown as {
    processQuery: ReturnType<typeof vi.fn>;
    getConversationHistory: ReturnType<typeof vi.fn>;
    clearHistory: ReturnType<typeof vi.fn>;
  };
}

describe('AgentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMockService().getConversationHistory.mockReturnValue([]);
  });

  it('muestra el título del agente conversacional', () => {
    render(<AgentPage />);
    expect(screen.getByText('Agente Conversacional')).toBeInTheDocument();
  });

  it('muestra mensaje de bienvenida cuando no hay mensajes', () => {
    render(<AgentPage />);
    expect(
      screen.getByText(/Escribe una consulta para comenzar/),
    ).toBeInTheDocument();
  });

  it('muestra el campo de entrada y botón de envío', () => {
    render(<AgentPage />);
    expect(screen.getByPlaceholderText('Escribe tu consulta aquí…')).toBeInTheDocument();
    expect(screen.getByLabelText('Enviar consulta')).toBeInTheDocument();
  });

  it('el botón de envío está deshabilitado cuando el input está vacío', () => {
    render(<AgentPage />);
    expect(screen.getByLabelText('Enviar consulta')).toBeDisabled();
  });

  it('envía consulta al hacer clic en el botón de envío', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const mockResult: QueryResult = {
      intent: 'general',
      response: 'Respuesta de prueba',
    };
    const mockMessages: ConversationMessage[] = [
      { role: 'user', content: 'Hola', timestamp: '2024-01-15T10:00:00Z' },
      { role: 'assistant', content: 'Respuesta de prueba', timestamp: '2024-01-15T10:00:01Z' },
    ];

    const service = getMockService();
    service.processQuery.mockResolvedValue(mockResult);
    service.getConversationHistory
      .mockReturnValueOnce([])
      .mockReturnValue(mockMessages);

    render(<AgentPage />);

    const input = screen.getByPlaceholderText('Escribe tu consulta aquí…');
    await user.type(input, 'Hola');
    await user.click(screen.getByLabelText('Enviar consulta'));

    await waitFor(() => {
      expect(service.processQuery).toHaveBeenCalledWith('Hola');
    });

    await waitFor(() => {
      expect(screen.getByText('Respuesta de prueba')).toBeInTheDocument();
    });
  });

  it('envía consulta al presionar Enter', async () => {
    const user = userEvent.setup();
    const mockResult: QueryResult = {
      intent: 'general',
      response: 'Respuesta Enter',
    };
    const mockMessages: ConversationMessage[] = [
      { role: 'user', content: 'consulta', timestamp: '2024-01-15T10:00:00Z' },
      { role: 'assistant', content: 'Respuesta Enter', timestamp: '2024-01-15T10:00:01Z' },
    ];

    const service = getMockService();
    service.processQuery.mockResolvedValue(mockResult);
    service.getConversationHistory
      .mockReturnValueOnce([])
      .mockReturnValue(mockMessages);

    render(<AgentPage />);

    const input = screen.getByPlaceholderText('Escribe tu consulta aquí…');
    await user.type(input, 'consulta');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(service.processQuery).toHaveBeenCalledWith('consulta');
    });
  });

  it('muestra indicador de carga mientras procesa', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    let resolveQuery!: (value: QueryResult) => void;
    const pendingPromise = new Promise<QueryResult>((resolve) => {
      resolveQuery = resolve;
    });

    const service = getMockService();
    service.processQuery.mockReturnValue(pendingPromise);

    render(<AgentPage />);

    const input = screen.getByPlaceholderText('Escribe tu consulta aquí…');
    await user.type(input, 'test');
    await user.click(screen.getByLabelText('Enviar consulta'));

    await waitFor(() => {
      expect(screen.getByText('Procesando consulta…')).toBeInTheDocument();
    });

    resolveQuery({ intent: 'general', response: 'ok' });
    service.getConversationHistory.mockReturnValue([
      { role: 'user', content: 'test', timestamp: '2024-01-15T10:00:00Z' },
      { role: 'assistant', content: 'ok', timestamp: '2024-01-15T10:00:01Z' },
    ]);

    await waitFor(() => {
      expect(screen.queryByText('Procesando consulta…')).not.toBeInTheDocument();
    });
  });

  it('muestra mensaje de error cuando falla la consulta', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const service = getMockService();
    service.processQuery.mockRejectedValue(new Error('Network error'));

    render(<AgentPage />);

    const input = screen.getByPlaceholderText('Escribe tu consulta aquí…');
    await user.type(input, 'test');
    await user.click(screen.getByLabelText('Enviar consulta'));

    await waitFor(() => {
      expect(
        screen.getByText(/Ocurrió un error al procesar tu consulta/),
      ).toBeInTheDocument();
    });
  });

  it('carga historial existente al montar', () => {
    const existingMessages: ConversationMessage[] = [
      { role: 'user', content: 'Pregunta previa', timestamp: '2024-01-15T09:00:00Z' },
      { role: 'assistant', content: 'Respuesta previa', timestamp: '2024-01-15T09:00:01Z' },
    ];
    getMockService().getConversationHistory.mockReturnValue(existingMessages);

    render(<AgentPage />);

    expect(screen.getByText('Pregunta previa')).toBeInTheDocument();
    expect(screen.getByText('Respuesta previa')).toBeInTheDocument();
  });

  it('muestra datos estructurados de discrepancias', () => {
    const messagesWithData: ConversationMessage[] = [
      { role: 'user', content: 'Buscar factura INV-001', timestamp: '2024-01-15T10:00:00Z' },
      {
        role: 'assistant',
        content: 'Se encontraron discrepancias.',
        timestamp: '2024-01-15T10:00:01Z',
        data: {
          invoice: 'INV-001',
          discrepancies: [
            {
              discrepancyId: 'd1',
              sourceStage: 'geopos_local',
              targetStage: 'geopos_central',
              invoice: 'INV-001',
              type: 'missing_invoice',
              details: { message: 'Factura no encontrada' },
              severity: 'high',
              detectedAt: '2024-01-15T10:00:00Z',
            },
          ],
        },
      },
    ];
    getMockService().getConversationHistory.mockReturnValue(messagesWithData);

    render(<AgentPage />);

    expect(screen.getByText('Se encontraron discrepancias.')).toBeInTheDocument();
    // Tabla de discrepancias
    expect(screen.getByText('INV-001')).toBeInTheDocument();
    expect(screen.getByText('Factura perdida')).toBeInTheDocument();
  });

  it('muestra datos estructurados de hallazgos', () => {
    const messagesWithFindings: ConversationMessage[] = [
      { role: 'user', content: 'Explicar hallazgos', timestamp: '2024-01-15T10:00:00Z' },
      {
        role: 'assistant',
        content: 'Se encontraron hallazgos.',
        timestamp: '2024-01-15T10:00:01Z',
        data: {
          findings: [
            {
              findingId: 'f1',
              discrepancyId: 'd1',
              explanation: 'Error de sincronización',
              probableCause: 'Timeout en la red',
              recommendation: 'Reintentar la carga',
              severity: 'medium',
              itemFindings: [],
              createdAt: '2024-01-15T10:00:00Z',
            },
          ],
        },
      },
    ];
    getMockService().getConversationHistory.mockReturnValue(messagesWithFindings);

    render(<AgentPage />);

    expect(screen.getByText('Error de sincronización')).toBeInTheDocument();
    expect(screen.getByText(/Timeout en la red/)).toBeInTheDocument();
    expect(screen.getByText(/Reintentar la carga/)).toBeInTheDocument();
  });

  it('muestra datos estructurados de resultados de calidad', () => {
    const messagesWithQuality: ConversationMessage[] = [
      { role: 'user', content: 'Reglas de calidad', timestamp: '2024-01-15T10:00:00Z' },
      {
        role: 'assistant',
        content: 'Resultados de calidad.',
        timestamp: '2024-01-15T10:00:01Z',
        data: {
          qualityResults: {
            totalRules: 20,
            passed: 18,
            failed: 2,
            byDataset: [],
          },
        },
      },
    ];
    getMockService().getConversationHistory.mockReturnValue(messagesWithQuality);

    render(<AgentPage />);

    expect(screen.getByText('Resultados de Calidad')).toBeInTheDocument();
    expect(screen.getByText('Total: 20')).toBeInTheDocument();
    expect(screen.getByText('Pasaron: 18')).toBeInTheDocument();
    expect(screen.getByText('Fallaron: 2')).toBeInTheDocument();
  });

  it('tiene el área de mensajes con role="log"', () => {
    render(<AgentPage />);
    expect(screen.getByRole('log', { name: /historial de conversación/i })).toBeInTheDocument();
  });
});
