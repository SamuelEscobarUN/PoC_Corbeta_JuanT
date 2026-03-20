# Documento de Requisitos — Integración con AWS Glue Data Quality

## Introducción

La plataforma de reconciliación de datos actualmente ejecuta reglas de calidad de forma local en el navegador mediante JavaScript (QualityRulesService). Las reglas se evalúan contra datos CSV parseados en memoria y los resultados se persisten en DynamoDB.

Esta integración busca migrar la ejecución de reglas de calidad al servicio AWS Glue Data Quality, utilizando DQDL (Data Quality Definition Language) como lenguaje de definición de reglas. Los archivos CSV almacenados en S3 serán evaluados directamente por Glue Data Quality a través de una función Lambda, eliminando la dependencia de evaluación en el frontend y habilitando validaciones más robustas y escalables.

## Glosario

- **Plataforma**: La aplicación web React + Amplify Gen 2 de reconciliación de datos.
- **DQDL**: Data Quality Definition Language, lenguaje declarativo de AWS Glue para definir reglas de calidad.
- **Glue_Data_Quality**: Servicio de AWS Glue que evalúa reglas de calidad sobre datasets usando DQDL.
- **Ruleset_DQDL**: Conjunto de reglas escritas en sintaxis DQDL que define las validaciones a ejecutar.
- **Lambda_Calidad**: Función AWS Lambda que orquesta la ejecución de reglas de calidad invocando Glue Data Quality.
- **QualityRulesService**: Servicio frontend actual (singleton) que gestiona reglas en memoria y ejecuta evaluaciones locales.
- **CascadeStage**: Etapa de la cascada de reconciliación (geopos_local, geopos_central, integracion, ps_ck_intfc_vtapos).
- **Sesión_de_Trabajo**: Agrupación lógica de uploads que se procesan juntos en la plataforma.
- **QualityResult**: Tabla DynamoDB donde se persisten los resultados de ejecución de reglas.
- **Administrador**: Usuario con rol Administrator en Cognito, autorizado para gestionar reglas de calidad.
- **Operador**: Usuario con rol Operator en Cognito, autorizado para ejecutar reglas y ver resultados.
- **Traductor_DQDL**: Componente que convierte la configuración de reglas de la Plataforma a sintaxis DQDL válida.

## Requisitos

### Requisito 1: Persistencia de reglas de calidad en DynamoDB

**User Story:** Como Administrador, quiero que las reglas de calidad se persistan en DynamoDB en lugar de memoria local, para que las reglas sobrevivan recargas de página y estén disponibles para todos los usuarios.

#### Criterios de Aceptación

1. THE Plataforma SHALL almacenar las reglas de calidad en una tabla DynamoDB dedicada (QualityRule) con los campos: ruleId, ruleName, stage, type, expression, targetColumn, threshold, enabled, createdAt y updatedBy.
2. WHEN un Administrador crea una regla de calidad, THE Plataforma SHALL persistir la regla en DynamoDB y confirmar la creación al usuario.
3. WHEN un Administrador actualiza una regla de calidad, THE Plataforma SHALL actualizar el registro correspondiente en DynamoDB y reflejar los cambios en la interfaz.
4. WHEN un Administrador elimina una regla de calidad, THE Plataforma SHALL eliminar el registro de DynamoDB y remover la regla de la lista visible.
5. WHEN un usuario carga la página de reglas de calidad, THE Plataforma SHALL obtener las reglas desde DynamoDB en lugar de la memoria local.

---

### Requisito 2: Traducción de reglas a DQDL

**User Story:** Como Administrador, quiero que las reglas de calidad configuradas en la plataforma se traduzcan automáticamente a sintaxis DQDL, para que puedan ser ejecutadas por AWS Glue Data Quality.

#### Criterios de Aceptación

1. THE Traductor_DQDL SHALL convertir reglas de tipo "completeness" a la expresión DQDL `Completeness <columna> >= <umbral>`.
2. THE Traductor_DQDL SHALL convertir reglas de tipo "uniqueness" a la expresión DQDL `Uniqueness <columna> >= <umbral>`.
3. THE Traductor_DQDL SHALL convertir reglas de tipo "range" a la expresión DQDL `ColumnValues "<columna>" between <min> and <max>`.
4. THE Traductor_DQDL SHALL convertir reglas de tipo "format" a la expresión DQDL `ColumnValues "<columna>" matches "<regex>"`.
5. THE Traductor_DQDL SHALL pasar reglas de tipo "custom" directamente como expresiones DQDL sin transformación.
6. THE Traductor_DQDL SHALL generar un Ruleset_DQDL válido agrupando todas las reglas activas de una CascadeStage en un bloque `Rules = [ ... ]`.
7. IF una regla tiene una expresión DQDL inválida, THEN THE Traductor_DQDL SHALL retornar un error descriptivo indicando la regla y el problema de sintaxis.
8. FOR ALL Ruleset_DQDL válidos, traducir a texto y parsear de vuelta SHALL producir un conjunto de reglas equivalente (propiedad round-trip).

---

### Requisito 3: Ejecución de reglas vía Lambda y Glue Data Quality

**User Story:** Como Operador, quiero que las reglas de calidad se ejecuten en el backend usando AWS Glue Data Quality, para obtener resultados confiables sin depender del procesamiento del navegador.

#### Criterios de Aceptación

1. WHEN un Operador solicita la ejecución de reglas de calidad para un upload, THE Plataforma SHALL invocar la Lambda_Calidad a través de una query personalizada de AppSync.
2. WHEN la Lambda_Calidad recibe una solicitud de ejecución, THE Lambda_Calidad SHALL obtener las reglas activas de la CascadeStage correspondiente desde DynamoDB.
3. WHEN la Lambda_Calidad tiene las reglas activas, THE Lambda_Calidad SHALL traducir las reglas a un Ruleset_DQDL usando el Traductor_DQDL.
4. WHEN el Ruleset_DQDL está listo, THE Lambda_Calidad SHALL crear un Glue Data Quality run apuntando al archivo CSV en S3 correspondiente al upload.
5. WHEN Glue_Data_Quality completa la evaluación, THE Lambda_Calidad SHALL mapear los resultados de cada regla al formato QualityResultRecord de la Plataforma.
6. WHEN los resultados están mapeados, THE Lambda_Calidad SHALL persistir cada resultado individual en la tabla QualityResult de DynamoDB.
7. THE Lambda_Calidad SHALL retornar un QualityExecutionSummary con el conteo de reglas pasadas, fallidas y los detalles individuales.
8. IF Glue_Data_Quality falla durante la ejecución, THEN THE Lambda_Calidad SHALL retornar un error con el mensaje descriptivo de la falla y registrar el error en CloudWatch.

---

### Requisito 4: Integración del frontend con la ejecución backend

**User Story:** Como Operador, quiero ejecutar las reglas de calidad desde la interfaz y ver los resultados en tiempo real, para validar la calidad de los datos cargados sin salir de la plataforma.

#### Criterios de Aceptación

1. WHEN un Operador presiona el botón "Ejecutar Reglas" en la página de detalle de sesión o de upload, THE Plataforma SHALL invocar la query de AppSync para ejecutar reglas de calidad en el backend.
2. WHILE la ejecución de reglas está en progreso, THE Plataforma SHALL mostrar un indicador de carga con el texto "Ejecutando reglas de calidad...".
3. WHEN la ejecución de reglas finaliza con éxito, THE Plataforma SHALL mostrar el resumen de resultados con el conteo de reglas pasadas y fallidas.
4. WHEN la ejecución de reglas finaliza con éxito, THE Plataforma SHALL actualizar la pestaña "Resultados de Ejecución" en la página QualityRulesPage con los nuevos resultados.
5. IF la ejecución de reglas falla, THEN THE Plataforma SHALL mostrar un mensaje de error descriptivo al usuario.
6. THE Plataforma SHALL deshabilitar el botón "Ejecutar Reglas" cuando no haya reglas activas configuradas para la CascadeStage del upload.

---

### Requisito 5: Generación de alertas por reglas fallidas

**User Story:** Como Administrador, quiero recibir alertas cuando las reglas de calidad fallan, para tomar acciones correctivas de forma oportuna.

#### Criterios de Aceptación

1. WHEN una regla de calidad falla durante la ejecución, THE Lambda_Calidad SHALL generar una alerta con severidad basada en el porcentaje de cumplimiento.
2. WHEN el porcentaje de cumplimiento es menor a 25%, THE Lambda_Calidad SHALL asignar severidad "critical" a la alerta.
3. WHEN el porcentaje de cumplimiento está entre 25% y 49%, THE Lambda_Calidad SHALL asignar severidad "high" a la alerta.
4. WHEN el porcentaje de cumplimiento está entre 50% y 74%, THE Lambda_Calidad SHALL asignar severidad "medium" a la alerta.
5. WHEN el porcentaje de cumplimiento es 75% o mayor pero inferior al umbral de la regla, THE Lambda_Calidad SHALL asignar severidad "low" a la alerta.
6. WHEN se genera una alerta, THE Plataforma SHALL mostrar la alerta en la interfaz con un indicador visual de severidad (color y etiqueta).

---

### Requisito 6: Validación de expresiones DQDL en la interfaz

**User Story:** Como Administrador, quiero que la plataforma valide la sintaxis DQDL de las expresiones al crear o editar reglas, para evitar errores en tiempo de ejecución.

#### Criterios de Aceptación

1. WHEN un Administrador ingresa una expresión en el formulario de regla, THE Plataforma SHALL validar la sintaxis DQDL antes de permitir guardar la regla.
2. IF la expresión DQDL tiene errores de sintaxis, THEN THE Plataforma SHALL mostrar un mensaje de error indicando el problema específico debajo del campo de expresión.
3. THE Plataforma SHALL proporcionar ejemplos de expresiones DQDL válidas como texto de ayuda en el formulario de creación de reglas, organizados por tipo de regla.
4. WHEN el tipo de regla seleccionado es "completeness", "uniqueness", "range" o "format", THE Plataforma SHALL generar automáticamente una expresión DQDL base que el Administrador pueda modificar.

---

### Requisito 7: Consulta de resultados históricos

**User Story:** Como Operador, quiero consultar los resultados históricos de ejecución de reglas de calidad, para analizar tendencias y detectar problemas recurrentes.

#### Criterios de Aceptación

1. THE Plataforma SHALL mostrar en la pestaña "Resultados de Ejecución" todos los resultados almacenados en DynamoDB, ordenados por fecha de ejecución descendente.
2. WHEN un Operador filtra resultados por CascadeStage, THE Plataforma SHALL mostrar únicamente los resultados correspondientes a la etapa seleccionada.
3. WHEN un Operador selecciona un resultado de ejecución, THE Plataforma SHALL mostrar los detalles individuales de cada regla evaluada incluyendo: nombre de regla, resultado (pasó/falló), registros evaluados, porcentaje de cumplimiento y mensaje descriptivo.
4. THE Plataforma SHALL permitir filtrar resultados por rango de fechas.

---

### Requisito 8: Permisos y autorización

**User Story:** Como Administrador, quiero que solo los usuarios autorizados puedan gestionar y ejecutar reglas de calidad, para mantener la integridad de la configuración.

#### Criterios de Aceptación

1. THE Plataforma SHALL permitir únicamente a usuarios con rol Administrador crear, editar y eliminar reglas de calidad.
2. THE Plataforma SHALL permitir a usuarios con rol Administrador y Operador ejecutar reglas de calidad y consultar resultados.
3. THE Lambda_Calidad SHALL validar que la solicitud proviene de un usuario autenticado con rol Administrador u Operador antes de ejecutar las reglas.
4. IF un usuario sin los permisos requeridos intenta una operación restringida, THEN THE Plataforma SHALL mostrar un mensaje indicando que la operación requiere permisos adicionales.
