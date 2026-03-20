# Diseño de Bugfix — Selección de Archivos Basada en Sesión

## Resumen

El sistema actual no vincula las cargas de archivos (Upload) con las sesiones de trabajo (Session). Los archivos se suben de forma independiente y en `DiscrepanciesPage` el usuario debe seleccionar manualmente los 4 archivos CSV desde dropdowns globales. La sesión se crea recién al hacer clic en "Comparar", después de seleccionar archivos.

Este bugfix agrega un campo `sessionId` al modelo `Upload`, permite asociar archivos a sesiones desde `UploadPage`, y agrega un selector de sesión en `DiscrepanciesPage` que auto-popula los 4 dropdowns con los archivos de la sesión seleccionada. Se mantiene compatibilidad total con el flujo manual existente.

## Glosario

- **Bug_Condition (C)**: La condición que dispara el bug — los uploads no tienen campo `sessionId` y no existe mecanismo para auto-seleccionar archivos por sesión en DiscrepanciesPage
- **Property (P)**: El comportamiento deseado — al seleccionar una sesión, los 4 dropdowns se auto-populan con los uploads asociados a esa sesión
- **Preservation**: El flujo manual existente (subir sin sesión, seleccionar archivos individualmente, crear sesión al comparar) debe seguir funcionando sin cambios
- **Upload**: Modelo en DynamoDB que almacena metadatos de archivos CSV subidos (`amplify/data/resource.ts`)
- **Session**: Modelo en DynamoDB que agrupa una reconciliación completa con sus 4 archivos, discrepancias, hallazgos y correcciones
- **UploadRecord**: Tipo TypeScript en `src/types/upload.ts` que representa un registro de upload en el frontend
- **SessionService**: Servicio singleton en `src/services/session.ts` que gestiona operaciones CRUD de sesiones
- **UploadService**: Servicio singleton en `src/services/upload.ts` que gestiona cargas de archivos a S3 y DynamoDB
- **CascadeStage**: Una de las 4 etapas del flujo de reconciliación: geopos_local, geopos_central, integracion, ps_ck_intfc_vtapos

## Detalles del Bug

### Bug Condition

El bug se manifiesta cuando un usuario intenta asociar archivos a una sesión o auto-seleccionar archivos por sesión. El modelo `Upload` no tiene campo `sessionId`, el `UploadService` no acepta `sessionId` al subir, y `DiscrepanciesPage` no ofrece un selector de sesión para auto-popular los dropdowns.

**Especificación Formal:**
```
FUNCTION isBugCondition(input)
  INPUT: input de tipo { action: 'upload' | 'select_files', sessionId?: string }
  OUTPUT: boolean
  
  IF input.action == 'upload' THEN
    RETURN input.sessionId IS NOT NULL
           AND Upload.model NO TIENE campo sessionId
           AND uploadService.uploadFile NO ACEPTA parámetro sessionId
  END IF
  
  IF input.action == 'select_files' THEN
    RETURN input.sessionId IS NOT NULL
           AND DiscrepanciesPage NO TIENE selector de sesión
           AND NO EXISTE método getSessionUploads en SessionService
  END IF
  
  RETURN false
END FUNCTION
```

### Ejemplos

- El usuario sube un archivo CSV en UploadPage y quiere asociarlo a la sesión "Reconciliación Enero 2025" → No hay opción para seleccionar sesión, el archivo queda sin asociación
- El usuario navega a DiscrepanciesPage y quiere cargar los 4 archivos de la sesión "Reconciliación Enero 2025" → No hay selector de sesión, debe buscar manualmente cada archivo en los 4 dropdowns
- El usuario tiene 50 uploads en el historial y necesita encontrar los 4 archivos de una sesión específica → Debe recordar nombres/fechas y buscar uno por uno en cada dropdown
- El usuario sube un archivo sin seleccionar sesión → Funciona correctamente (este caso NO es bug, es el flujo actual que debe preservarse)

## Comportamiento Esperado

### Requisitos de Preservación

**Comportamientos que NO deben cambiar:**
- Subir archivos sin seleccionar sesión debe seguir funcionando exactamente igual
- Seleccionar archivos manualmente en los 4 dropdowns de DiscrepanciesPage debe seguir funcionando
- Hacer clic en "Comparar" sin haber seleccionado una sesión previa debe seguir mostrando el diálogo de nombre de sesión
- El historial de cargas en UploadPage (componente UploadHistory) debe seguir mostrando todos los uploads con filtro por etapa
- SessionDetailPage debe seguir mostrando archivos, discrepancias, hallazgos y correcciones de una sesión

**Alcance:**
Todas las interacciones que NO involucren la nueva funcionalidad de asociación upload-sesión deben ser completamente inalteradas por este fix. Esto incluye:
- Flujo de carga manual sin sesión
- Selección manual de archivos en dropdowns
- Creación de sesión al comparar (flujo existente)
- Consulta de historial de uploads
- Navegación entre páginas

## Causa Raíz Hipotética

Basado en el análisis del bug, las causas raíz son:

1. **Modelo Upload sin campo sessionId**: El modelo `Upload` en `amplify/data/resource.ts` no incluye un campo `sessionId`. Esto impide la relación inversa Upload→Session. Actualmente la relación solo existe en dirección Session→Upload (via `uploadIds` en Session).

2. **UploadService no acepta sessionId**: El método `uploadFile` en `src/services/upload.ts` no tiene parámetro `sessionId`. Al crear el registro en DynamoDB (`client.models.Upload.create`), no se incluye `sessionId`.

3. **Tipo UploadRecord sin sessionId**: El tipo `UploadRecord` en `src/types/upload.ts` no incluye el campo `sessionId`, por lo que el frontend no puede leer ni mostrar la asociación.

4. **FileUploadForm sin selector de sesión**: El componente `FileUploadForm` en `src/components/organisms/FileUploadForm.tsx` no ofrece un selector para elegir una sesión al subir archivos.

5. **DiscrepanciesPage sin selector de sesión**: La página `DiscrepanciesPage` carga todos los uploads globalmente y no tiene un mecanismo para filtrar/auto-seleccionar por sesión.

6. **SessionService sin método getSessionUploads**: El servicio `SessionService` en `src/services/session.ts` no tiene un método para obtener los uploads asociados a una sesión (consultando por `sessionId` en el modelo Upload).

## Correctness Properties

Property 1: Bug Condition - Asociación de uploads a sesión y auto-selección

_For any_ upload realizado con un `sessionId` válido, el registro de Upload en DynamoDB SHALL contener ese `sessionId`, y al seleccionar esa sesión en DiscrepanciesPage, los 4 dropdowns SHALL auto-popularse con los uploads correspondientes (uno por cada CascadeStage).

**Validates: Requirements 2.1, 2.2, 2.3, 2.5**

Property 2: Preservation - Flujo manual sin sesión inalterado

_For any_ interacción que NO involucre la selección de sesión (subir archivos sin sesión, seleccionar archivos manualmente en dropdowns, crear sesión al comparar), el sistema SHALL producir exactamente el mismo comportamiento que el código original, preservando la compatibilidad total con el flujo existente.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Implementación del Fix

### Cambios Requeridos

Asumiendo que nuestro análisis de causa raíz es correcto:

**Archivo**: `amplify/data/resource.ts`

**Modelo**: `Upload`

**Cambio 1 — Agregar campo sessionId al modelo Upload**:
- Agregar `sessionId: a.string()` como campo opcional en el modelo Upload
- Agregar un GSI `sessionId-stage-index` con partition key `sessionId` y sort key `stage` para consultar uploads por sesión y etapa eficientemente

```typescript
Upload: a
  .model({
    uploadId: a.id().required(),
    sessionId: a.string(),  // NUEVO: asociación opcional a sesión
    stage: a.string().required(),
    fileName: a.string().required(),
    fileSize: a.integer(),
    status: a.enum(['uploaded', 'processing', 'transformed', 'compared', 'error']),
    s3Key: a.string().required(),
    uploadedBy: a.string().required(),
    uploadedAt: a.datetime().required(),
    errorMessage: a.string(),
  })
  .identifier(['uploadId'])
  .secondaryIndexes((index) => [
    index('stage').sortKeys(['uploadedAt']).name('stage-date-index'),
    index('status').sortKeys(['uploadedAt']).name('status-date-index'),
    index('sessionId').sortKeys(['stage']).name('sessionId-stage-index'),  // NUEVO
  ])
```

---

**Archivo**: `src/types/upload.ts`

**Tipo**: `UploadRecord`

**Cambio 2 — Agregar sessionId al tipo UploadRecord**:
- Agregar `sessionId?: string` como campo opcional para mantener retrocompatibilidad

---

**Archivo**: `src/services/upload.ts`

**Método**: `uploadFile`

**Cambio 3 — Aceptar sessionId opcional en uploadFile**:
- Agregar parámetro opcional `sessionId?: string` al método `uploadFile`
- Incluir `sessionId` en el `client.models.Upload.create()` si se proporciona
- Actualizar `getUploadHistory` para mapear el campo `sessionId` al tipo `UploadRecord`

---

**Archivo**: `src/services/session.ts`

**Método nuevo**: `getSessionUploads`

**Cambio 4 — Agregar método getSessionUploads a SessionService**:
- Nuevo método `getSessionUploads(sessionId: string): Promise<UploadRecord[]>` que consulta el GSI `sessionId-stage-index` para obtener los uploads asociados a una sesión
- Retorna un array de `UploadRecord` ordenados por etapa

---

**Archivo**: `src/components/organisms/FileUploadForm.tsx`

**Componente**: `FileUploadForm`

**Cambio 5 — Agregar selector de sesión opcional a FileUploadForm**:
- Agregar prop opcional `sessionId?: string` al componente
- Si se proporciona `sessionId`, pasarlo a `uploadService.uploadFile()`
- No cambiar el comportamiento cuando `sessionId` no se proporciona (preservación)

---

**Archivo**: `src/components/pages/UploadPage.tsx`

**Componente**: `UploadPage`

**Cambio 6 — Agregar selector de sesión a UploadPage**:
- Agregar un `Select` opcional para elegir una sesión existente (o "Sin sesión")
- Cargar sesiones con estado `in_progress` usando `sessionService.listSessions({ status: 'in_progress' })`
- Pasar el `sessionId` seleccionado a `FileUploadForm`
- Opción de crear nueva sesión desde aquí (nombre + crear)

---

**Archivo**: `src/components/pages/DiscrepanciesPage.tsx`

**Componente**: `DiscrepanciesPage`

**Cambio 7 — Agregar selector de sesión con auto-populate a DiscrepanciesPage**:
- Agregar un `Select` de sesión encima de los 4 dropdowns de archivos
- Al seleccionar una sesión, llamar a `sessionService.getSessionUploads(sessionId)` para obtener los uploads
- Auto-popular los 4 dropdowns (`selectedUploads`) con los uploadIds correspondientes a cada etapa
- Si la sesión tiene los 4 archivos, habilitar "Comparar" automáticamente
- Si se selecciona una sesión existente con los 4 archivos, al comparar usar esa sesión (no crear nueva)
- Mantener la opción "Sin sesión" que preserva el flujo manual actual

## Estrategia de Testing

### Enfoque de Validación

La estrategia de testing sigue un enfoque de dos fases: primero, generar contraejemplos que demuestren el bug en el código sin corregir, luego verificar que el fix funciona correctamente y preserva el comportamiento existente.

### Exploratory Bug Condition Checking

**Objetivo**: Generar contraejemplos que demuestren el bug ANTES de implementar el fix. Confirmar o refutar el análisis de causa raíz. Si refutamos, necesitaremos re-hipotizar.

**Plan de Test**: Escribir tests que intenten asociar un upload a una sesión y verificar que el campo `sessionId` se almacena. Ejecutar estos tests en el código SIN CORREGIR para observar fallos y entender la causa raíz.

**Casos de Test**:
1. **Test de campo sessionId en Upload**: Verificar que el modelo Upload acepta y almacena `sessionId` (fallará en código sin corregir porque el campo no existe)
2. **Test de getSessionUploads**: Verificar que SessionService puede obtener uploads por sesión (fallará porque el método no existe)
3. **Test de auto-populate en DiscrepanciesPage**: Verificar que al seleccionar una sesión los dropdowns se auto-populan (fallará porque no hay selector de sesión)
4. **Test de uploadFile con sessionId**: Verificar que UploadService acepta `sessionId` como parámetro (fallará porque el parámetro no existe)

**Contraejemplos Esperados**:
- El campo `sessionId` no existe en el modelo Upload de DynamoDB
- El método `getSessionUploads` no existe en SessionService
- Posibles causas: campo faltante en schema, método faltante en servicio, componente UI sin selector

### Fix Checking

**Objetivo**: Verificar que para todos los inputs donde la bug condition se cumple, la función corregida produce el comportamiento esperado.

**Pseudocódigo:**
```
FOR ALL input WHERE isBugCondition(input) DO
  IF input.action == 'upload' AND input.sessionId IS NOT NULL THEN
    result := uploadService_fixed.uploadFile(file, stage, content, user, input.sessionId)
    uploadRecord := getUploadRecord(result.uploadId)
    ASSERT uploadRecord.sessionId == input.sessionId
  END IF
  
  IF input.action == 'select_files' AND input.sessionId IS NOT NULL THEN
    uploads := sessionService_fixed.getSessionUploads(input.sessionId)
    selectedUploads := autoPopulateDropdowns(uploads)
    FOR EACH stage IN CASCADE_STAGES DO
      ASSERT selectedUploads[stage] matches upload with correct stage
    END FOR
  END IF
END FOR
```

### Preservation Checking

**Objetivo**: Verificar que para todos los inputs donde la bug condition NO se cumple, la función corregida produce el mismo resultado que la función original.

**Pseudocódigo:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT uploadService_original.uploadFile(file, stage, content, user)
       = uploadService_fixed.uploadFile(file, stage, content, user)
  
  ASSERT discrepanciesPage_original.manualSelection(uploads)
       = discrepanciesPage_fixed.manualSelection(uploads)
  
  ASSERT sessionService_original.createSession(input)
       = sessionService_fixed.createSession(input)
END FOR
```

**Enfoque de Testing**: Se recomienda property-based testing para preservation checking porque:
- Genera muchos casos de test automáticamente a lo largo del dominio de inputs
- Detecta casos borde que los tests unitarios manuales podrían omitir
- Proporciona garantías fuertes de que el comportamiento no cambia para todos los inputs no-buggy

**Plan de Test**: Observar el comportamiento en código SIN CORREGIR primero para uploads sin sesión y selección manual, luego escribir property-based tests capturando ese comportamiento.

**Casos de Test**:
1. **Preservación de upload sin sesión**: Verificar que subir archivos sin `sessionId` sigue funcionando exactamente igual, el registro no tiene `sessionId`
2. **Preservación de selección manual**: Verificar que seleccionar archivos manualmente en los dropdowns sigue funcionando sin cambios
3. **Preservación de creación de sesión al comparar**: Verificar que el flujo de crear sesión al hacer clic en "Comparar" (sin selector de sesión) sigue funcionando
4. **Preservación de historial de uploads**: Verificar que UploadHistory sigue mostrando todos los uploads con filtro por etapa

### Unit Tests

- Test de campo `sessionId` en modelo Upload (schema Amplify)
- Test de `uploadFile` con y sin `sessionId`
- Test de `getSessionUploads` con sesión que tiene uploads y sesión vacía
- Test de auto-populate de dropdowns al seleccionar sesión
- Test de que "Comparar" usa sesión existente cuando se seleccionó una
- Test de que "Comparar" crea nueva sesión cuando no se seleccionó ninguna (flujo existente)

### Property-Based Tests

- Generar uploads aleatorios con y sin `sessionId` y verificar que los que tienen `sessionId` se pueden consultar por sesión y los que no tienen `sessionId` no aparecen en consultas por sesión
- Generar sesiones aleatorias con diferentes combinaciones de uploads por etapa y verificar que auto-populate asigna correctamente cada upload a su dropdown correspondiente
- Generar secuencias aleatorias de uploads sin sesión y verificar que el comportamiento es idéntico al código original

### Integration Tests

- Test de flujo completo: crear sesión → subir 4 archivos asociados → navegar a DiscrepanciesPage → seleccionar sesión → verificar auto-populate → comparar
- Test de flujo mixto: subir archivos sin sesión → navegar a DiscrepanciesPage → seleccionar manualmente → comparar (flujo existente preservado)
- Test de flujo de UploadPage: seleccionar sesión → subir archivo → verificar que aparece en historial con indicador de sesión
