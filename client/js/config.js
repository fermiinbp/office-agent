/*
 * The Agent Office — configuración.
 *
 * Este es el archivo que tocas para personalizar la oficina:
 *   - `jefe`: el orquestador, que trabaja en su despacho aparte.
 *   - `heroes`: cómo se ve y cómo habla el héroe de cada agente. La clave es el
 *     `name` del frontmatter del .md del agente (analista, back, front...).
 *     Un agente que no esté aquí recibe un héroe generado automáticamente.
 *   - `pipeline`: orden en que se pasan una issue (opcional). Si lo quitas, se
 *     deduce de las descripciones ("primero", "al final", "Implementa...").
 *   - `issues`: issues de ejemplo para el modo simulación.
 *   - `agentesPorDefecto`: se usan solo si no hay servidor ni has cargado .md.
 *
 * Accesorios disponibles en `look`: mask (color), monocle, headphones, antenna,
 * helmet + visor (colores), gauntlets (color), tie (color), cape (color), longHair.
 * Emblemas: sun, hex, square, tri, ring, shield, diamond.
 */
window.OFFICE_CONFIG = {
  maxAgentes: 9,

  jefe: {
    name: 'Faro',
    agent: 'orquestador',
    model: 'opus',
    title: 'el jefe que orquesta al escuadrón',
    persona: 'calmado, seguro y paternal; habla de rumbo, luz y equipo; delega con claridad',
    desc: 'Sesión principal: recibe los encargos, decide a qué subagente pasarlos y da el visto bueno final.',
    rules: ['Abre cada issue y se la pasa al primer agente', 'Sigue la cadena del pipeline', 'Recibe la PR al final'],
    tools: ['Task', 'Read'],
    look: {
      suit: '#efece4',
      suit2: '#d9a521',
      boot: '#7a5d18',
      skin: '#e0a67e',
      hair: '#cfd3da',
      cape: '#1f6f78',
      emblem: 'sun',
      accent: '#ffb547',
    },
    frases: {
      libre: ['Todo en rumbo', '¿Quién necesita ayuda?', 'Buen ritmo hoy'],
      daily: ['Buenos días, escuadrón', 'Prioridad: cerrar issues'],
    },
  },

  heroes: {
    analista: {
      name: 'Lupa',
      title: 'la analista que lo ve todo',
      persona: 'meticulosa y curiosa; piensa en voz alta con listas numeradas; detecta riesgos antes que nadie',
      look: {
        suit: '#6a4bc4',
        suit2: '#3b2a78',
        boot: '#2a1f55',
        skin: '#f1c7a4',
        hair: '#231b33',
        longHair: true,
        monocle: true,
        emblem: 'hex',
        accent: '#a98bff',
      },
      frases: {
        libre: ['Repasando convenciones…', 'Ordenando mis notas'],
        daily: ['Ayer: dos planes', 'Hoy: analizar la siguiente'],
      },
    },
    back: {
      name: 'Yunque',
      title: 'el herrero del backend',
      persona: 'directo y de pocas palabras; usa metáforas de forja; orgulloso de una buena estructura',
      look: {
        suit: '#d9772b',
        suit2: '#5b3a24',
        boot: '#3a2516',
        skin: '#8d5a3b',
        hair: '#1c1712',
        mask: '#2a2a33',
        gauntlets: '#3d3d46',
        emblem: 'square',
        accent: '#ff9a52',
      },
      frases: {
        libre: ['El metal se trabaja en caliente', 'Listo para forjar'],
        daily: ['Rutas al día', 'Sin bloqueos'],
      },
    },
    front: {
      name: 'Pixel',
      title: 'la artista del frontend',
      persona: 'alegre y visual; habla de colores, espaciados y detalles; odia añadir librerías sin motivo',
      look: {
        suit: '#18a7b5',
        suit2: '#0e5a66',
        boot: '#123c44',
        skin: '#f5d6bd',
        hair: '#ff6fae',
        longHair: true,
        mask: '#0b3a40',
        headphones: true,
        emblem: 'tri',
        accent: '#38d3e0',
      },
      frases: {
        libre: ['Este gris no me convence', 'Ajustando espaciados'],
        daily: ['La web va fina', 'Hoy: pulir estilos'],
      },
    },
    qa: {
      name: 'Sonda',
      title: 'el cazador de bugs',
      persona: 'entusiasta y un poco obsesivo; todo lo comprueba dos veces; habla de preparar, actuar y comprobar',
      look: {
        suit: '#8cc63f',
        suit2: '#2f4a1c',
        boot: '#1f2f12',
        skin: '#c68459',
        hair: '#e8d27a',
        mask: '#1f2f12',
        antenna: true,
        emblem: 'ring',
        accent: '#a6e05a',
      },
      frases: {
        libre: ['¿Y si falla con un 400?', 'Nada sin test'],
        daily: ['Todos los tests en verde', 'Subo cobertura'],
      },
    },
    seguridad: {
      name: 'Muralla',
      title: 'la guardiana de la seguridad',
      persona: 'seria, desconfiada y breve; ve amenazas en todas partes; jamás toca un .env',
      look: {
        suit: '#5a6577',
        suit2: '#2b313d',
        boot: '#1a1e26',
        skin: '#e0a67e',
        helmet: '#9aa3b5',
        visor: '#ffb547',
        emblem: 'shield',
        accent: '#c3cbdb',
      },
      frases: { libre: ['Nadie toca el .env', 'Vigilando'], daily: ['CI en marcha', 'Sin secretos expuestos'] },
    },
    revisor: {
      name: 'Sello',
      title: 'el juez que firma las PR',
      persona: 'formal y justo, con un punto teatral; habla de veredictos; no deja pasar un fallo serio',
      look: {
        suit: '#1f2a52',
        suit2: '#121933',
        boot: '#0c1022',
        skin: '#f1c7a4',
        hair: '#3a2a20',
        tie: '#d9a521',
        emblem: 'diamond',
        accent: '#7f9bff',
      },
      frases: {
        libre: ['Sin diff no hay veredicto', 'Esperando el diff'],
        daily: ['Dos PR firmadas', 'Revisaré con lupa'],
      },
    },
  },

  pipeline: [['analista'], ['back', 'front'], ['qa'], ['seguridad'], ['revisor']],

  issues: [
    { n: 14, title: 'Añadir reseñas a un juego', res: 'resenas', route: 'POST /juegos/:id/resenas' },
    { n: 15, title: 'Filtrar juegos por género', res: 'juegos', route: 'GET /juegos?genero=' },
    { n: 16, title: 'Endpoint de juegos más valorados', res: 'juegos', route: 'GET /juegos/top' },
    { n: 17, title: 'Borrar usuario (solo admin)', res: 'usuarios', route: 'DELETE /usuarios/:id' },
    { n: 18, title: 'Paginar el listado de juegos', res: 'juegos', route: 'GET /juegos?page=' },
  ],

  agentesPorDefecto: [
    {
      name: 'analista',
      model: 'opus',
      tools: ['Read', 'Grep', 'Glob'],
      description:
        'Analiza una issue y el código del proyecto (API y web), y devuelve un plan de cambios por archivo. Úsalo siempre primero.',
      rules: [
        'Lee la issue y los archivos implicados de la API y de la web',
        'Devuelve un plan numerado con archivos, cambios y riesgos',
        'Respeta las convenciones del curso',
        'Responde en español y en menos de 200 palabras',
      ],
    },
    {
      name: 'back',
      model: 'sonnet',
      tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash'],
      description: 'Implementa cambios en la API (backend) siguiendo el plan del analista.',
      rules: [
        'Sigue el plan que te pasan, archivo por archivo',
        'Estructura: ruta → validador → validar → controlador → servicio → modelo',
        'Cada endpoint nuevo lleva su anotación @openapi',
        'No leas ni modifiques .env',
      ],
    },
    {
      name: 'front',
      model: 'sonnet',
      tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob'],
      description: 'Implementa cambios en la web (frontend) que consume la API.',
      rules: [
        'Usa la función pedir() existente; no añadas librerías',
        'Mantén el estilo visual actual',
        'Resumen de una línea por archivo tocado',
      ],
    },
    {
      name: 'qa',
      model: 'sonnet',
      tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash'],
      description: 'Escribe y ejecuta tests con Jest y supertest para los cambios de la API, y corrige lo que falle.',
      rules: [
        'Tests con el patrón AAA en tests/',
        'Caso bueno y al menos un 400 de validación',
        'Ejecuta npm test y corrige lo que falle',
      ],
    },
    {
      name: 'revisor',
      model: 'opus',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      description: 'Revisa el diff completo, da el veredicto y abre la pull request. Úsalo siempre al final.',
      rules: [
        'Revisa el diff con git diff contra main',
        'Si hay un problema serio, no abre la PR',
        'Commit "ID: qué hace", push y gh pr create con "Closes #N"',
      ],
    },
    {
      name: 'seguridad',
      model: 'sonnet',
      tools: ['Read', 'Grep', 'Glob', 'Write'],
      description: 'Audita la seguridad de los cambios y añade el workflow de CI de GitHub Actions.',
      rules: [
        'Revisa validación, autenticar/autorizar, secretos, IDOR y dependencias',
        'No leas .env',
        'Crea .github/workflows/test.yml si no existe',
        'Informe: riesgo, archivo, gravedad y solución',
      ],
    },
  ],
};
