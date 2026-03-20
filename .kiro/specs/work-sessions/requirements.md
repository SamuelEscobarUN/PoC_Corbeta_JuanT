# Documento de Requisitos — Sesiones de Trabajo

## Introducción

La plataforma de reconciliación de datos actualmente ejecuta comparaciones entre 4 archivos CSV (geopos_local, geopos_central, integracion, ps_ck_intfc_vtapos) y genera discrepancias, hallazgos IA y correcciones. Sin embargo, toda esta información se pierde al cambiar de contexto porque no existe un modelo de sesión que agrupe y persista el ciclo completo de trabajo. Esta funcionalidad introduce el concepto de **Sesión de Trabajo** para que los usuarios puedan guardar, listar y consultar sesiones pasadas con todos sus artefactos asociados. Adicionalmente, se incluyen mejoras de UI/UX en tipografía, bordes y fluidez visual.

## Glosario

- **Plataforma**: La aplicación web de reconciliación de datos construida con React, TypeScript, AWS Amplify, AppSync y DynamoDB.
- **Sesion**: Entidad que agrupa una ejecución completa de comparación, incluyendo los 4 archivos subidos, las discrepancias detectadas, los hallazgos IA generados y las correcciones propuestas.
- **Servicio_de_Sesiones**: Módulo de servicio del frontend responsable de crear, listar, obtener y actualizar sesiones de trabajo mediante el cliente Amplify Data.
- **Pagina_de_Sesiones**: Página del frontend que muestra el listado de sesiones pasadas y permite navegar al detalle de cada una.
- **Pagina_de_Detalle_Sesion**: Vista que muestra toda la información asociada a una sesión específica (archivos, discrepancias, hallazgos, correcciones).
- **Modelo_Session**: Modelo de datos en DynamoDB (definido en el esquema Amplify) que almacena los metadatos de una sesión de trabajo.
- **Estado_de_Sesion**: Valor que indica la fase actual de una sesión: `in_progress`, `completed` o `archived`.
- **Etapa_Cascada**: Una de las 4 etapas del flujo de reconciliación: geopos_local (referencia), geopos_central, integracion, ps_ck_intfc_vtapos.
- **Tema_Visual**: Configuración del tema MUI que define tipografía, bordes, colores y espaciado de la plataforma.
- **Barra_Lateral**: Componente de navegación lateral (Drawer) del MainLayout que permite acceder a las distintas secciones de la plataforma.

## Requisitos

### Requisito 1: Modelo de datos de sesión

**Historia de Usuario:** Como operador, quiero que exista un modelo de sesión en la base de datos, para que cada comparación quede registrada con un nombre, fecha, estado y referencias a los archivos utilizados.

#### Criterios de Aceptación

1. THE Modelo_Session SHALL almacenar los campos: sessionId (identificador único), sessionName (nombre descriptivo), status (Estado_de_Sesion), createdBy (usuario que creó la sesión), createdAt (fecha de creación), completedAt (fecha de finalización opcional), y uploadIds (lista de los 4 identificadores de archivos asociados).
2. THE Modelo_Session SHALL utilizar sessionId como clave primaria.
3. THE Modelo_Session SHALL incluir un índice secundario por status y createdAt para permitir consultas ordenadas por fecha dentro de un estado.
4. THE Modelo_Session SHALL otorgar autorización de lectura y escritura a los grupos Administrator y Operator.
5. WHEN se crea una Sesion, THE Plataforma SHALL asignar el estado `in_progress` como valor inicial del campo status.

### Requisito 2: Creación de sesión al comparar

**Historia de Usuario:** Como operador, quiero que al ejecutar una comparación se cree automáticamente una sesión de trabajo, para que las discrepancias queden asociadas a esa sesión desde el inicio.

#### Criterios de Aceptación

1. WHEN el usuario hace clic en "Comparar" en la página de discrepancias, THE Plataforma SHALL solicitar un nombre para la sesión mediante un diálogo modal antes de iniciar la comparación.
2. WHEN el usuario confirma el nombre de la sesión, THE Servicio_de_Sesiones SHALL crear un registro de Sesion en DynamoDB con el nombre proporcionado, los 4 uploadIds seleccionados, el usuario actual como createdBy y el estado `in_progress`.
3. WHEN la Sesion se crea exitosamente, THE Plataforma SHALL utilizar el sessionId generado para asociar todas las discrepancias guardadas en esa comparación.
4. IF el usuario cancela el diálogo de nombre de sesión, THEN THE Plataforma SHALL cancelar la operación de comparación sin crear ningún registro.

### Requisito 3: Asociación de hallazgos y correcciones a la sesión

**Historia de Usuario:** Como operador, quiero que los hallazgos IA y las correcciones generadas queden vinculados a la sesión activa, para poder consultarlos posteriormente como parte del historial completo.

#### Criterios de Aceptación

1. WHEN se generan hallazgos IA para una comparación, THE Plataforma SHALL asociar cada hallazgo al sessionId de la sesión activa.
2. WHEN se propone una corrección desde la página de remediación, THE Plataforma SHALL asociar la corrección al sessionId de la sesión activa.
3. WHILE una Sesion tiene estado `in_progress`, THE Plataforma SHALL permitir agregar hallazgos y correcciones a esa sesión.
4. WHEN todas las correcciones de una sesión han sido aprobadas o rechazadas, THE Plataforma SHALL permitir al usuario marcar la sesión como `completed`.

### Requisito 4: Listado de sesiones pasadas

**Historia de Usuario:** Como operador, quiero ver un listado de todas las sesiones de trabajo anteriores, para poder seleccionar y consultar cualquier sesión pasada.

#### Criterios de Aceptación

1. THE Pagina_de_Sesiones SHALL mostrar una tabla con las columnas: nombre de sesión, fecha de creación, estado, usuario creador, cantidad de discrepancias y cantidad de hallazgos.
2. THE Pagina_de_Sesiones SHALL ordenar las sesiones por fecha de creación en orden descendente (más recientes primero).
3. THE Pagina_de_Sesiones SHALL permitir filtrar sesiones por estado (in_progress, completed, archived).
4. THE Pagina_de_Sesiones SHALL permitir buscar sesiones por nombre mediante un campo de texto.
5. WHEN el usuario hace clic en una sesión del listado, THE Plataforma SHALL navegar a la Pagina_de_Detalle_Sesion correspondiente.

### Requisito 5: Detalle de sesión

**Historia de Usuario:** Como operador, quiero poder abrir una sesión pasada y ver todos sus artefactos (archivos, discrepancias, hallazgos, correcciones), para poder consultar el historial completo de una reconciliación.

#### Criterios de Aceptación

1. THE Pagina_de_Detalle_Sesion SHALL mostrar la información general de la sesión: nombre, fecha, estado y usuario creador.
2. THE Pagina_de_Detalle_Sesion SHALL mostrar los 4 archivos asociados a la sesión con su nombre, etapa y fecha de carga.
3. THE Pagina_de_Detalle_Sesion SHALL mostrar las discrepancias de la sesión en una tabla con las mismas columnas que la página de discrepancias actual (factura, tipo, etapa, totales, diferencia, presencia).
4. THE Pagina_de_Detalle_Sesion SHALL mostrar los hallazgos IA asociados a la sesión con severidad, explicación, causa probable y recomendación.
5. THE Pagina_de_Detalle_Sesion SHALL mostrar las correcciones asociadas a la sesión con su estado, acción y fechas.
6. THE Pagina_de_Detalle_Sesion SHALL organizar archivos, discrepancias, hallazgos y correcciones en pestañas separadas para facilitar la navegación.

### Requisito 6: Gestión de estado de sesión

**Historia de Usuario:** Como operador, quiero poder cambiar el estado de una sesión (en progreso, completada, archivada), para mantener organizado el historial de reconciliaciones.

#### Criterios de Aceptación

1. WHILE una Sesion tiene estado `in_progress`, THE Plataforma SHALL mostrar un botón para marcar la sesión como `completed`.
2. WHILE una Sesion tiene estado `completed`, THE Plataforma SHALL mostrar un botón para archivar la sesión (cambiar a `archived`).
3. WHILE una Sesion tiene estado `archived`, THE Plataforma SHALL mostrar la sesión en modo solo lectura sin opciones de modificación.
4. WHEN el usuario cambia el estado de una sesión a `completed`, THE Servicio_de_Sesiones SHALL registrar la fecha actual en el campo completedAt.

### Requisito 7: Navegación a sesiones desde la barra lateral

**Historia de Usuario:** Como usuario, quiero acceder a la sección de sesiones desde el menú lateral, para poder navegar fácilmente al historial de sesiones de trabajo.

#### Criterios de Aceptación

1. THE Barra_Lateral SHALL incluir un elemento de navegación llamado "Sesiones" con un ícono representativo, visible para los roles Administrator y Operator.
2. WHEN el usuario hace clic en "Sesiones" en la Barra_Lateral, THE Plataforma SHALL navegar a la Pagina_de_Sesiones.
3. WHILE la Barra_Lateral está colapsada, THE Plataforma SHALL mostrar únicamente el ícono de "Sesiones" con un tooltip que indique el nombre de la sección.

### Requisito 8: Mejoras de tipografía y fluidez visual

**Historia de Usuario:** Como usuario, quiero que la plataforma tenga una tipografía más legible y una experiencia visual más fluida, para trabajar de forma más cómoda durante períodos prolongados.

#### Criterios de Aceptación

1. THE Tema_Visual SHALL utilizar la familia tipográfica "Inter" como fuente principal, con "Roboto" como respaldo.
2. THE Tema_Visual SHALL definir pesos tipográficos diferenciados: 600 para encabezados (h1-h6) y 400 para texto de cuerpo.
3. THE Tema_Visual SHALL aplicar un interlineado de 1.6 para texto de cuerpo (body1, body2) para mejorar la legibilidad.
4. THE Tema_Visual SHALL aplicar transiciones CSS de 200ms en los componentes interactivos (botones, tarjetas, filas de tabla) para lograr una experiencia visual fluida.

### Requisito 9: Bordes redondeados y suavizados

**Historia de Usuario:** Como usuario, quiero que los componentes de la plataforma tengan bordes más suaves y redondeados, para que la interfaz se vea más moderna y agradable.

#### Criterios de Aceptación

1. THE Tema_Visual SHALL definir un borderRadius base de 12px para el tema global.
2. THE Tema_Visual SHALL aplicar un borderRadius de 16px a los componentes Card y Paper.
3. THE Tema_Visual SHALL aplicar un borderRadius de 20px a los componentes Button.
4. THE Tema_Visual SHALL aplicar un borderRadius de 12px a los componentes TableContainer.
5. THE Tema_Visual SHALL aplicar un borderRadius de 8px a los componentes Chip.

### Requisito 10: Visibilidad del botón de colapsar la barra lateral

**Historia de Usuario:** Como usuario, quiero poder ver y usar el botón para ocultar/mostrar el menú lateral, porque actualmente el botón existe pero no es visible ya que el AppBar (header) se superpone sobre él, impidiendo su uso.

#### Criterios de Aceptación

1. THE Barra_Lateral SHALL garantizar que el botón de colapsar/expandir sea visible y accesible en todo momento, sin quedar oculto detrás del AppBar.
2. THE Barra_Lateral SHALL posicionar el área del Toolbar (donde reside el botón de colapsar) debajo del AppBar, utilizando un margen o padding superior equivalente a la altura del AppBar para evitar superposición.
3. WHEN el usuario hace clic en el botón de colapsar, THE Barra_Lateral SHALL alternar entre el estado expandido (240px) y colapsado (64px) con una transición visual suave.
4. WHILE la Barra_Lateral está colapsada, THE Plataforma SHALL mostrar el ícono de expandir (MenuIcon) centrado y completamente visible.
5. THE AppBar SHALL tener un z-index que no bloquee la interacción con el botón de colapsar de la Barra_Lateral.
