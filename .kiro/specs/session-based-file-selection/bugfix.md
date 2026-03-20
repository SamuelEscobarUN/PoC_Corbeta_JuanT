# Documento de Requisitos de Bugfix

## Introducción

La implementación actual de sesiones de trabajo no vincula las cargas de archivos con las sesiones. Los archivos se suben de forma independiente en `UploadPage` y luego en `DiscrepanciesPage` el usuario debe seleccionar manualmente los 4 archivos CSV (geopos_local, geopos_central, integracion, ps_ck_intfc_vtapos) mediante dropdowns individuales. La sesión se crea recién al hacer clic en "Comparar", después de seleccionar los archivos.

Esto genera confusión porque:
- No queda claro qué archivos pertenecen a qué sesión
- El historial de cargas es global, no filtrado por sesión
- El usuario debe recordar cuáles archivos corresponden a cada reconciliación
- No se puede simplificar la selección eligiendo una sesión para auto-cargar sus 4 archivos

El flujo correcto debería permitir: crear/seleccionar una sesión primero, subir archivos dentro del contexto de esa sesión, y en la hoja de discrepancias poder elegir una sesión para que se carguen automáticamente los 4 archivos asociados.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN el usuario sube archivos CSV en UploadPage THEN el sistema los almacena sin asociación a ninguna sesión de trabajo, quedando como registros globales sin contexto de sesión

1.2 WHEN el usuario navega a DiscrepanciesPage para comparar archivos THEN el sistema muestra 4 dropdowns individuales con TODOS los uploads del historial global, obligando al usuario a identificar y seleccionar manualmente cada archivo de cada etapa

1.3 WHEN el usuario hace clic en "Comparar" en DiscrepanciesPage THEN el sistema crea la sesión en ese momento (post-selección de archivos), en lugar de permitir que la sesión exista previamente con sus archivos ya asociados

1.4 WHEN el usuario quiere reutilizar los archivos de una sesión anterior para revisión o re-comparación THEN el sistema no ofrece ningún mecanismo para cargar automáticamente los 4 archivos de una sesión existente, obligando a buscarlos manualmente en los dropdowns

1.5 WHEN el modelo Session almacena uploadIds THEN el sistema los registra como referencia al momento de crear la sesión (al comparar), pero los registros de Upload en DynamoDB no contienen un campo sessionId que permita la relación inversa

### Expected Behavior (Correct)

2.1 WHEN el usuario sube archivos CSV en UploadPage THEN el sistema SHALL permitir asociar opcionalmente la carga a una sesión de trabajo existente (o crear una nueva), almacenando el sessionId en el registro de Upload

2.2 WHEN el usuario navega a DiscrepanciesPage THEN el sistema SHALL mostrar un selector de sesión que, al elegir una sesión, auto-popule los 4 dropdowns de archivos con los uploads asociados a esa sesión (uno por cada etapa de cascada)

2.3 WHEN el usuario selecciona una sesión en DiscrepanciesPage THEN el sistema SHALL cargar automáticamente los 4 archivos correspondientes (geopos_local, geopos_central, integracion, ps_ck_intfc_vtapos) sin intervención manual adicional

2.4 WHEN el usuario selecciona una sesión en DiscrepanciesPage y la sesión tiene los 4 archivos asociados THEN el sistema SHALL habilitar el botón "Comparar" automáticamente, permitiendo ejecutar la comparación sin necesidad de crear una nueva sesión

2.5 WHEN el usuario sube archivos asociados a una sesión THEN el sistema SHALL almacenar el sessionId en el registro de Upload en DynamoDB, permitiendo consultar los uploads por sesión

### Unchanged Behavior (Regression Prevention)

3.1 WHEN el usuario sube archivos sin seleccionar una sesión THEN el sistema SHALL CONTINUE TO permitir la carga de archivos de forma independiente (sin sesión), manteniendo la compatibilidad con el flujo actual

3.2 WHEN el usuario selecciona archivos manualmente en los dropdowns de DiscrepanciesPage (sin usar el selector de sesión) THEN el sistema SHALL CONTINUE TO permitir la comparación manual seleccionando archivos individuales

3.3 WHEN el usuario hace clic en "Comparar" sin haber seleccionado una sesión previa THEN el sistema SHALL CONTINUE TO mostrar el diálogo de nombre de sesión para crear una nueva sesión antes de comparar

3.4 WHEN el usuario consulta el historial de cargas en UploadPage THEN el sistema SHALL CONTINUE TO mostrar todos los uploads con filtro por etapa, sin romper la funcionalidad existente del componente UploadHistory

3.5 WHEN el usuario navega a SessionDetailPage para ver los detalles de una sesión THEN el sistema SHALL CONTINUE TO mostrar los archivos, discrepancias, hallazgos y correcciones asociados a esa sesión
