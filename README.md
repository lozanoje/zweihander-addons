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

Qué hace ahora

Si ya se tiró esa reacción contra el ataque, Parar o Esquivar pasa a pulsar el «Volver a tirar» de la tarjeta de esa tirada, así que se comporta igual que en el chat:

gasta fortuna o desgracia y no tira si no queda;
reutiliza la dificultad, y solo abre el diálogo con Mayús;
no cuesta PA;
queda desactivado cuando el chat no deja repetir (una pifia);
el tooltip pasa a decir «Parar · Volver a tirar», y el botón conserva el color de su último resultado.

La primera vez sigue siendo como antes (tira la reacción sobre el objetivo y cobra 1 PA). Si repites varias veces, el botón apunta siempre a la tarjeta de la tirada más reciente.

Cosas a tener en cuenta
Quién puede repetir. El sistema activa el «Volver a tirar» de una tarjeta para el GM o para quien controle a ese actor en el momento en que se pinta la tarjeta. Si un jugador no tenía seleccionado al defensor entonces, el botón saldrá desactivado en el tracker igual que en el chat.
Tarjeta borrada. Si borras del chat la tarjeta de esa tirada, el botón vuelve a tirar de cero como la primera vez.

## Magia

Los actores con hechizos (cualquier item de tipo `spell`, sea `character`, `npc` o `creature`) son usuarios de magia y tienen un botón **grimorio** a la derecha de la espada que despliega el marco de magia:

- **Hechizos:** botones con el nombre abreviado (mismo ajuste que las armas). Al pulsar se abre el diálogo de tirada del sistema (`item.system.roll()`). También se pueden **arrastrar** sobre un contendiente del asistente o un token del lienzo (también sobre uno mismo) para fijarlo como objetivo.
- **PA:** generalista y pueril 1 PA, menor 2 PA, mayor 3 PA. El principio se reconoce en español, inglés y alemán (y con los nombres de `ZWEI.rolls.principetypes` del idioma activo). Se cobra al crearse la tirada; volver a tirar no cuesta.
- **Dificultad:** el diálogo se abre con la dificultad del principio (generalista/pueril +10, menor 0, mayor -10).
- **Canalizar:** botón (varita) tras los hechizos; cada clic cicla 1 (naranja claro), 2 (naranja oscuro), 3 (rojo) y apagado. Preselecciona «Un paso / Dos pasos / Tres pasos» en el diálogo. Cualquier nivel cuesta 1 PA (además del hechizo).
- **Resultado:** Éxito / Fallo / Pifia con los colores habituales, «Volver a tirar» y **Contrahechizo**.
- **Contrahechizo:** activo solo si el hechizo es un éxito normal (con crítico, fallo o pifia queda en gris) y su objetivo es usuario de magia (distinto del lanzador y controlado por el usuario). Tras tirarlo, el botón toma el color del resultado, como Parar y Esquivar. Cuesta 1 PA al objetivo y abre una prueba de su habilidad de magia con la dificultad contraria a la elegida para el hechizo (sin contar el bono de canalizar).

## Distancias

Al atacar con un arma desde el tracker (clic o arrastrando) se mide la distancia entre el token atacante y su objetivo (primer target) en casillas libres: adyacentes = 0 = **trabados**. Cada casilla vale `scene.grid.distance` metros. Si no se puede atacar, se avisa con un mensaje y no se gasta nada. Se puede desactivar con el ajuste «Reglas de distancia en los ataques».

| Tipo de arma | Regla |
|---|---|
| Cuerpo a cuerpo | Solo trabado (0). Con la cualidad **Alcance**, también a 1 casilla. |
| **Arrojadiza** (cualidad Arrojadiza) | Solo alcance corto; no se puede usar trabado. Si usa una habilidad cuerpo a cuerpo (cuchillo, lanza…), trabado se usa como arma cuerpo a cuerpo. |
| A distancia | Corto: hasta F (sin penalización). Medio: hasta 2F (−10%). Largo: hasta 3F (−20%). Extremo: hasta 4F (−20% y sin dados de Furia). No se puede usar trabado. F = bono del atributo de la fórmula del arma (p. ej. [PB]) + bono de distancia. |
| **Pólvora** | Se puede disparar trabado y el ataque no se puede parar ni esquivar. |

«Trabado» incluye estar adyacente a cualquier enemigo (disposición opuesta, ni derrotado ni oculto), no solo al objetivo. La dificultad del diálogo se preselecciona (se suma a la de apuntar); a distancia extrema, «Dado de Furia adicional» se ajusta para que el daño no lleve dados de Furia. Las cualidades se reconocen en español, inglés y por su id de compendio.

## Instalación

Instala con este manifiesto: ```https://raw.githubusercontent.com/lozanoje/zweihander-addons/main/module.json```

## Big warning

This module has been coded using AI, whatever it might implies for you. So use at your own risk!