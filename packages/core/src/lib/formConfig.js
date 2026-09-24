import { supabase } from './supabase'

// cooperative como primer parámetro en loadFormConfig y en todas las
// funciones load*() de este archivo (antes leían COOPERATIVE del módulo
// lib/config, que ya no existe en core) -- los call sites (bucket 1/2/3,
// pendientes de migrar en fases posteriores) tienen que empezar a pasarlo.

// ─── Defaults hardcoded (fallback si no hay config en BD) ───────────────────

const DEFAULTS = {
  calidad: [
    { key: 'humidity_pct', label: 'Humedad %', type: 'number', required: true, min: 0, max: 100, order: 1 },
    { key: 'impurities_pct', label: 'Impurezas %', type: 'number', required: true, min: 0, max: 100, order: 2 },
    { key: 'color', label: 'Color', type: 'select', required: true, options: ['amarillo claro', 'amarillo oscuro', 'verde', 'marron claro', 'marron oscuro'], order: 3 },
    { key: 'sack_condition', label: 'Estado del saco', type: 'select', required: true, options: ['buena', 'regular', 'mala'], order: 4 },
    { key: 'appearance', label: 'Apariencia', type: 'select', required: true, options: ['suelta', 'seca', 'cerosa'], order: 5 },
    { key: 'notes', label: 'Observaciones', type: 'textarea', required: false, order: 6 },
  ],
  // Control de calidad del ENVASADO (producto terminado, por lote de planta)
  // -- distinto del step "calidad" de arriba (materia prima en recepción).
  // Color reutiliza la misma lista que recepción a pedido del usuario;
  // sabor/textura son nuevos, sin catálogo previo en el sistema -- textura
  // reusa el mismo vocabulario que "appearance" (suelta/seca/cerosa), que ya
  // se usa en todo el sistema para describir la panela.
  calidad_envasado: [
    { key: 'color', label: 'Color', type: 'select', required: true, options: ['amarillo claro', 'amarillo oscuro', 'verde', 'marron claro', 'marron oscuro'], order: 1 },
    { key: 'sabor', label: 'Sabor', type: 'select', required: true, options: ['dulce', 'dulce intenso', 'caramelizado', 'acido', 'amargo', 'neutro'], order: 2 },
    { key: 'textura', label: 'Textura', type: 'select', required: true, options: ['suelta', 'seca', 'cerosa'], order: 3 },
  ],
  // Áreas del Control de Salud e Higiene del Personal (SIG-GIA-RG-005) --
  // solo las que aparecen en el formato físico de referencia. Configurable
  // por si hace falta sumar otra área a futuro sin tocar código.
  higiene_personal: [
    { key: 'area', label: 'Área', type: 'select', required: true, options: ['Envasado', 'Tamizado'], order: 1 },
  ],
  // Áreas físicas del Control del Programa de Limpieza y Sanitización de
  // Ambientes (SIG-GIA-RG-002) -- son ambientes/salas de la planta, no
  // pasos de proceso (por eso "Envasado" aquí es un lugar físico, distinto
  // del "Envasado" de higiene_personal que es una etapa de proceso).
  limpieza_ambientes: [
    { key: 'area', label: 'Área', type: 'select', required: true, options: [
      'Aduana Sanitaria', 'Oficina Administrativa', 'Almacenes', 'Operaciones', 'Envasado',
      'Laboratorio', 'Productos Químicos - Herramientas y Vestuarios', 'Servicios Higiénicos', 'Pasadizos',
    ], order: 1 },
  ],
  // Puntos de control del Control de Cloro Residual (SIG-GIA-RG-001) -- el
  // punto (texto libre) es a la vez el código que se guarda y la etiqueta
  // que se muestra, mismo criterio que "area" arriba -- no hay un id corto
  // aparte que pueda desincronizarse del texto visible.
  cloro_residual_puntos: [
    { key: 'punto', label: 'Punto de control', type: 'select', required: true, options: [
      'Punto 1: Aduana Sanitaria', 'Punto 2: Laboratorio', 'Punto 3: Área de Envasado',
    ], order: 1 },
  ],
  // Áreas e ítems de la Verificación del Programa de Limpieza y
  // Sanitización (SIG-GIA-RG-009) -- a diferencia de "area" arriba (solo
  // nombres), acá cada opción es { area, items: [{code, label}] } porque el
  // ítem necesita un código estable (se guarda como dato) separado de su
  // etiqueta visible.
  verificacion_limpieza_areas: [
    { key: 'areas', label: 'Áreas', type: 'grouped-list', required: true, options: [
      { area: 'Aduana Sanitaria', items: [
        { code: 'paredes_techo', label: 'Paredes, techo' },
        { code: 'puertas', label: 'Puertas' },
        { code: 'pisos', label: 'Pisos' },
        { code: 'lavatorios', label: 'Lavatorios' },
        { code: 'dispensadores', label: 'Dispensadores' },
        { code: 'dispensadores_indumentaria', label: 'Dispensadores indumentaria' },
        { code: 'lockers', label: "Locker's" },
        { code: 'personal', label: 'Personal *' },
        { code: 'presencia_plagas', label: 'Presencia o signos de plagas' },
        { code: 'disposicion_residuos', label: 'Disposición de residuos' },
      ] },
      { area: 'Oficina', items: [
        { code: 'techo', label: 'Techo' },
        { code: 'paredes_techo', label: 'Paredes, techo' },
        { code: 'puerta', label: 'Puerta' },
        { code: 'pisos', label: 'Pisos' },
        { code: 'mobiliarios', label: 'Mobiliarios' },
      ] },
      { area: 'Encajado y Paletizado', items: [
        { code: 'techo', label: 'Techo' },
        { code: 'paredes', label: 'Paredes' },
        { code: 'puertas_ventanas', label: 'Puertas y ventanas' },
        { code: 'pisos', label: 'Pisos' },
        { code: 'balanzas', label: 'Balanzas' },
        { code: 'selladoras', label: 'Selladoras' },
        { code: 'mesas_sillas', label: 'Mesas y sillas' },
        { code: 'cucharones', label: 'Cucharones' },
        { code: 'recipientes', label: 'Recipientes' },
        { code: 'personal', label: 'Personal *' },
        { code: 'detector_metales', label: 'Detector de metales' },
        { code: 'envolvedor_pallets', label: 'Envolvedor de pallets' },
        { code: 'compresor', label: 'Compresor' },
        { code: 'transportador', label: 'Transportador' },
        { code: 'presencia_plagas', label: 'Presencia o signos de plagas' },
        { code: 'disposicion_residuos', label: 'Disposición de residuos' },
        { code: 'lavatorios', label: 'Lavatorios' },
        { code: 'dispensadores', label: 'Dispensadores' },
      ] },
      { area: 'Operaciones', items: [
        { code: 'techo', label: 'Techo' },
        { code: 'paredes', label: 'Paredes' },
        { code: 'puertas_ventanas', label: 'Puertas y ventanas' },
        { code: 'pisos', label: 'Pisos' },
        { code: 'balanzas_plataforma', label: 'Balanzas Plataforma' },
        { code: 'molino', label: 'Molino' },
        { code: 'homogenizador', label: 'Homogenizador' },
        { code: 'tamizadora', label: 'Tamizadora' },
        { code: 'cucharones', label: 'Cucharones' },
        { code: 'palanas', label: 'Palanas' },
        { code: 'recipientes', label: 'Recipientes' },
        { code: 'personal', label: 'Personal *' },
        { code: 'presencia_plagas', label: 'Presencia o signos de plagas' },
        { code: 'disposicion_residuos', label: 'Disposición de residuos' },
        { code: 'lavatorios', label: 'Lavatorios' },
      ] },
      { area: 'Laboratorio', items: [
        { code: 'techo', label: 'Techo' },
        { code: 'paredes', label: 'Paredes' },
        { code: 'puertas_ventanas', label: 'Puertas y ventanas' },
        { code: 'pisos', label: 'Pisos' },
        { code: 'determinador_humedad', label: 'Determinador de Humedad' },
        { code: 'mesas_sillas', label: 'Mesas y sillas' },
        { code: 'personal', label: 'Personal *' },
        { code: 'presencia_plagas', label: 'Presencia o signos de plagas' },
        { code: 'disposicion_residuos', label: 'Disposición de residuos' },
        { code: 'lavatorio', label: 'Lavatorio' },
        { code: 'dispensadores', label: 'Dispensadores' },
      ] },
      { area: 'Almacenes: Producto Terminado, Materia Prima, Insumos', items: [
        { code: 'techo', label: 'Techo' },
        { code: 'paredes', label: 'Paredes' },
        { code: 'puertas_ventanas', label: 'Puertas y ventanas' },
        { code: 'pisos', label: 'Pisos' },
        { code: 'balanza_plataforma', label: 'Balanza plataforma' },
        { code: 'personal', label: 'Personal *' },
        { code: 'presencia_plagas', label: 'Presencia o signos de plagas' },
        { code: 'disposicion_residuos', label: 'Disposición de residuos' },
      ] },
      { area: 'Productos Químicos - Herramientas - Caseta Eléctrica y Vestuarios', items: [
        { code: 'techo', label: 'Techo' },
        { code: 'paredes', label: 'Paredes' },
        { code: 'puertas_ventanas', label: 'Puertas y ventanas' },
        { code: 'pisos', label: 'Pisos' },
        { code: 'lavatorio', label: 'Lavatorio' },
        { code: 'armario', label: 'Armario' },
        { code: 'disposicion_residuos', label: 'Disposición de residuos' },
        { code: 'rotulacion_orden_limpieza', label: 'Rotulación, Orden y limpieza' },
        { code: 'fichas_tecnicas', label: 'Se cuenta con fichas técnicas' },
      ] },
      { area: 'Servicios Higiénicos', items: [
        { code: 'techo', label: 'Techo' },
        { code: 'paredes', label: 'Paredes' },
        { code: 'puertas_ventanas', label: 'Puertas y ventanas' },
        { code: 'pisos', label: 'Pisos' },
        { code: 'sanitarios', label: 'Inodoro, urinario, lavatorio y ducha' },
        { code: 'disposicion_residuos', label: 'Disposición de residuos' },
      ] },
      { area: 'Otros', items: [
        { code: 'dispensadores', label: 'Dispensadores' },
        { code: 'extintores', label: 'Extintores' },
        { code: 'luces_emergencia', label: 'Luces de emergencia' },
        { code: 'lampara_atrapa_insectos', label: 'Lámpara atrapa insectos' },
        { code: 'luminarias', label: 'Luminarias' },
        { code: 'aires_acondicionados', label: 'Aires acondicionados' },
      ] },
      { area: 'Alrededores', items: [
        { code: 'plataforma', label: 'Plataforma' },
        { code: 'pasadizos', label: 'Pasadizos' },
        { code: 'sistema_agua', label: 'Sistema de agua' },
      ] },
      { area: 'Utensilios de Limpieza', items: [
        { code: 'cartilla_colores', label: 'Según cartilla de colores' },
        { code: 'limpios_ordenados', label: 'Limpios y ordenados' },
      ] },
    ], order: 1 },
  ],
  // Áreas y equipos del Control del Programa de Limpieza y Sanitización de
  // Equipos - Utensilios (SIG-GIA-RG-003) -- mismo criterio que
  // verificacion_limpieza_areas (item con código estable + etiqueta), más
  // "tracksProduct: false" para equipos de "Otros" que en el papel físico
  // real solo llevan check, sin producto (H/A/D). "Balanzas" aparece dos
  // veces en Envasado (dos balanzas distintas del área), por eso hay dos
  // códigos separados (`balanzas` y `balanzas_2`).
  limpieza_equipos_areas: [
    { key: 'areas', label: 'Áreas / Equipos', type: 'grouped-list', required: true, options: [
      { area: 'Aduana Sanitaria', items: [
        { code: 'lavatorios', label: 'Lavatorios' },
        { code: 'lockers', label: "Locker's" },
      ] },
      { area: 'Oficina', items: [
        { code: 'mobiliario', label: 'Mobiliario' },
      ] },
      { area: 'Almacenes', items: [
        { code: 'parihuelas', label: 'Parihuelas' },
        { code: 'transpaleta', label: 'Transpaleta' },
        { code: 'carretilla_manual', label: 'Carretilla manual' },
        { code: 'balanza_plataforma', label: 'Balanza plataforma' },
      ] },
      { area: 'Tamizado - Zona de Operaciones', items: [
        { code: 'molino', label: 'Molino' },
        { code: 'homogenizadora', label: 'Homogenizadora' },
        { code: 'tamizadora', label: 'Tamizadora' },
        { code: 'balanza_plataforma', label: 'Balanza plataforma' },
        { code: 'lavatorio', label: 'Lavatorio' },
        { code: 'palanas', label: 'Palanas' },
        { code: 'cucharones', label: 'Cucharones' },
        { code: 'baldes', label: 'Baldes' },
      ] },
      { area: 'Envasado', items: [
        { code: 'balanzas', label: 'Balanzas' },
        { code: 'cucharones', label: 'Cucharones' },
        { code: 'detector_metales', label: 'Detector de Metales' },
        { code: 'envolvedor_pallets', label: 'Envolvedor de pallets' },
        { code: 'recipientes', label: 'Recipientes' },
        { code: 'mesas', label: 'Mesas' },
        { code: 'selladoras', label: 'Selladoras' },
        { code: 'transportador_cajas', label: 'Transportador cajas' },
        { code: 'lavatorio', label: 'Lavatorio' },
        { code: 'balanzas_2', label: 'Balanzas' },
        { code: 'utensilios', label: 'Utensilios' },
      ] },
      { area: 'Vestuarios y SS.HH', items: [
        { code: 'inodoro', label: 'Inodoro' },
        { code: 'lavatorios', label: 'Lavatorios' },
        { code: 'duchas', label: 'Duchas' },
        { code: 'lockers', label: "Locker's" },
      ] },
      { area: 'Material Limpieza', items: [
        { code: 'implementos', label: 'Implementos' },
        { code: 'depositos_residuos', label: 'Depósitos (residuos)' },
      ] },
      { area: 'Otros', items: [
        { code: 'dispensadores_agua', label: 'Dispensadores de agua', tracksProduct: false },
        { code: 'extintores', label: 'Extintores', tracksProduct: false },
        { code: 'luces_emergencia', label: 'Luces de emergencia', tracksProduct: false },
        { code: 'lamparas_atrapa_insectos', label: 'Lámparas atrapa insectos', tracksProduct: false },
        { code: 'luminarias', label: 'Luminarias', tracksProduct: false },
        { code: 'aires_acondicionados', label: 'Aires acondicionados', tracksProduct: false },
      ] },
    ], order: 1 },
  ],
  // Áreas e ítems del Control de Limpieza fusionado de CAES (SIG papel:
  // CAESP-PP-HYS-RE-HYS-001, ver COOPERATIVE.features.limpiezaUnificada) --
  // a diferencia de limpieza_ambientes/limpieza_equipos_areas, acá cada
  // ítem mezcla superficies físicas y equipos puntuales bajo la misma área,
  // y trae metadata de referencia (no capturada a diario): tipoLimpieza
  // (subconjunto de D=Diaria, G=General, P=Profunda) y producto (subconjunto
  // de C=Cloro, D=Detergente Industrial, A=Alcohol) -- se muestran en el
  // documento generado como referencia, la grilla diaria es un solo check
  // por ítem por día (sin producto por celda, a diferencia de Equipos de
  // Norandino).
  limpieza_general_areas: [
    { key: 'areas', label: 'Áreas / Ítems', type: 'grouped-list', required: true, options: [
      { area: 'Recepción', items: [
        { code: 'paredes_pisos_techo', label: 'Paredes, pisos, techo', tipoLimpieza: ['D', 'G', 'P'], producto: ['C', 'D'] },
        { code: 'puertas_ventanas', label: 'Puertas, ventanas', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'parihuelas_tachos', label: 'Parihuelas, tachos de basura', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'otros', label: 'Otros', tipoLimpieza: ['D', 'G'], producto: [] },
      ] },
      { area: 'Almacén de Materia Prima', items: [
        { code: 'paredes_pisos_techo', label: 'Paredes, pisos, techo', tipoLimpieza: ['D', 'G', 'P'], producto: ['C', 'D'] },
        { code: 'puertas_ventanas_mallas', label: 'Puertas, ventanas y mallas', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'balanza_plataforma', label: 'Balanza plataforma', tipoLimpieza: ['G'], producto: ['A'] },
        { code: 'parihuelas', label: 'Parihuelas', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'otros', label: 'Otros', tipoLimpieza: ['D', 'G'], producto: [] },
      ] },
      { area: 'Tamizado, Homogenizado y Envasado', items: [
        { code: 'paredes_pisos_techo', label: 'Paredes, pisos, techo', tipoLimpieza: ['D', 'G', 'P'], producto: ['C', 'D', 'A'] },
        { code: 'puertas_ventanas_mallas', label: 'Puertas, ventanas y mallas', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'bunques', label: 'Bunques', tipoLimpieza: ['D', 'G', 'P'], producto: ['C', 'D', 'A'] },
        { code: 'zarandas', label: 'Zarandas', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'utensilios', label: 'Utensilios (paletas, baldes, cucharones, etc.)', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'parihuelas', label: 'Parihuelas', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'balanza_plataforma', label: 'Balanza de plataforma', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'extintor', label: 'Extintor', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'otros', label: 'Otros', tipoLimpieza: ['D', 'G'], producto: [] },
      ] },
      { area: 'Almacén de Producto Terminado', items: [
        { code: 'paredes_pisos_techo', label: 'Paredes, pisos, techo', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'puertas_ventanas_mallas', label: 'Puertas, ventanas y mallas', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'parihuelas', label: 'Parihuelas', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'extintor', label: 'Extintor', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'otros', label: 'Otros', tipoLimpieza: ['D', 'G'], producto: [] },
      ] },
      { area: 'Almacén de Materiales e Insumos', items: [
        { code: 'paredes_pisos_techo', label: 'Paredes, pisos, techo', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'puertas_ventanas', label: 'Puertas, ventanas', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'anaqueles_parihuelas', label: 'Anaqueles o estantes, parihuelas', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'otros', label: 'Otros', tipoLimpieza: ['D', 'G'], producto: [] },
      ] },
      { area: 'Laboratorio', items: [
        { code: 'paredes_pisos_techo', label: 'Paredes, pisos, techo', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'puertas_ventanas', label: 'Puertas, ventanas', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'utensilios_vidrio', label: 'Utensilios y material de vidrio (vasos, probetas, etc.)', tipoLimpieza: ['G'], producto: ['A'] },
        { code: 'estantes_mesas', label: 'Estantes, mesas', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'equipos', label: 'Equipos (filtración, campana, bomba, horno, cocina, etc.)', tipoLimpieza: ['G'], producto: ['A'] },
        { code: 'otros', label: 'Otros', tipoLimpieza: ['D', 'G'], producto: [] },
      ] },
      { area: 'Vestuarios', items: [
        { code: 'paredes_pisos_techo', label: 'Paredes, pisos, techo', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'puertas_ventanas', label: 'Puertas, ventanas', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'armario', label: 'Armario', tipoLimpieza: ['G'], producto: ['A'] },
        { code: 'otros', label: 'Otros', tipoLimpieza: ['D', 'G'], producto: [] },
      ] },
      { area: 'Oficina', items: [
        { code: 'paredes_piso_techo', label: 'Paredes, piso y techo', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'puertas_ventanas', label: 'Puertas, ventanas', tipoLimpieza: ['G'], producto: ['D'] },
        { code: 'escritorios_muebles', label: 'Escritorios, muebles, etc.', tipoLimpieza: ['G'], producto: ['A'] },
        { code: 'equipos', label: 'Equipos (computadoras, laptops, impresoras, etc.)', tipoLimpieza: ['G'], producto: ['A'] },
        { code: 'extintor', label: 'Extintor', tipoLimpieza: ['G'], producto: [] },
        { code: 'botiquin', label: 'Botiquín', tipoLimpieza: ['G'], producto: [] },
        { code: 'otros', label: 'Otros', tipoLimpieza: ['D', 'G'], producto: [] },
      ] },
      { area: 'Servicios Higiénicos', items: [
        { code: 'paredes', label: 'Paredes', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'puertas_ventanas', label: 'Puertas, ventanas', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'pisos', label: 'Pisos', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'banos_lavatorios_duchas', label: 'Baños, lavatorios y duchas', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'otros', label: 'Otros', tipoLimpieza: ['D', 'G'], producto: [] },
      ] },
      { area: 'Utensilios de Limpieza', items: [
        { code: 'tachos_recipientes', label: 'Tachos y recipientes de basura', tipoLimpieza: ['D', 'G'], producto: ['C', 'D'] },
        { code: 'escobas_escobillones', label: 'Escobas, escobillones, otros', tipoLimpieza: ['G'], producto: ['C', 'D'] },
        { code: 'otros', label: 'Otros', tipoLimpieza: ['D', 'G'], producto: [] },
      ] },
      { area: 'Reservorio', items: [
        { code: 'tanque_1', label: 'Tanque N°01', tipoLimpieza: [], producto: [] },
        { code: 'tanque_2', label: 'Tanque N°02', tipoLimpieza: [], producto: [] },
        { code: 'tanque_3', label: 'Tanque N°03', tipoLimpieza: [], producto: [] },
      ] },
    ], order: 1 },
  ],
  checklist_limpieza: [
    { key: 'pisos', label: 'Pisos limpios y secos', type: 'checkbox', required: false, order: 1 },
    { key: 'paredes', label: 'Paredes y techos sin suciedad', type: 'checkbox', required: false, order: 2 },
    { key: 'equipos', label: 'Equipos y utensilios limpios', type: 'checkbox', required: false, order: 3 },
    { key: 'desagues', label: 'Desagües despejados', type: 'checkbox', required: false, order: 4 },
    { key: 'desinfeccion', label: 'Zona de trabajo desinfectada', type: 'checkbox', required: false, order: 5 },
    { key: 'residuos', label: 'Residuos evacuados correctamente', type: 'checkbox', required: false, order: 6 },
  ],
  checklist_mantenimiento_equipos: [
    { key: 'tamizadora', label: 'Tamizadora en buen estado', type: 'checkbox', required: false, order: 1 },
    { key: 'tolvas', label: 'Tolvas sin obstrucciones', type: 'checkbox', required: false, order: 2 },
    { key: 'bandas', label: 'Bandas transportadoras funcionando', type: 'checkbox', required: false, order: 3 },
    { key: 'selladora', label: 'Selladora calibrada', type: 'checkbox', required: false, order: 4 },
    { key: 'balanzas', label: 'Balanzas calibradas', type: 'checkbox', required: false, order: 5 },
    { key: 'piezas', label: 'Sin piezas sueltas o desgastadas', type: 'checkbox', required: false, order: 6 },
  ],
  checklist_control_plagas: [
    { key: 'roedores', label: 'Sin evidencia de roedores', type: 'checkbox', required: false, order: 1 },
    { key: 'insectos', label: 'Sin evidencia de insectos', type: 'checkbox', required: false, order: 2 },
    { key: 'trampas', label: 'Trampas revisadas y activas', type: 'checkbox', required: false, order: 3 },
    { key: 'accesos', label: 'Accesos sellados (puertas/ventanas)', type: 'checkbox', required: false, order: 4 },
    { key: 'rastros', label: 'Sin heces ni rastros de animales', type: 'checkbox', required: false, order: 5 },
  ],
  checklist_control_personal: [
    { key: 'uniforme', label: 'Personal con uniforme completo', type: 'checkbox', required: false, order: 1 },
    { key: 'epp', label: 'EPP correcto (guantes, mascarilla, cofia)', type: 'checkbox', required: false, order: 2 },
    { key: 'joyas', label: 'Sin joyas ni accesorios', type: 'checkbox', required: false, order: 3 },
    { key: 'salud', label: 'Personal sin síntomas de enfermedad', type: 'checkbox', required: false, order: 4 },
    { key: 'manos', label: 'Manos limpias y desinfectadas', type: 'checkbox', required: false, order: 5 },
    { key: 'alimentos', label: 'Sin alimentos en zona de producción', type: 'checkbox', required: false, order: 6 },
  ],
  contenedor: [
    { key: 'container_number', label: 'Serie de contenedor', type: 'text', required: true, order: 1 },
    { key: 'seal_number', label: 'Nro. Sello', type: 'text', required: false, order: 2 },
    { key: 'precinto_aduana', label: 'Precinto de aduana', type: 'text', required: false, order: 3 },
    { key: 'container_size', label: 'Tamaño (pies)', type: 'select', required: true, options: ['20', '40'], default: '20', order: 4 },
    { key: 'max_capacity_kg', label: 'Capacidad máx. (kg)', type: 'number', required: false, min: 0, order: 5 },
    { key: 'booking_number', label: 'Nro. Reserva (Booking)', type: 'text', required: true, order: 6 },
    { key: 'bill_of_lading', label: 'Conocimiento de embarque (BL)', type: 'text', required: false, order: 7 },
    { key: 'shipping_line', label: 'Naviera', type: 'text', required: false, order: 8 },
    { key: 'vessel', label: 'Vessel', type: 'text', required: false, order: 9 },
    { key: 'destination_port', label: 'Puerto destino', type: 'text', required: true, order: 10 },
    { key: 'departure_date', label: 'Fecha de salida', type: 'date', required: false, order: 11 },
    { key: 'estimated_arrival', label: 'Fecha estimada de llegada', type: 'date', required: false, order: 12 },
    // Documentos de exportación/venta y transporte de producto terminado --
    // campos del Resumen de Trazabilidad (ver [[project_resumen_trazabilidad]])
    // que hasta ahora no tenían ningún lugar donde cargarse. Todos
    // opcionales -- se completan cuando ya se conocen (normalmente después
    // del despacho), no bloquean el registro del contenedor.
    { key: 'factura_comercial', label: 'Factura Comercial', type: 'text', required: false, order: 13 },
    { key: 'certificado_transaccion', label: 'N° Certificado de Transacción (TC)', type: 'text', required: false, order: 14 },
    { key: 'certificado_origen', label: 'Certificado de Origen', type: 'text', required: false, order: 15 },
    { key: 'carta_rendimiento_azucar', label: 'Carta de Rendimiento del Azúcar', type: 'text', required: false, order: 16 },
    // El traslado interno (Montero → ciudad de salida → destino final) ya no
    // se tipea acá como texto suelto -- pasó a ser un registro propio (0 a
    // muchos, cantidad de tramos variable) en Control de Unidad de
    // Transporte, ver plant_transport_unit_controls_caes / migración
    // 20260916130000 y 20260916140000 (que sacó estos campos de acá).
  ],
  despacho: [
    { key: 'dispatch_date', label: 'Fecha de despacho', type: 'date', required: true, order: 1 },
    // "Peso total cargado" ya no se tipea aquí -- se deriva de los kg por
    // lote que se cargan en la lista de items del modal (ver
    // plant_dispatch_items, migración 20260802100000).
    { key: 'seal_verified', label: 'Sello verificado al cerrar', type: 'checkbox', required: false, default: false, order: 3 },
    { key: 'temperature_at_load', label: 'Temperatura al cargar (°C)', type: 'number', required: false, order: 4 },
    { key: 'humidity_at_load', label: 'Humedad relativa al cargar (%)', type: 'number', required: false, min: 0, max: 100, order: 5 },
    { key: 'notes', label: 'Observaciones', type: 'textarea', required: false, order: 6 },
    // Campos para la Orden de Salida de Productos (COA-OIM-RG-007) -- se
    // completan solo en despacho porque ahí es cuando se conocen el
    // transportista/conductor real y los precintos, no antes. "N° de
    // documento" queda en texto libre a pedido del usuario (correlativo
    // propio que llevan a mano, no autogenerado). "Autorizado por" es un
    // desplegable con una sola opción por ahora ("Comercialización"),
    // ampliable después sin tocar código vía form_configurations.
    { key: 'documento_number', label: 'N° de documento (Orden de Salida)', type: 'text', required: false, order: 7 },
    { key: 'guia_remision_cliente', label: 'Guía de Remisión Cliente', type: 'text', required: false, order: 8 },
    { key: 'autorizado_por', label: 'Autorizado por', type: 'select', required: false, options: ['Comercialización'], default: 'Comercialización', order: 9 },
    { key: 'empresa_transporte', label: 'Empresa de transporte', type: 'text', required: false, order: 10 },
    { key: 'guia_remision_transportista', label: 'G.R. transportista', type: 'text', required: false, order: 11 },
    { key: 'nombre_conductor', label: 'Nombre de conductor', type: 'text', required: false, order: 12 },
    // "Precinto de Norandino" se sacó de aquí (2026-08-01): se coloca al
    // cargar el contenedor (Packing List, "Registrar carga"), no al
    // despachar -- pedirlo también aquí era el mismo problema de "campo
    // duplicado en 2 pasos" ya detectado antes en el flujo de la orden.
    // Orden de Salida ahora lo lee de plant_container_loadings.
    { key: 'otro_precinto', label: 'Otro precinto', type: 'text', required: false, order: 14 },
  ],
  procesamiento: [
    { key: 'merma_threshold_pct', label: 'Umbral merma esperada (%)', type: 'number', required: false, min: 0, max: 100, default: 5, order: 1 },
  ],
  quintal_config: [
    { key: 'kg_per_quintal', label: 'Kg por quintal', type: 'number', required: false, min: 0, default: 50, order: 1 },
  ],
  saco_tamizado_config: [
    { key: 'kg_per_saco', label: 'Kg por saco (tamizado)', type: 'number', required: false, min: 0, default: 50, order: 1 },
  ],
}

// ─── Cache en memoria (por sesión) ──────────────────────────────────────────

const cache = {}

/**
 * Carga la configuración de campos para un paso del formulario.
 *
 * Herencia: cooperativa-específica > global (NULL) > defaults en código.
 *
 * @param {string} stepKey - Identificador del paso (ej: 'calidad', 'checklist_limpieza')
 * @param {object} [options]
 * @param {boolean} [options.skipCache=false] - Forzar recarga desde BD
 * @returns {Promise<Array>} Array de field definitions ordenados por `order`
 */
export async function loadFormConfig(cooperative, stepKey, { skipCache = false } = {}) {
  if (!skipCache && cache[stepKey]) {
    return cache[stepKey]
  }

  try {
    // Buscar config: cooperativa-específica o global (cooperative_id IS NULL)
    const { data, error } = await supabase
      .from('form_configurations')
      .select('fields, cooperative_id')
      .eq('step_key', stepKey)
      .eq('is_active', true)
      .or(`cooperative_id.eq.${cooperative.id},cooperative_id.is.null`)
      .order('cooperative_id', { ascending: false, nullsFirst: false })

    if (error) throw error

    let fields = null

    if (data && data.length > 0) {
      // Primer resultado: cooperativa-específica tiene prioridad (no es null)
      // Si solo hay global (null), usa ese
      const specific = data.find(r => r.cooperative_id !== null)
      const global = data.find(r => r.cooperative_id === null)
      fields = specific ? specific.fields : global ? global.fields : null
    }

    // Fallback a defaults en código
    if (!fields) {
      fields = DEFAULTS[stepKey] || []
    }

    // Ordenar por campo order
    fields.sort((a, b) => (a.order || 0) - (b.order || 0))

    cache[stepKey] = fields
    return fields
  } catch (err) {
    console.error(`[formConfig] Error cargando config para "${stepKey}":`, err)
    // Fallback silencioso a defaults
    return DEFAULTS[stepKey] || []
  }
}

/**
 * Carga múltiples configs de una vez.
 * @param {string[]} stepKeys
 * @returns {Promise<Object>} { stepKey: fields[] }
 */
export async function loadFormConfigs(cooperative, stepKeys) {
  const results = {}
  await Promise.all(
    stepKeys.map(async (key) => {
      results[key] = await loadFormConfig(cooperative, key)
    })
  )
  return results
}

/**
 * Limpia el cache (útil al cambiar de cooperativa).
 */
export function clearFormConfigCache() {
  Object.keys(cache).forEach(k => delete cache[k])
}

/**
 * Obtiene los defaults hardcoded para un step (sin consultar BD).
 * @param {string} stepKey
 * @returns {Array}
 */
export function getDefaults(stepKey) {
  return DEFAULTS[stepKey] || []
}

/**
 * Carga los límites del proceso de tamizado/procesamiento.
 * Usa el mismo mecanismo de herencia (cooperativa > global > defaults).
 * @returns {Promise<{ mermaThresholdPct: number }>}
 */
export async function loadProcessingLimits(cooperative) {
  const fields = await loadFormConfig(cooperative, 'procesamiento')
  const getDefault = (key, fallback) => {
    const f = fields.find(x => x.key === key)
    const v = f?.default
    const n = typeof v === 'number' ? v : parseFloat(v)
    return Number.isFinite(n) ? n : fallback
  }
  return {
    mermaThresholdPct: getDefault('merma_threshold_pct', 5),
  }
}

/**
 * Carga el factor de conversión kg → quintal (configurable por cooperativa).
 * @returns {Promise<number>}
 */
export async function loadKgPerQuintal(cooperative) {
  const fields = await loadFormConfig(cooperative, 'quintal_config')
  const f = fields.find(x => x.key === 'kg_per_quintal')
  const n = typeof f?.default === 'number' ? f.default : parseFloat(f?.default)
  return Number.isFinite(n) && n > 0 ? n : 50
}

/**
 * Carga el factor de conversión kg → saco de tamizado (configurable por
 * cooperativa) -- separado de kg_per_quintal a propósito: son unidades
 * distintas (saco de tamizado vs. quintal de envasado), pueden no pesar lo
 * mismo en la práctica de cada cooperativa.
 * @returns {Promise<number>}
 */
export async function loadKgPerSacoTamizado(cooperative) {
  const fields = await loadFormConfig(cooperative, 'saco_tamizado_config')
  const f = fields.find(x => x.key === 'kg_per_saco')
  const n = typeof f?.default === 'number' ? f.default : parseFloat(f?.default)
  return Number.isFinite(n) && n > 0 ? n : 50
}

/**
 * Carga las opciones de los desplegables del control de calidad del
 * envasado (color/sabor/textura) -- devuelve { color: string[], sabor:
 * string[], textura: string[] } listo para usar en un <select>.
 * @returns {Promise<{color: string[], sabor: string[], textura: string[]}>}
 */
export async function loadCalidadEnvasadoOptions(cooperative) {
  const fields = await loadFormConfig(cooperative, 'calidad_envasado')
  const optionsFor = (key) => fields.find(f => f.key === key)?.options ?? []
  return {
    color: optionsFor('color'),
    sabor: optionsFor('sabor'),
    textura: optionsFor('textura'),
  }
}

/**
 * Carga las áreas disponibles para el Control de Salud e Higiene del
 * Personal (SIG-GIA-RG-005).
 * @returns {Promise<string[]>}
 */
export async function loadHigienePersonalAreas(cooperative) {
  const fields = await loadFormConfig(cooperative, 'higiene_personal')
  return fields.find(f => f.key === 'area')?.options ?? []
}

/**
 * Carga las áreas físicas disponibles para el Control del Programa de
 * Limpieza y Sanitización de Ambientes (SIG-GIA-RG-002).
 * @returns {Promise<string[]>}
 */
export async function loadLimpiezaAmbientesAreas(cooperative) {
  const fields = await loadFormConfig(cooperative, 'limpieza_ambientes')
  return fields.find(f => f.key === 'area')?.options ?? []
}

/**
 * Carga los puntos de control del Control de Cloro Residual (SIG-GIA-RG-001).
 * @returns {Promise<string[]>}
 */
export async function loadCloroResidualPuntos(cooperative) {
  const fields = await loadFormConfig(cooperative, 'cloro_residual_puntos')
  return fields.find(f => f.key === 'punto')?.options ?? []
}

/**
 * Carga las áreas e ítems de la Verificación del Programa de Limpieza y
 * Sanitización (SIG-GIA-RG-009).
 * @returns {Promise<Array<{area: string, items: Array<{code: string, label: string}>}>>}
 */
export async function loadVerificacionLimpiezaAreas(cooperative) {
  const fields = await loadFormConfig(cooperative, 'verificacion_limpieza_areas')
  return fields.find(f => f.key === 'areas')?.options ?? []
}

/**
 * Carga las áreas y equipos del Control del Programa de Limpieza y
 * Sanitización de Equipos - Utensilios (SIG-GIA-RG-003).
 * @returns {Promise<Array<{area: string, items: Array<{code: string, label: string, tracksProduct?: boolean}>}>>}
 */
export async function loadLimpiezaEquiposAreas(cooperative) {
  const fields = await loadFormConfig(cooperative, 'limpieza_equipos_areas')
  return fields.find(f => f.key === 'areas')?.options ?? []
}

/**
 * Carga las áreas e ítems del Control de Limpieza fusionado de CAES
 * (CAESP-PP-HYS-RE-HYS-001) -- ver COOPERATIVE.features.limpiezaUnificada.
 * @returns {Promise<Array<{area: string, items: Array<{code: string, label: string, tipoLimpieza: string[], producto: string[]}>}>>}
 */
export async function loadLimpiezaGeneralAreas(cooperative) {
  const fields = await loadFormConfig(cooperative, 'limpieza_general_areas')
  return fields.find(f => f.key === 'areas')?.options ?? []
}

/**
 * Separa valores del formulario en columnas fijas (de la tabla) y extra_data (JSONB).
 *
 * Uso: al guardar, los campos que tienen columna propia van directo a la tabla,
 * y los campos configurables adicionales van a extra_data.
 *
 * @param {Object} values - Todos los valores del formulario { key: value }
 * @param {string[]} fixedColumns - Keys que son columnas fijas de la tabla
 * @returns {{ fixed: Object, extraData: Object }}
 */
export function splitFixedAndExtra(values, fixedColumns) {
  const fixedSet = new Set(fixedColumns)
  const fixed = {}
  const extraData = {}

  for (const [key, value] of Object.entries(values)) {
    if (fixedSet.has(key)) {
      // '' -> null: un campo opcional vacío (ej. una fecha sin completar) no
      // es un string vacío válido para una columna date/numeric de Postgres
      // -- "" tira 'invalid input syntax for type date', null se guarda bien.
      fixed[key] = value === '' ? null : value
    } else if (value !== '' && value !== null && value !== undefined) {
      extraData[key] = value
    }
  }

  return { fixed, extraData }
}

/**
 * Combina columnas fijas con extra_data para reconstruir los valores completos
 * de un registro (útil al cargar un registro para mostrarlo o editarlo).
 *
 * @param {Object} record - Registro de la BD (con sus columnas fijas)
 * @param {string[]} fixedColumns - Keys que son columnas fijas
 * @returns {Object} Valores combinados
 */
export function mergeRecordValues(record, fixedColumns) {
  const values = {}
  const fixedSet = new Set(fixedColumns)

  // Primero las columnas fijas
  for (const key of fixedColumns) {
    if (record[key] !== undefined) {
      values[key] = record[key]
    }
  }

  // Luego extra_data (si existe)
  if (record.extra_data && typeof record.extra_data === 'object') {
    for (const [key, value] of Object.entries(record.extra_data)) {
      if (!fixedSet.has(key)) {
        values[key] = value
      }
    }
  }

  return values
}
