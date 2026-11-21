# Zweihander Addons

Módulo para Foundry VTT v14 + sistema Zweihander (probado contra el código de la 5.8.3).

Añade al Combat Tracker, justo debajo de los iconos de cada contendiente, **una sola fila**:

`[diana] [fichas de sus objetivos] [espadas] [armas equipadas]`

- **Objetivos:** cada vez que marcas un target mientras tienes un token seleccionado, ese token guarda
  tus objetivos en un flag propio (`flags.zweihander-addons.targets`). Si no tienes ningún token
  seleccionado, se guardan en los tokens de tu personaje.
- **Armas:** botones con el nombre (abreviado, configurable) de las armas con `system.equipped = true`.
  Al pulsar se abre el diálogo de tirada del sistema. Por defecto solo los propietarios del actor las ven; el ajuste «Armas solo para propietarios» permite mostrarlas a todos (los no propietarios las ven desactivadas).
- **Arrastrar y soltar:** se pueden arrastrar ataques sobre otros contendientes del asistente de combate

Añade a las tarjetas de ataque y daño el icono del objetivo

## Instalación

Instala con este manifiesto: ```https://raw.githubusercontent.com/lozanoje/zweihander-addons/main/module.json```

## Big warning

This module has been coded using AI, whatever it might implies for you. So use at your own risk!