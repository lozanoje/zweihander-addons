# Zweihander Addons

Módulo para Foundry VTT v14 + sistema Zweihander (probado contra el código de la 5.8.3).

Añade al Combat Tracker, justo debajo de los iconos de cada contendiente, **una sola fila**:

`[diana] [fichas de sus objetivos] [espadas] [armas equipadas]`

- **Objetivos:** cada vez que marcas un target mientras tienes un token seleccionado, ese token guarda
  tus objetivos en un flag propio (`flags.zweihander-addons.targets`). Si no tienes ningún token
  seleccionado, se guardan en los tokens de tu personaje. Al seleccionar un único token, los objetivos
  del lienzo pasan a ser los que ese token tiene guardados, para que lienzo y asistente coincidan
  (se puede desactivar en los ajustes).
- **Armas:** botones con el nombre (abreviado, configurable) de las armas con `system.equipped = true`.
  Al pulsar se abre el diálogo de tirada del sistema. Por defecto solo los propietarios del actor las ven; el ajuste «Armas solo para propietarios» permite mostrarlas a todos (los no propietarios las ven desactivadas).
- **Arrastrar y soltar:** se pueden arrastrar ataques sobre otros contendientes del asistente de combate o sobre tokens en el lienzo y los pondrá como objetivo y hará la tirada.

Añade a las tarjetas de ataque y daño el icono del objetivo

Gestión de puntos de acción:

- Ataque. Resta 1 PA al atacar con el botón de arma, también al arrastrarla sobre un contendiente o un token. El PA se resta cuando la tirada se crea, así que si cancelas el diálogo de tirada no se cobra.
- Esquivar y parar. Resta 1 PA desde los botones de la tarjeta de ataque, al actor que tira la reacción (el mismo que elige el sistema: personaje o token seleccionado).
- Movimiento. Con M igual al movimiento del actor (secondaryAttributes.movement.value), al arrastrar un token resta 1 PA de 1 a M casillas, 2 PA de M+1 a 2M y 3 PA de 2M+1 a 3M. Más allá de 3M sigue el mismo patrón (4 PA, etc.).

Notas:

- Solo en combate iniciado. Se cuenta únicamente para combatientes del combate activo ya empezado; moverse o tirar fuera de combate no gasta PA.
- Un movimiento = una operación de arrastre. Cada arrastre de token se cuenta por sus casillas totales, no acumulado en el turno.
- El teclado no cuenta, porque cada pulsación es una operación de una casilla y cobraría 1 PA por paso.
- Casillas, no distancia. Uso el número de casillas del movimiento, y la distancia de la escena solo si no hay rejilla.
- Volver a tirar no cuesta PA, y esquivar o parar desde otra vía distinta a los botones de la tarjeta tampoco.


Cómo hacen que Parar, Esquivar y Daño actúen sobre el objetivo

Cada botón del tracker pulsa el botón correspondiente de la tarjeta de chat, así que se ejecuta la acción real del sistema (incluido el aviso de puntos de acción). Antes de pulsar:

Parar y Esquivar: seleccionan el token del primer objetivo del ataque, porque el sistema tira por el token seleccionado. Ese token se queda seleccionado después.
Daño: pone como targets del usuario los del ataque, porque el sistema los toma de ahí.
Repetir, Explotar y Aplicar: pulsan directamente; Repetir respeta Mayús (diálogo de tirada).

Un botón del tracker aparece desactivado cuando el de la tarjeta lo está, y si fallara en el momento de pulsarlo, muestra un aviso.

Cosas a tener en cuenta
El marcador y el sistema difieren en un punto. El sistema calcula los pasos como «daño menos UD, entre 6, más 1», así que un daño igual a UD ya cuenta como 1 paso. Tu regla dice «menor o igual a UD: corazón verde», por lo que en ese borde el marcador y lo que hace «Aplicar» no coinciden. Implementé tu regla tal cual. Si prefieres que el marcador siga el cálculo del sistema, es cambiar dos comparaciones.
Necesita la tarjeta de chat. Las acciones funcionan si la tarjeta está pintada en el chat (lo está por defecto). Si no lo está, el botón avisa de que no está disponible.
Quién ve el marcador. El umbral solo se usa si el usuario puede observar al actor objetivo (el GM siempre), para no revelar el de los PNJ. Si no puede, no se muestra el marcador.
Anchura. En una barra lateral estrecha, la fila 3 de un éxito parte en dos líneas (Repetir y Parar, luego Esquivar y Daño). Si quieres que quepa en una, puedo dejar solo iconos con tooltip.

## Instalación

Instala con este manifiesto: ```https://raw.githubusercontent.com/lozanoje/zweihander-addons/main/module.json```

## Big warning

This module has been coded using AI, whatever it might implies for you. So use at your own risk!