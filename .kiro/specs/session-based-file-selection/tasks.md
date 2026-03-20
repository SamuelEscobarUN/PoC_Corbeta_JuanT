# Plan de Implementación

- [x] 1. Escribir test exploratorio de bug condition
  - **Property 1: Bug Condition** - Asociación de uploads a sesión y auto-selección
  - **CRITICAL**: Este test DEBE FALLAR en el código sin corregir — el fallo confirma que el bug existe
  - **NO intentes corregir el test ni el código cuando falle**
  - **NOTA**: Este test codifica el comportamiento esperado — validará el fix cuando pase después de la implementación
  - **GOAL**: Generar contraejemplos que demuestren que el bug existe
  - **Scoped PBT Approach**: Enfocar la propiedad en los casos concretos de fallo:
    - Verificar que `UploadService.uploadFile` acepta un parámetro `sessionId` opcional
    - Verificar que al subir un archivo con `sessionId`, el registro de Upload en DynamoDB contiene ese `sessionId`
    - Verificar que `SessionService` tiene un método `getSessionUploads(sessionId)` que retorna uploads filtrados por sesión
    - Verificar que al consultar uploads por sesión, se obtienen solo los uploads asociados a esa sesión (uno por cada CascadeStage)
  - Test: para cualquier upload con `sessionId` válido, el registro debe contener `sessionId` y `getSessionUploads` debe retornarlo (del Bug Condition en diseño)
  - Las aserciones deben coincidir con las Expected Behavior Properties del diseño (Req 2.1, 2.5)
  - Ejecutar test en código SIN CORREGIR
  - **RESULTADO ESPERADO**: Test FALLA (esto es correcto — demuestra que el bug existe)
  - Documentar contraejemplos encontrados (ej: "uploadFile no acepta sessionId", "getSessionUploads no existe en SessionService")
  - Marcar tarea completa cuando el test esté escrito, ejecutado, y el fallo documentado
  - _Requirements: 1.1, 1.5, 2.1, 2.5_

- [x] 2. Escribir tests de preservación (ANTES de implementar el fix)
  - **Property 2: Preservation** - Flujo manual sin sesión inalterado
  - **IMPORTANTE**: Seguir metodología observation-first
  - Observar: `uploadService.uploadFile(file, stage, content, userId)` sin sessionId funciona correctamente en código sin corregir
  - Observar: `uploadService.getUploadHistory()` retorna todos los uploads con sus campos correctos en código sin corregir
  - Observar: Selección manual de archivos en dropdowns de DiscrepanciesPage funciona sin cambios
  - Observar: Flujo de crear sesión al hacer clic en "Comparar" (diálogo de nombre) funciona sin cambios
  - Escribir property-based test: para todos los uploads sin sessionId, el resultado debe ser idéntico al comportamiento original (del Preservation Requirements en diseño)
  - Escribir test: `uploadFile` sin sessionId produce un `UploadResult` con status 'success' y el registro no tiene sessionId
  - Escribir test: `getUploadHistory` retorna registros con todos los campos existentes (uploadId, stage, fileName, fileSize, status, s3Key, uploadedBy, uploadedAt)
  - Verificar tests PASAN en código SIN CORREGIR
  - **RESULTADO ESPERADO**: Tests PASAN (confirma el comportamiento base a preservar)
  - Marcar tarea completa cuando los tests estén escritos, ejecutados, y pasando en código sin corregir
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Capa de datos — Agregar sessionId al modelo Upload y tipo UploadRecord

  - [x] 3.1 Agregar campo `sessionId` al modelo Upload en `amplify/data/resource.ts`
    - Agregar `sessionId: a.string()` como campo opcional en el modelo Upload
    - Agregar GSI `sessionId-stage-index` con partition key `sessionId` y sort key `stage`
    - _Bug_Condition: isBugCondition(input) donde Upload.model NO TIENE campo sessionId_
    - _Expected_Behavior: Upload.model TIENE campo sessionId opcional y GSI sessionId-stage-index_
    - _Preservation: Los campos existentes del modelo Upload no cambian_
    - _Requirements: 1.5, 2.5_

  - [x] 3.2 Agregar `sessionId` al tipo `UploadRecord` en `src/types/upload.ts`
    - Agregar `sessionId?: string` como campo opcional en la interfaz `UploadRecord`
    - No modificar ningún otro campo existente para mantener retrocompatibilidad
    - _Requirements: 2.5_

- [x] 4. Checkpoint — Verificar capa de datos
  - Ejecutar `npx tsc --noEmit` para verificar que no hay errores de tipos
  - Verificar que el schema de Amplify compila correctamente
  - Confirmar que los tipos existentes no se rompieron

- [x] 5. Capa de servicios — Actualizar UploadService y SessionService

  - [x] 5.1 Actualizar `uploadFile` en `src/services/upload.ts` para aceptar `sessionId`
    - Agregar parámetro opcional `sessionId?: string` al método `uploadFile`
    - Incluir `sessionId` en `client.models.Upload.create()` si se proporciona
    - Si `sessionId` es `undefined`, no incluirlo (preservación del flujo sin sesión)
    - _Bug_Condition: uploadService.uploadFile NO ACEPTA parámetro sessionId_
    - _Expected_Behavior: uploadFile acepta sessionId opcional y lo almacena en DynamoDB_
    - _Preservation: Llamadas sin sessionId producen el mismo resultado que antes_
    - _Requirements: 1.1, 2.1, 3.1_

  - [x] 5.2 Actualizar `getUploadHistory` en `src/services/upload.ts` para mapear `sessionId`
    - En el mapeo de items dentro de `getUploadHistory`, agregar `sessionId: item.sessionId ?? undefined`
    - _Requirements: 2.5, 3.4_

  - [x] 5.3 Agregar método `getSessionUploads` a `SessionService` en `src/services/session.ts`
    - Nuevo método `async getSessionUploads(sessionId: string): Promise<UploadRecord[]>`
    - Consultar el GSI `sessionId-stage-index` usando `client.models.Upload.listUploadBySessionIdAndStage({ sessionId })`
    - Mapear resultados a `UploadRecord[]` ordenados por etapa
    - Retornar array vacío si no hay uploads o si ocurre un error
    - _Bug_Condition: SessionService NO TIENE método getSessionUploads_
    - _Expected_Behavior: getSessionUploads retorna uploads filtrados por sessionId_
    - _Requirements: 2.2, 2.3_

- [x] 6. Checkpoint — Verificar capa de servicios
  - Ejecutar `npx tsc --noEmit` para verificar que no hay errores de tipos
  - Verificar que los tests de preservación (tarea 2) siguen pasando
  - Confirmar que los servicios existentes no se rompieron

- [x] 7. Capa UI — Actualizar componentes

  - [x] 7.1 Agregar prop `sessionId` opcional a `FileUploadForm` en `src/components/organisms/FileUploadForm.tsx`
    - Agregar `sessionId?: string` a la interfaz `FileUploadFormProps`
    - Pasar `sessionId` a `uploadService.uploadFile()` en `handleUpload`
    - No cambiar el comportamiento cuando `sessionId` no se proporciona
    - _Preservation: Sin sessionId, el componente funciona exactamente igual que antes_
    - _Requirements: 2.1, 3.1_

  - [x] 7.2 Agregar selector de sesión a `UploadPage` en `src/components/pages/UploadPage.tsx`
    - Agregar estado `selectedSessionId` y `sessions` (lista de sesiones in_progress)
    - Cargar sesiones con `sessionService.listSessions({ status: 'in_progress' })` en useEffect
    - Agregar un `Select` con opción "Sin sesión" (valor vacío) + sesiones disponibles
    - Pasar `sessionId` seleccionado a `FileUploadForm`
    - Opción "Sin sesión" preserva el flujo actual sin cambios
    - _Requirements: 2.1, 3.1_

  - [x] 7.3 Agregar selector de sesión con auto-populate a `DiscrepanciesPage` en `src/components/pages/DiscrepanciesPage.tsx`
    - Agregar estado `sessions` y `selectedSessionForAutoPopulate`
    - Cargar sesiones disponibles en useEffect
    - Agregar un `Select` de sesión encima de los 4 dropdowns de archivos
    - Al seleccionar una sesión, llamar a `sessionService.getSessionUploads(sessionId)`
    - Auto-popular `selectedUploads` con los uploadIds correspondientes a cada etapa (CascadeStage)
    - Si la sesión tiene los 4 archivos, habilitar "Comparar" automáticamente
    - Si se seleccionó una sesión existente, al comparar usar esa sesión (setActiveSessionId) en lugar de crear nueva
    - Mantener opción "Sin sesión" que preserva el flujo manual actual completo
    - _Bug_Condition: DiscrepanciesPage NO TIENE selector de sesión_
    - _Expected_Behavior: Al seleccionar sesión, los 4 dropdowns se auto-populan_
    - _Preservation: Sin seleccionar sesión, el flujo manual funciona igual que antes_
    - _Requirements: 2.2, 2.3, 2.4, 3.2, 3.3_

- [x] 8. Checkpoint — Verificar capa UI
  - Ejecutar `npx tsc --noEmit` para verificar que no hay errores de tipos
  - Verificar que la aplicación compila sin errores

- [x] 9. Verificar fix completo

  - [x] 9.1 Verificar que el test exploratorio de bug condition ahora pasa
    - **Property 1: Expected Behavior** - Asociación de uploads a sesión y auto-selección
    - **IMPORTANTE**: Re-ejecutar el MISMO test de la tarea 1 — NO escribir un test nuevo
    - El test de la tarea 1 codifica el comportamiento esperado
    - Cuando este test pase, confirma que el comportamiento esperado se satisface
    - Ejecutar test exploratorio de bug condition del paso 1
    - **RESULTADO ESPERADO**: Test PASA (confirma que el bug está corregido)
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 9.2 Verificar que los tests de preservación siguen pasando
    - **Property 2: Preservation** - Flujo manual sin sesión inalterado
    - **IMPORTANTE**: Re-ejecutar los MISMOS tests de la tarea 2 — NO escribir tests nuevos
    - Ejecutar tests de preservación del paso 2
    - **RESULTADO ESPERADO**: Tests PASAN (confirma que no hay regresiones)
    - Confirmar que todos los tests siguen pasando después del fix (sin regresiones)

- [x] 10. Checkpoint final — Asegurar que todos los tests pasan
  - Ejecutar todos los tests del proyecto
  - Verificar que no hay errores de compilación
  - Preguntar al usuario si hay dudas o ajustes necesarios
