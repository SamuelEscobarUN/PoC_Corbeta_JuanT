# Plan de Implementación: Sesiones de Trabajo

## Resumen

Implementación incremental del concepto de Sesiones de Trabajo en la plataforma de reconciliación de datos. Se comienza con la capa de datos (modelo + tipos), luego el servicio, después las páginas UI, las integraciones con páginas existentes, y finalmente las mejoras de UI/UX (tema visual y barra lateral).

## Tareas

- [x] 1. Capa de datos: modelo Session y tipos TypeScript
  - [x] 1.1 Agregar modelo Session al esquema Amplify y campos sessionId a Finding y Correction
    - Modificar `amplify/data/resource.ts` para agregar el modelo `Session` con los campos: sessionId, sessionName, status (enum: in_progress, completed, archived), createdBy, createdAt, completedAt, uploadIds, discrepancyCount, findingCount
    - Agregar índice secundario `status-date-index` (PK: status, SK: createdAt)
    - Agregar campo `sessionId: a.string()` al modelo `Finding`
    - Agregar campo `sessionId: a.string()` al modelo `Correction`
    - Autorización para grupos Administrator y Operator
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2_

  - [x] 1.2 Crear tipos TypeScript para sesiones
    - Crear `src/types/session.ts` con las interfaces: SessionStatus, Session, CreateSessionInput, SessionFilters, PaginatedSessions
    - _Requisitos: 1.1, 4.3_

- [x] 2. Servicio de sesiones
  - [x] 2.1 Implementar SessionService con operaciones CRUD
    - Crear `src/services/session.ts` como servicio singleton (patrón existente en el proyecto)
    - Implementar `createSession(input)`: crea sesión con estado `in_progress`, genera sessionId y createdAt
    - Implementar `getSession(sessionId)`: obtiene sesión por ID
    - Implementar `listSessions(filters?)`: lista sesiones con filtro por estado (usando GSI status-date-index) y búsqueda por nombre (client-side)
    - Implementar `updateSessionStatus(sessionId, status)`: cambia estado, registra completedAt si status es `completed`
    - Implementar `updateSessionCounts(sessionId, discrepancyCount, findingCount)`: actualiza contadores
    - Implementar `getSessionDiscrepancies(sessionId)`: obtiene discrepancias por sessionId
    - Implementar `getSessionFindings(sessionId)`: obtiene hallazgos por sessionId
    - Implementar `getSessionCorrections(sessionId)`: obtiene correcciones por sessionId
    - _Requisitos: 1.5, 2.2, 3.3, 3.4, 4.2, 4.3, 6.4_

  - [ ]* 2.2 Escribir test de propiedad para creación de sesión
    - **Propiedad 1: Correctitud de creación de sesión**
    - Generar nombres aleatorios (strings no vacíos), arrays de 4 UUIDs, emails aleatorios
    - Verificar que el resultado contiene el nombre, uploadIds, createdBy, sessionId no vacío, createdAt válido y estado `in_progress`
    - **Valida: Requisitos 1.1, 1.5, 2.2**

  - [ ]* 2.3 Escribir test de propiedad para ordenamiento de sesiones
    - **Propiedad 5: Ordenamiento descendente de sesiones por fecha**
    - Generar arrays de sesiones con fechas aleatorias
    - Verificar que cada sesión[i].createdAt >= sesión[i+1].createdAt
    - **Valida: Requisitos 4.2**

  - [ ]* 2.4 Escribir test de propiedad para filtrado de sesiones
    - **Propiedad 6: Correctitud de filtrado de sesiones**
    - Generar arrays de sesiones con estados y nombres aleatorios, aplicar filtros aleatorios
    - Verificar que todas las sesiones en el resultado cumplen los criterios de filtro
    - **Valida: Requisitos 4.3, 4.4**

  - [ ]* 2.5 Escribir test de propiedad para completedAt al completar sesión
    - **Propiedad 7: Registro de completedAt al completar sesión**
    - Generar sesiones in_progress y ejecutar transición a completed
    - Verificar que completedAt es un DateTime ISO-8601 válido y no nulo
    - **Valida: Requisitos 6.4**

  - [ ]* 2.6 Escribir tests unitarios del SessionService
    - Test de creación con datos concretos
    - Test de sesión no encontrada retorna null
    - Test de transición de estado inválida (archived → in_progress)
    - Test de listado con filtro de estado
    - Test de búsqueda por nombre (case-insensitive)
    - _Requisitos: 1.5, 2.2, 4.2, 4.3, 4.4, 6.4_

- [x] 3. Checkpoint — Verificar capa de datos y servicio
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [x] 4. Páginas UI de sesiones
  - [x] 4.1 Implementar SessionsPage (listado de sesiones)
    - Crear `src/components/pages/SessionsPage.tsx`
    - Tabla con columnas: nombre, fecha de creación, estado (Chip con color), usuario, # discrepancias, # hallazgos
    - Ordenamiento por fecha descendente
    - Filtro por estado mediante Select (in_progress, completed, archived)
    - Búsqueda por nombre mediante TextField
    - Clic en fila navega a `/sessions/:sessionId`
    - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 4.2 Implementar SessionDetailPage (detalle de sesión)
    - Crear `src/components/pages/SessionDetailPage.tsx`
    - Pestaña "Información General": nombre, fecha, estado, usuario, botones de cambio de estado
    - Pestaña "Archivos": tabla con los 4 uploads asociados (nombre, etapa, fecha)
    - Pestaña "Discrepancias": tabla con factura, tipo, etapa, totales, diferencia, presencia
    - Pestaña "Hallazgos IA": tabla con severidad, explicación, causa, recomendación
    - Pestaña "Correcciones": tabla con estado, acción, fechas
    - Botón "Completar Sesión" visible cuando status === 'in_progress'
    - Botón "Archivar Sesión" visible cuando status === 'completed'
    - Modo solo lectura cuando status === 'archived'
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4_

  - [ ]* 4.3 Escribir test de propiedad para asociación de artefactos
    - **Propiedad 2: Asociación de artefactos a sesión**
    - Generar sessionIds y arrays de artefactos con sessionId
    - Verificar que todos los artefactos guardados referencian el sessionId correcto
    - **Valida: Requisitos 2.3, 3.1, 3.2**

  - [ ]* 4.4 Escribir test de propiedad para restricción por estado
    - **Propiedad 3: Restricción de modificación por estado de sesión**
    - Generar sesiones con estados aleatorios y operaciones de adición
    - Verificar que in_progress permite agregar, archived rechaza
    - **Valida: Requisitos 3.3**

  - [ ]* 4.5 Escribir test de propiedad para completitud de sesión
    - **Propiedad 4: Completitud de sesión requiere resolución de correcciones**
    - Generar sesiones con arrays de correcciones en estados mixtos
    - Verificar que solo se permite completar cuando no hay correcciones pending_approval
    - **Valida: Requisitos 3.4**

  - [ ]* 4.6 Escribir tests unitarios de SessionsPage y SessionDetailPage
    - Test de renderizado de tabla de sesiones
    - Test de filtrado por estado
    - Test de búsqueda por nombre
    - Test de navegación al detalle al hacer clic
    - Test de botones de estado visibles según estado de sesión
    - Test de modo solo lectura para sesiones archivadas
    - _Requisitos: 4.1, 4.5, 5.1, 5.6, 6.1, 6.2, 6.3_

- [x] 5. Checkpoint — Verificar páginas de sesiones
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [x] 6. Integración con páginas existentes
  - [x] 6.1 Integrar creación de sesión en DiscrepanciesPage
    - Modificar `src/components/pages/DiscrepanciesPage.tsx`
    - Agregar Dialog para solicitar nombre de sesión antes de comparar
    - Al confirmar, llamar a SessionService.createSession() para obtener sessionId
    - Usar el sessionId al guardar discrepancias
    - Si el usuario cancela el diálogo, no ejecutar la comparación
    - Pasar sessionId a hallazgos IA al generarlos
    - _Requisitos: 2.1, 2.2, 2.3, 2.4, 3.1_

  - [x] 6.2 Integrar sessionId en RemediationPage
    - Modificar `src/components/pages/RemediationPage.tsx`
    - Al proponer correcciones, incluir el sessionId de la sesión activa (la más reciente con estado in_progress)
    - _Requisitos: 3.2_

  - [x] 6.3 Agregar rutas y navegación
    - Modificar `src/App.tsx` para agregar rutas `/sessions` y `/sessions/:id`
    - Modificar `src/components/templates/MainLayout.tsx` para agregar "Sesiones" con ícono WorkHistoryIcon entre "Discrepancias" y "Agente Conversacional"
    - _Requisitos: 7.1, 7.2, 7.3_

- [x] 7. Checkpoint — Verificar integraciones
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [x] 8. Mejoras de UI/UX: tema visual y barra lateral
  - [x] 8.1 Actualizar tema visual en theme.ts
    - Modificar `src/theme.ts`
    - Cambiar fontFamily a `"Inter", "Roboto", "Helvetica", "Arial", sans-serif`
    - Agregar pesos tipográficos: 600 para h1-h6, 400 para body
    - Agregar interlineado 1.6 para body1 y body2
    - Agregar borderRadius: Paper 16px, TableContainer 12px, Chip 8px
    - Agregar transiciones de 200ms en Button, Card, Paper, TableRow para hover/focus
    - _Requisitos: 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 8.2 Corregir visibilidad del botón de colapsar en MainLayout
    - Modificar `src/components/templates/MainLayout.tsx`
    - Agregar paddingTop o marginTop al contenedor del Drawer equivalente a la altura del AppBar (64px)
    - Verificar que el botón de colapsar/expandir es visible y accesible
    - _Requisitos: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 8.3 Escribir test de propiedad para toggle de barra lateral
    - **Propiedad 8: Toggle de barra lateral alterna entre estados**
    - Generar secuencias aleatorias de toggles
    - Verificar que toggle dos veces retorna al estado original (round-trip)
    - **Valida: Requisitos 10.3**

  - [ ]* 8.4 Escribir tests unitarios del tema y barra lateral
    - Verificar valores de tipografía (Inter, peso 600/400, interlineado 1.6)
    - Verificar borderRadius de Paper, TableContainer, Chip
    - Verificar transiciones de 200ms
    - Verificar que el botón de colapsar es visible debajo del AppBar
    - _Requisitos: 8.1, 8.2, 8.3, 8.4, 9.2, 9.4, 9.5, 10.1, 10.2_

- [x] 9. Checkpoint final — Verificar implementación completa
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

## Notas

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia requisitos específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- Los tests de propiedades validan invariantes universales usando fast-check
- Los tests unitarios validan ejemplos específicos y casos borde
