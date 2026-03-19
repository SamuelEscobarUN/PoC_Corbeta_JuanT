# Plan de Implementación: Plataforma de Reconciliación de Datos

## Visión General

Implementación incremental de la plataforma de reconciliación de datos usando React + Material 3 en el frontend, AWS Amplify para despliegue, Lambda (TypeScript) para backend, DynamoDB para persistencia, S3 para almacenamiento de archivos y Amazon Bedrock para IA. Cada tarea construye sobre las anteriores, integrando componentes progresivamente.

## Tareas

- [x] 1. Configuración del proyecto e infraestructura base
  - [x] 1.1 Inicializar proyecto React con TypeScript, Material UI v6 y AWS Amplify
    - Crear proyecto con Vite + React + TypeScript
    - Instalar dependencias: `@mui/material`, `@aws-amplify/ui-react`, `aws-amplify`, `fast-check` (dev)
    - Configurar estructura Atomic Design: `src/components/{atoms,molecules,organisms,templates,pages}`
    - Configurar tema Material 3 con paleta: base `#001689`, cyan `#2ed9c3`, azul `#0055b8`
    - Configurar Vitest y React Testing Library
    - _Requisitos: 11.1, 11.2, 11.3, 12.1_

  - [x] 1.2 Configurar infraestructura AWS Amplify y servicios base
    - Configurar Amplify Auth con Amazon Cognito (grupos: Administrator, Operator)
    - Configurar Amplify Storage con Amazon S3 (estructura de prefijos por etapa y fecha)
    - Configurar Amplify API (REST o GraphQL) con API Gateway + Lambda
    - Configurar DynamoDB: tablas Uploads, Discrepancies, Findings, Corrections, QualityResults con GSIs
    - _Requisitos: 12.1, 12.2, 12.3, 12.5_

- [x] 2. Módulo de autenticación y control de acceso
  - [x] 2.1 Implementar servicio de autenticación (`AuthService`)
    - Implementar `signIn`, `signOut`, `getCurrentUser`, `getUserRole`, `hasPermission`
    - Integrar con Amazon Cognito vía Amplify Auth
    - Implementar lógica de permisos basada en grupos de Cognito
    - _Requisitos: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [ ]* 2.2 Escribir test de propiedad para control de acceso basado en roles
    - **Propiedad 1: Control de acceso basado en roles**
    - Generar usuarios aleatorios con roles y funcionalidades; verificar que el acceso es permitido sii el rol incluye el permiso
    - **Valida: Requisitos 1.3, 1.5**

  - [ ]* 2.3 Escribir test de propiedad para unicidad de rol por usuario
    - **Propiedad 2: Unicidad de rol por usuario**
    - Generar datos de creación de usuario; verificar que siempre tiene exactamente un rol y permisos no vacíos
    - **Valida: Requisitos 1.2, 1.4**

  - [x] 2.4 Implementar servicio de gestión de usuarios (`UserManagementService`)
    - Implementar `createUser`, `updateUser`, `deactivateUser`, `deleteUser`, `assignRole`, `listUsers`
    - Integrar con Cognito para CRUD de usuarios y asignación de grupos
    - _Requisitos: 1.4, 10.1, 10.2_

  - [ ]* 2.5 Escribir test de propiedad para modificación de rol y permisos
    - **Propiedad 18: Modificación de rol y permisos de usuario**
    - Generar usuarios con cambios de rol/permisos; verificar que los cambios persisten y se reflejan en el control de acceso
    - **Valida: Requisito 10.2**

  - [x] 2.6 Implementar componentes UI de autenticación
    - Crear página de login con Amplify Authenticator
    - Crear componente `ProtectedRoute` que valide rol y permisos
    - Crear layout principal con navegación condicional por rol
    - _Requisitos: 1.1, 1.3, 1.5, 11.4_

- [x] 3. Checkpoint - Verificar autenticación y control de acceso
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [x] 4. Módulo de carga de archivos CSV
  - [x] 4.1 Implementar validación de formato CSV por etapa
    - Implementar `validateFileFormat` con las columnas esperadas por etapa según `STAGE_COLUMNS`
    - Validar: columnas faltantes, formato inválido, archivo vacío
    - Retornar `ValidationResult` con errores descriptivos
    - _Requisitos: 2.2, 2.4_

  - [ ]* 4.2 Escribir test de propiedad para validación de formato CSV
    - **Propiedad 3: Validación de formato CSV por etapa**
    - Generar archivos CSV con columnas aleatorias por etapa; verificar que se rechaza si faltan columnas y se acepta si están completas
    - **Valida: Requisitos 2.2, 2.4**

  - [x] 4.3 Implementar servicio de carga (`UploadService`)
    - Implementar `uploadFile`: subir a S3 con prefijo `uploads/{stage}/{yyyy}/{mm}/{dd}/{uploadId}/raw.csv`
    - Registrar metadatos en tabla Uploads de DynamoDB con estado `uploaded`
    - Registrar metadatos en AWS Glue Data Catalog
    - Iniciar procesamiento automático (transicionar estado a `processing`)
    - Implementar `getUploadHistory` con filtros y paginación
    - _Requisitos: 2.1, 2.3, 2.5, 12.3, 12.5_

  - [ ]* 4.4 Escribir test de propiedad para procesamiento automático tras carga
    - **Propiedad 4: Procesamiento automático tras carga exitosa**
    - Generar archivos CSV válidos; verificar que el estado transiciona a `processing` y se inicia la transformación
    - **Valida: Requisito 2.3**

  - [x] 4.5 Implementar componentes UI de carga de archivos
    - Crear página de carga con selector de etapa de la cascada
    - Crear componente de drag-and-drop para archivos CSV
    - Mostrar mensajes de error descriptivos cuando la validación falla
    - Mostrar historial de cargas con estado
    - _Requisitos: 2.1, 2.2, 2.4, 11.4_

- [x] 5. Motor de transformación de datos
  - [x] 5.1 Implementar transformación para Geopos Local y Central (agrupación sin suma)
    - Implementar `transformGeopos`: agrupar por invoice, total = valor de cualquier fila (no sumar repetidos)
    - Extraer ítems con barcode como itemId
    - Almacenar resultado normalizado en S3 como JSON en `normalized/{stage}/{uploadId}/normalized.json`
    - _Requisitos: 3.1, 3.2, 3.5_

  - [ ]* 5.2 Escribir test de propiedad para transformación sin suma
    - **Propiedad 5: Transformación de agrupación sin suma (Geopos Local y Central)**
    - Generar registros Geopos con totales repetidos; verificar que el total por factura es el valor individual, no la suma
    - **Valida: Requisitos 3.1, 3.2**

  - [x] 5.3 Implementar transformación para Integración y PS_CK (agrupación con suma)
    - Implementar `transformIntegracion`: agrupar por INVOICE, total = SUM(TOTAL)
    - Implementar `transformPsCk`: agrupar por INVOICE, total = SUM(TOTAL)
    - Extraer ítems con SKU o INV_ITEM_ID como itemId según etapa
    - Almacenar resultado normalizado en S3
    - _Requisitos: 3.3, 3.4, 3.5_

  - [ ]* 5.4 Escribir test de propiedad para transformación con suma
    - **Propiedad 6: Transformación de agrupación con suma (Integración y PS_CK)**
    - Generar registros Integración/PS_CK con totales por ítem; verificar que el total por factura es la suma de los totales individuales
    - **Valida: Requisitos 3.3, 3.4**

  - [x] 5.5 Implementar `TransformationService` completo con dispatch por etapa
    - Crear servicio que recibe `uploadId`, `stage` y `rawData`, y delega a la función de transformación correcta
    - Actualizar estado del upload a `transformed` en DynamoDB tras completar
    - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 6. Checkpoint - Verificar carga y transformación
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [x] 7. Validación de calidad de datos
  - [x] 7.1 Implementar servicio de reglas de calidad (`QualityRulesService`)
    - Integrar con AWS Glue Data Quality para ejecutar reglas configuradas por etapa
    - Registrar resultado (passed/failed) por regla en tabla QualityResults de DynamoDB
    - Generar alertas cuando una regla falla
    - _Requisitos: 4.1, 4.4, 4.5_

  - [ ]* 7.2 Escribir test de propiedad para registro de resultados de calidad
    - **Propiedad 9: Registro de resultados de calidad por regla**
    - Generar reglas y resultados de ejecución; verificar que cada regla tiene resultado registrado y las fallidas generan alerta
    - **Valida: Requisitos 4.4, 4.5**

  - [x] 7.3 Implementar CRUD de reglas de calidad para Administrador
    - Crear endpoints para crear, editar, eliminar y listar reglas de calidad
    - Implementar UI para gestión de reglas con formularios
    - Implementar vista de resultados de ejecución por archivo y dataset
    - _Requisitos: 4.2, 4.3, 4.6, 12.4_

- [x] 8. Motor de comparación progresiva
  - [x] 8.1 Implementar `ComparisonService` con comparación entre etapas consecutivas
    - Implementar comparación: Geopos Local vs Geopos Central, Geopos Central vs Integración, Integración vs PS_CK
    - Detectar discrepancias: `missing_invoice`, `total_difference`, `item_count_difference`, `missing_item`
    - Determinar etapa exacta de origen de cada discrepancia
    - Registrar discrepancias en tabla Discrepancies de DynamoDB con GSI `invoice-index`
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 8.2 Escribir test de propiedad para detección de discrepancias
    - **Propiedad 7: Detección de discrepancias entre etapas consecutivas**
    - Generar pares de datos transformados con diferencias conocidas; verificar que se registran los tipos correctos de discrepancia con la etapa de origen
    - **Valida: Requisitos 5.1, 5.3, 5.4, 5.5, 5.6, 5.7**

  - [ ]* 8.3 Escribir tests unitarios para el motor de comparación
    - Test con facturas idénticas entre etapas (sin discrepancias)
    - Test con factura faltante en etapa destino
    - Test con diferencia de total entre etapas
    - Test con ítem perdido entre etapas
    - Test con diferencia de cantidad de ítems
    - _Requisitos: 5.3, 5.4, 5.5, 5.6_

- [x] 9. Checkpoint - Verificar calidad y comparación
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [x] 10. Motor de IA y análisis de discrepancias
  - [x] 10.1 Implementar `AIAnalysisService` con Amazon Bedrock
    - Implementar `analyzeDiscrepancy`: enviar discrepancia con contexto a Bedrock, obtener explicación, causa probable y recomendación
    - Implementar granularidad a nivel de ítem (`ItemFinding`) cuando la discrepancia involucra múltiples ítems
    - Implementar `detectAnomalies`: detectar patrones anómalos y generar alertas con severidad
    - Registrar hallazgos en tabla Findings de DynamoDB
    - Implementar reintentos con backoff exponencial para timeouts de Bedrock
    - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 10.2 Escribir test de propiedad para completitud de hallazgos
    - **Propiedad 8: Completitud de hallazgos del Motor IA**
    - Generar discrepancias con contexto; verificar que cada hallazgo contiene explicación, causa probable, recomendación no vacías y referencia a la discrepancia. Si hay múltiples ítems, verificar detalles a nivel de ítem
    - **Valida: Requisitos 6.2, 6.3, 6.5, 6.6**

- [x] 11. Módulo de remediación y generación XML
  - [x] 11.1 Implementar `RemediationService`
    - Implementar `proposeCorrection`: registrar corrección con estado `pending_approval` en tabla Corrections
    - Implementar `approveCorrection`: cambiar estado a `approved`, disparar generación de XML
    - Implementar `rejectCorrection`: cambiar estado a `rejected`, registrar motivo, notificar al operador vía SNS/SES
    - Implementar `getCorrections` con filtros por estado y paginación usando GSI `status-index`
    - _Requisitos: 9.1, 9.2, 9.3, 9.7_

  - [ ]* 11.2 Escribir test de propiedad para flujo de corrección con estado inicial
    - **Propiedad 12: Flujo de corrección con estado inicial pendiente**
    - Generar correcciones propuestas; verificar que el estado inicial es `pending_approval` y solo cambia a `approved` o `rejected` por acción de administrador
    - **Valida: Requisitos 9.1, 9.2, 9.3**

  - [ ]* 11.3 Escribir test de propiedad para registro de motivo de rechazo
    - **Propiedad 14: Registro de motivo de rechazo**
    - Generar correcciones rechazadas; verificar que se registra motivo no vacío y se notifica al operador
    - **Valida: Requisito 9.7**

  - [x] 11.4 Implementar generador de XML de corrección
    - Generar XML con estructura definida: `correctionId`, `invoice`, `item`, `originStage`, `correctedValues`, `metadata` (approvedBy, approvedAt, discrepancyId, findingId)
    - Almacenar XML en S3 en `corrections/{correctionId}/correction.xml`
    - Generar un XML individual por cada corrección aprobada
    - _Requisitos: 9.4, 9.5, 9.6_

  - [ ]* 11.5 Escribir test de propiedad para round-trip de XML
    - **Propiedad 13: Round-trip de generación XML de corrección**
    - Generar correcciones aprobadas con datos variados; verificar que el XML contiene todos los campos requeridos y que parsear el XML produce los mismos datos de la corrección original
    - **Valida: Requisitos 9.4, 9.5, 9.6**

  - [ ]* 11.6 Escribir test de propiedad para trazabilidad completa
    - **Propiedad 11: Trazabilidad completa de hallazgo a remediación**
    - Generar cadenas completas discrepancia→hallazgo→corrección→XML; verificar que cada eslabón referencia correctamente al anterior
    - **Valida: Requisito 7.5**

- [x] 12. Checkpoint - Verificar IA, remediación y XML
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [x] 13. Dashboard consolidado
  - [x] 13.1 Implementar `DashboardService`
    - Implementar `getReconciliationSummary`: total facturas procesadas, facturas con discrepancias, tasa de discrepancia, conteo por tipo
    - Implementar `getDiscrepanciesByStage`: discrepancias agrupadas por par de etapas
    - Implementar `getQualityResults`: reglas ejecutadas, pasadas, fallidas por dataset
    - Implementar `getRemediationStatus`: propuestas, pendientes, aprobadas, rechazadas, XML generados
    - _Requisitos: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 13.2 Escribir test de propiedad para agrupación de discrepancias por etapa
    - **Propiedad 10: Agrupación de discrepancias por etapa en Dashboard**
    - Generar conjuntos de discrepancias; verificar que se agrupan correctamente por par de etapas y los conteos suman el total
    - **Valida: Requisito 7.3**

  - [x] 13.3 Implementar componentes UI del Dashboard
    - Crear página Dashboard con tarjetas de métricas (total facturas, discrepancias, tasa)
    - Crear visualización de discrepancias agrupadas por etapa
    - Crear tabla de facturas con ítems perdidos y diferencias de valor
    - Crear vista de trazabilidad: discrepancia → hallazgo → remediación
    - Crear sección de resultados de reglas de calidad por dataset
    - Crear sección de estado de remediación
    - _Requisitos: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 11.4, 11.5_

- [x] 14. Agente conversacional
  - [x] 14.1 Implementar `ConversationalAgentService` con Amazon Bedrock
    - Implementar `processQuery`: interpretar consulta en lenguaje natural, consultar datos relevantes, generar respuesta
    - Soportar búsqueda de facturas por número de invoice
    - Soportar consulta de discrepancias entre dos etapas para una factura
    - Soportar consulta de etapa donde se perdió un ítem
    - Soportar resumen de incidentes por período
    - Soportar consulta de explicación de hallazgos
    - Soportar consulta de reglas de calidad fallidas por archivo/dataset
    - Implementar `getConversationHistory`
    - _Requisitos: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 14.2 Escribir test de propiedad para consulta de discrepancias por factura
    - **Propiedad 15: Consulta de discrepancias por factura vía agente conversacional**
    - Generar facturas con discrepancias y consultas; verificar que la respuesta incluye todas las discrepancias entre las etapas consultadas
    - **Valida: Requisitos 8.1, 8.2, 8.3**

  - [ ]* 14.3 Escribir test de propiedad para resumen de incidentes por período
    - **Propiedad 16: Resumen de incidentes por período**
    - Generar períodos y conjuntos de discrepancias; verificar que el resumen contiene la cantidad correcta por tipo
    - **Valida: Requisito 8.4**

  - [ ]* 14.4 Escribir test de propiedad para consulta de reglas fallidas
    - **Propiedad 17: Consulta de reglas de calidad fallidas vía agente**
    - Generar datasets con reglas fallidas; verificar que la respuesta incluye la lista completa de reglas fallidas con detalles
    - **Valida: Requisito 8.6**

  - [x] 14.5 Implementar componente UI del agente conversacional
    - Crear interfaz de chat con input de texto y área de mensajes
    - Mostrar respuestas con datos estructurados cuando aplique
    - Mostrar historial de conversación
    - _Requisitos: 8.1, 11.4_

- [x] 15. Módulo de remediación UI y panel de administración
  - [x] 15.1 Implementar componentes UI de remediación
    - Crear vista de hallazgos con explicación, causa probable y recomendación
    - Crear formulario para proponer corrección asociada a un hallazgo
    - Crear vista de administrador para revisar, aprobar o rechazar correcciones con campo de motivo de rechazo
    - Crear vista de descarga de XML de corrección generados
    - _Requisitos: 9.1, 9.2, 9.3, 9.4, 9.7, 11.4_

  - [x] 15.2 Implementar panel de administración
    - Crear página de gestión de usuarios (crear, editar, desactivar, eliminar)
    - Crear formulario de asignación de rol y permisos
    - Crear página de configuración del sistema (umbrales de tolerancia, notificaciones)
    - Crear vista de supervisión de estado de cargas, validaciones, discrepancias y remediaciones
    - _Requisitos: 10.1, 10.2, 10.3, 10.4, 11.4_

- [x] 16. Integración final y accesibilidad
  - [x] 16.1 Conectar todos los módulos y flujos end-to-end
    - Conectar flujo completo: carga → transformación → calidad → comparación → IA → remediación → XML
    - Configurar notificaciones SNS/SES para alertas de calidad, aprobación/rechazo de correcciones
    - Verificar navegación y rutas protegidas por rol
    - _Requisitos: 2.3, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 16.2 Implementar accesibilidad y extensibilidad de roles
    - Auditar componentes para cumplimiento de pautas de accesibilidad (aria-labels, contraste, navegación por teclado)
    - Verificar que el sistema de control de acceso soporta adición de roles futuros sin cambios estructurales
    - _Requisitos: 11.5, 12.6_

  - [ ]* 16.3 Escribir tests de integración end-to-end
    - Test del flujo completo: carga CSV → transformación → comparación → análisis IA → propuesta de corrección → aprobación → generación XML
    - Test de control de acceso: operador no puede aprobar correcciones, administrador puede gestionar usuarios
    - _Requisitos: 1.3, 1.5, 9.3, 9.4_

- [x] 17. Checkpoint final - Verificar integración completa
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

## Notas

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia requisitos específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- Los tests de propiedad validan propiedades universales de correctitud
- Los tests unitarios validan ejemplos específicos y edge cases
- Se usa TypeScript para todo el código (frontend y backend Lambda)
- fast-check se usa como librería de property-based testing
