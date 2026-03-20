# Plan de Implementación: Integración con AWS Glue Data Quality

## Resumen

Migrar el motor de evaluación de reglas de calidad desde el frontend (evaluación en memoria) hacia AWS Glue Data Quality ejecutado vía Lambda. Se implementa en orden incremental: tipos → traductor DQDL → modelo DynamoDB → Lambda → servicio frontend → UI.

## Tareas

- [x] 1. Actualizar tipos e interfaces base
  - [x] 1.1 Actualizar `src/types/quality.ts` con las nuevas interfaces
    - Agregar `DqdlTranslationResult`, `DqdlError`, `ResultFilters`
    - Agregar campo `alerts` a `QualityExecutionSummary`
    - _Requisitos: 1.1, 2.7, 7.2, 7.4_

- [x] 2. Implementar el traductor DQDL
  - [x] 2.1 Crear módulo `src/services/dqdl-translator.ts`
    - Implementar `translateSingleRule()` con mapeo por tipo: completeness → `Completeness "col" >= umbral`, uniqueness → `Uniqueness "col" >= umbral`, range → `ColumnValues "col" between min and max`, format → `ColumnValues "col" matches "regex"`, custom → pass-through
    - Implementar `translateRulesToDqdl()` que genera el bloque `Rules = [ ... ]`
    - Implementar `validateDqdlExpression()` para validación de sintaxis
    - Implementar `parseDqdlRuleset()` para round-trip testing
    - Implementar `generateBaseExpression(type, column)` para auto-generación de expresiones base
    - Manejar errores: regla sin targetColumn, rango inválido, regex inválida, custom vacío
    - _Requisitos: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 6.1, 6.4_

  - [x] 2.2 Escribir test de propiedad para traducción por tipo
    - **Propiedad 4: Traducción de tipo de regla a formato DQDL**
    - **Valida: Requisitos 2.1, 2.2, 2.3, 2.4, 2.5**

  - [x] 2.3 Escribir test de propiedad para estructura de ruleset
    - **Propiedad 5: Estructura de Ruleset DQDL**
    - **Valida: Requisito 2.6**

  - [x] 2.4 Escribir test de propiedad para errores en expresiones inválidas
    - **Propiedad 6: Error en expresión DQDL inválida**
    - **Valida: Requisito 2.7**

  - [x] 2.5 Escribir test de propiedad para round-trip DQDL
    - **Propiedad 7: Round-trip de traducción DQDL**
    - **Valida: Requisito 2.8**

  - [x] 2.6 Escribir test de propiedad para validación de expresiones inválidas
    - **Propiedad 12: Validación DQDL rechaza expresiones inválidas**
    - **Valida: Requisito 6.1**

  - [x] 2.7 Escribir test de propiedad para generación de expresión base por tipo
    - **Propiedad 13: Generación de expresión DQDL base por tipo**
    - **Valida: Requisito 6.4**

- [x] 3. Checkpoint — Verificar traductor DQDL
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [x] 4. Agregar modelo QualityRule en el schema de Amplify Data
  - [x] 4.1 Agregar modelo `QualityRule` en `amplify/data/resource.ts`
    - Definir campos: ruleId, ruleName, stage, type, expression, targetColumn, threshold, enabled, createdAt, updatedBy
    - Configurar identifier `['ruleId']`
    - Configurar GSI `stage-index` con sortKey `createdAt`
    - Configurar autorización: Administrator (CRUD completo), Operator (solo lectura)
    - _Requisitos: 1.1, 8.1, 8.2_

  - [x] 4.2 Agregar custom query `executeQualityRules` en `amplify/data/resource.ts`
    - Definir argumentos: `uploadId` (string, required), `stage` (string, required)
    - Retorna `a.string()` (JSON stringificado)
    - Handler apunta a la función Lambda `quality-evaluator`
    - Autorización: Administrator y Operator
    - _Requisitos: 3.1, 8.2, 8.3_

- [x] 5. Implementar Lambda quality-evaluator
  - [x] 5.1 Crear `amplify/functions/quality-evaluator/resource.ts`
    - Definir la función Lambda con `defineFunction`
    - Configurar entry point al handler
    - _Requisitos: 3.1_

  - [x] 5.2 Crear `amplify/functions/quality-evaluator/handler.ts`
    - Implementar handler de AppSync que recibe `uploadId` y `stage`
    - Leer reglas activas de DynamoDB filtradas por stage y enabled=true
    - Obtener metadata del upload (s3Key) desde DynamoDB
    - Traducir reglas a DQDL usando el traductor
    - Invocar Glue Data Quality `StartDataQualityRulesetEvaluationRun` y `GetDataQualityResult`
    - Implementar mapper de resultados Glue → `QualityResultRecord`
    - Implementar generador de alertas con severidad por compliance
    - Implementar builder de `QualityExecutionSummary` con conteos
    - Persistir resultados en tabla QualityResult vía DynamoDB
    - Manejar errores: upload no encontrado, sin reglas activas, error DQDL, fallo Glue, CSV no encontrado en S3
    - _Requisitos: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 5.3 Escribir test de propiedad para mapeo de resultados Glue
    - **Propiedad 9: Mapeo de resultados Glue a QualityResultRecord**
    - **Valida: Requisito 3.5**

  - [x] 5.4 Escribir test de propiedad para invariante de conteos
    - **Propiedad 10: Invariante de conteos en resumen de ejecución**
    - **Valida: Requisito 3.7**

  - [x] 5.5 Escribir test de propiedad para severidad de alertas
    - **Propiedad 11: Determinación de severidad de alertas**
    - **Valida: Requisitos 5.1, 5.2, 5.3, 5.4, 5.5**

  - [x] 5.6 Escribir test de propiedad para campos requeridos en resultados
    - **Propiedad 16: Detalles de resultado contienen campos requeridos**
    - **Valida: Requisito 7.3**

- [x] 6. Registrar Lambda en backend y configurar permisos
  - [x] 6.1 Actualizar `amplify/backend.ts`
    - Importar y registrar `qualityEvaluatorFn` en `defineBackend`
    - Agregar permisos IAM para Glue Data Quality (`glue:StartDataQualityRulesetEvaluationRun`, `glue:GetDataQualityResult`, `glue:GetDataQualityRulesetEvaluationRun`)
    - Agregar permisos de lectura S3 para el bucket de uploads
    - Agregar permisos DynamoDB para leer QualityRule y escribir QualityResult
    - Pasar variables de entorno necesarias (TABLE_NAME, BUCKET_NAME)
    - _Requisitos: 3.1, 3.4, 8.3_

- [x] 7. Checkpoint — Verificar infraestructura backend
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [x] 8. Refactorizar QualityRulesService para usar backend
  - [x] 8.1 Refactorizar `src/services/quality-rules.ts`
    - Cambiar CRUD para operar contra DynamoDB vía `client.models.QualityRule` en lugar del `Map` en memoria
    - Cambiar `createRule`, `updateRule`, `deleteRule`, `listRules`, `getRule` a métodos async
    - Cambiar `executeRules()` para invocar la query AppSync `executeQualityRules` en lugar de evaluar localmente
    - Agregar método `validateExpression()` que usa el traductor DQDL
    - Agregar método `getExecutionResults()` para consultar resultados históricos con filtros
    - Eliminar el motor de evaluación local (evaluateRule, evaluateCompleteness, evaluateUniqueness, evaluateRange, evaluateFormat, evaluateCustom)
    - _Requisitos: 1.2, 1.3, 1.4, 1.5, 3.1, 4.1, 6.1, 7.1, 7.2, 7.4_

  - [x] 8.2 Escribir test de propiedad para round-trip de creación
    - **Propiedad 1: Round-trip de creación de regla**
    - **Valida: Requisitos 1.1, 1.2**

  - [x] 8.3 Escribir test de propiedad para round-trip de actualización
    - **Propiedad 2: Round-trip de actualización de regla**
    - **Valida: Requisito 1.3**

  - [x] 8.4 Escribir test de propiedad para eliminación
    - **Propiedad 3: Eliminación remueve la regla**
    - **Valida: Requisito 1.4**

  - [x] 8.5 Escribir test de propiedad para filtrado por etapa
    - **Propiedad 8: Filtrado de reglas por etapa**
    - **Valida: Requisito 3.2**

  - [x] 8.6 Escribir test de propiedad para orden por fecha descendente
    - **Propiedad 14: Resultados ordenados por fecha descendente**
    - **Valida: Requisito 7.1**

  - [x] 8.7 Escribir test de propiedad para filtrado de resultados
    - **Propiedad 15: Filtrado de resultados por etapa y rango de fechas**
    - **Valida: Requisitos 7.2, 7.4**

- [x] 9. Checkpoint — Verificar servicio refactorizado
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

- [x] 10. Actualizar QualityRulesPage para integración con backend
  - [x] 10.1 Actualizar `src/components/pages/QualityRulesPage.tsx`
    - Cambiar llamadas al servicio a async/await (createRule, updateRule, deleteRule, listRules)
    - Agregar botón "Ejecutar Reglas" con indicador de carga ("Ejecutando reglas de calidad...")
    - Deshabilitar botón cuando no hay reglas activas para la etapa
    - Mostrar resumen de resultados (passed/failed) al completar ejecución
    - Mostrar alertas con chips de color por severidad (critical=rojo, high=naranja, medium=amarillo, low=azul)
    - Mostrar mensajes de error descriptivos cuando la ejecución falla
    - _Requisitos: 4.1, 4.2, 4.3, 4.5, 4.6, 5.6_

  - [x] 10.2 Agregar validación DQDL en el formulario de reglas
    - Integrar `validateDqdlExpression()` para validación en tiempo real al editar expresión
    - Mostrar error inline debajo del campo de expresión si la sintaxis es inválida
    - Auto-generar expresión base al seleccionar tipo de regla usando `generateBaseExpression()`
    - Agregar texto de ayuda con ejemplos DQDL por tipo de regla
    - _Requisitos: 6.1, 6.2, 6.3, 6.4_

  - [x] 10.3 Actualizar pestaña "Resultados de Ejecución"
    - Cargar resultados históricos desde DynamoDB vía `getExecutionResults()`
    - Agregar filtro por CascadeStage
    - Agregar filtro por rango de fechas
    - Mostrar resultados ordenados por fecha descendente
    - Mostrar detalles individuales: nombre de regla, resultado, registros evaluados, porcentaje de cumplimiento, mensaje
    - _Requisitos: 4.4, 7.1, 7.2, 7.3, 7.4_

  - [x] 10.4 Implementar control de permisos en la UI
    - Ocultar botones de crear/editar/eliminar para usuarios Operador
    - Mostrar mensaje de permisos insuficientes si un usuario no autorizado intenta una operación restringida
    - _Requisitos: 8.1, 8.2, 8.4_

- [x] 11. Checkpoint final — Verificar integración completa
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.

## Notas

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia requisitos específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- Los tests de propiedad usan `fast-check` con Vitest y validan propiedades universales de correctitud
- Los tests unitarios validan ejemplos específicos y casos borde
