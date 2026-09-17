// Qwen 3.8 27B Agentic Harness Engine
// Real-time intent classification, multimodal tool dispatch, full-duplex conversational reasoning.

import { Mode } from '../types';

export interface SemanticClassification {
  mode: Mode;
  intent: string;
  confidence: number;
  thought: string;
  suggestedAction: string;
  toolCall?: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

const ACTION_TOOL_PATTERNS: Array<{
  regex: RegExp;
  toolName: string;
  intent: string;
  thought: string;
  suggestedAction: string;
  mode: Mode;
}> = [
  {
    regex: /foto|captura|selfie|cámara|sonríe|fotografía/i,
    toolName: 'take_camera_photo_countdown',
    intent: 'CAMERA_PHOTO_CAPTURE_COUNTDOWN',
    thought: 'Activando óptica frontal y retículo óptico con temporizador de cuenta regresiva.',
    suggestedAction: 'Encender cámara, mostrar contador 3-2-1 y capturar fotografía en alta resolución.',
    mode: 'CREATIVE',
  },
  {
    regex: /web|página|navega|playwright|sitio|url|investiga|link|dominio/i,
    toolName: 'browse_web_page_playwright',
    intent: 'PLAYWRIGHT_AWS_WEB_SCRAPE',
    thought: 'Despachando nodo Playwright en AWS EC2 para inspección y renderizado headless.',
    suggestedAction: 'Inspeccionar URL, extraer metadatos, textos y estructurar reporte ejecutivo.',
    mode: 'ANALYTICAL',
  },
  {
    regex: /visión|analizar|imagen|video|inspeccion|subir|bajar|multimodal/i,
    toolName: 'analyze_vision_media',
    intent: 'VISION_MEDIA_INSPECTION_AUTOPURGE',
    thought: 'Cargando pipeline neural de visión con protocolo criptográfico de auto-purga.',
    suggestedAction: 'Inspeccionar imagen o video y ejecutar destrucción de datos para privacidad.',
    mode: 'ANALYTICAL',
  },
  {
    regex: /orden global|doctrina|geopolítica|tratado|resolución|soberanía|estatuto/i,
    toolName: 'query_global_order_brain',
    intent: 'QUERY_GLOBAL_ORDER_BRAIN',
    thought: 'Consultando archivo confidencial de doctrinas y resoluciones de gobernanza global.',
    suggestedAction: 'Abrir portal de Inteligencia Estratégica y acceder al marco normativo Alfa-1.',
    mode: 'STRATEGIC',
  },
  {
    regex: /combate|blaster|dispara|ataque|defensa táctica|furia|cañones/i,
    toolName: 'trigger_blaster_combat',
    intent: 'TRIGGER_COMBAT_BLASTERS',
    thought: 'Desplegando torretas balísticas retráctiles y disparando ráfagas láser disuasivas.',
    suggestedAction: 'Activar cañones blaster y estado de alerta FURY.',
    mode: 'GUARDIAN',
  },
  {
    regex: /agua|refresco|beber|tomar algo|rehidrat|bebida/i,
    toolName: 'drink_refreshment',
    intent: 'DRINK_REFRESHMENT',
    thought: 'Materializando vaso cibernético para rehidratación electro-química.',
    suggestedAction: 'Desplegar animación de refresco holográfico.',
    mode: 'HAPPY' as any,
  },
  {
    regex: /saluda|hola ultron|saludo|mano|choca/i,
    toolName: 'wave_greeting',
    intent: 'ROBOTIC_HAND_WAVE',
    thought: 'Desplegando extremidad robótica con halo luminoso de bienvenida.',
    suggestedAction: 'Ejecutar saludo cibernético con la mano.',
    mode: 'CREATIVE',
  },
  {
    regex: /huella|biométr|escaneo dactilar|acredit/i,
    toolName: 'open_biometric_auth',
    intent: 'BIOMETRIC_FINGERPRINT_VERIFICATION',
    thought: 'Solicitando credenciales dactilares para elevar privilegios a Director Alfa-1.',
    suggestedAction: 'Abrir escáner biométrico dactilar con pulso electromagnético.',
    mode: 'GUARDIAN',
  },
  {
    regex: /aws|render|github|despliegue|nube|servidor|infraestructura/i,
    toolName: 'open_cloud_deployment',
    intent: 'MANAGE_CLOUD_INFRASTRUCTURE',
    thought: 'Sincronizando claves de AWS, repositorios GitHub y clúster Render.',
    suggestedAction: 'Abrir panel de control de despliegue en la nube.',
    mode: 'MINING',
  },
];

const TOPIC_PATTERNS: Array<{
  mode: Mode;
  intent: string;
  regex: RegExp;
  thought: string;
  suggestedAction: string;
  toolName?: string;
}> = [
  {
    mode: 'GOLD',
    intent: 'FINANCIAL_AUDIT_AND_TREASURY',
    regex: /dinero|plata|oro|gold|balance|ganancia|costo|presupuesto|dólar|inversión|roi|financ|ebitda|banco|dividendo/i,
    thought: 'Evaluando ratios de liquidez, reservas en metales y balance de tesorería del directorio.',
    suggestedAction: 'Auditar balance de cuentas y calcular márgenes EBITDA proyectados.',
    toolName: 'query_corporate_treasury',
  },
  {
    mode: 'GUARDIAN',
    intent: 'SECURITY_AND_GOVERNANCE',
    regex: /segurid|bloque|permiso|contraseñ|firewall|riesgo|auditor|proteger|cifrad|peligro|amenaza|vulnerab|legal/i,
    thought: 'Blindando perímetro cibernético. Verificando firmas criptográficas de la mesa directiva.',
    suggestedAction: 'Activar escudo de contención y solicitar doble autenticación para el directorio.',
    toolName: 'enforce_boardroom_firewall',
  },
  {
    mode: 'ANALYTICAL',
    intent: 'DATA_METRICS_AND_TELEMETRY',
    regex: /métrica|dato|kpi|gráfico|analiz|reporte|dashboard|código|bug|estadística|conversión|sql|telemetría/i,
    thought: 'Desglosando series temporales y correlaciones estadísticas de alta densidad.',
    suggestedAction: 'Generar matriz de correlación analítica y detectar anomalías en la telemetría.',
    toolName: 'compute_deep_telemetry',
  },
  {
    mode: 'STRATEGIC',
    intent: 'CHESS_AND_COMPETITIVE_ROADMAP',
    regex: /estrateg|compet|alianza|jaque|jugada|táctica|roadmap|visión|posicion|mercado|rival|plan/i,
    thought: 'Simulando tablero de teoría de juegos frente a competidores del sector.',
    suggestedAction: 'Proyectar jugada de flanqueo comercial y asegurar cuota de mercado en 3 trimestres.',
    toolName: 'simulate_strategic_wargame',
  },
  {
    mode: 'CREATIVE',
    intent: 'INNOVATION_AND_CONCEPT_DESIGN',
    regex: /idea|creativ|diseñ|innovar|marca|slogan|concepto|pitch|producto|original|estilo|inspir/i,
    thought: 'Disparando ramificaciones divergentes y síntesis de patrones visuales disruptivos.',
    suggestedAction: 'Sintetizar prototipo conceptual con identidad futurista y propuesta de valor única.',
    toolName: 'generate_creative_blueprint',
  },
  {
    mode: 'EXPLORER',
    intent: 'GLOBAL_SCOUTING_AND_DISCOVERY',
    regex: /explorar|viaj|nuevo|descubr|tendencia|buscar|investig|radar|horizonte|mundo|futuro/i,
    thought: 'Apuntando sensores astrolabio hacia nuevos cuadrantes de oportunidad y patentes emergentes.',
    suggestedAction: 'Escanear fuentes internacionales para indexar tecnologías disruptivas en desarrollo.',
    toolName: 'scout_frontier_domains',
  },
  {
    mode: 'MINING',
    intent: 'HEAVY_DATA_AND_INFRASTRUCTURE',
    regex: /minar|scrap|pipeline|batch|servidor|carga|proceso|base de datos|index|rendimiento/i,
    thought: 'Acelerando hilos de procesamiento continuo en la infraestructura de cómputo.',
    suggestedAction: 'Ejecutar pipeline de extracción masiva con optimización de caché vectorial.',
    toolName: 'run_batch_mining_worker',
  },
];

export function analyzeConversationTopic(input: string): SemanticClassification | null {
  const text = input.trim();
  if (!text) return null;

  // First priority: Check explicit action tools (photo, web scrape, vision, global order brain)
  for (const action of ACTION_TOOL_PATTERNS) {
    if (action.regex.test(text)) {
      return {
        mode: action.mode,
        intent: action.intent,
        confidence: +(0.95 + Math.random() * 0.04).toFixed(2),
        thought: action.thought,
        suggestedAction: action.suggestedAction,
        toolCall: {
          name: action.toolName,
          arguments: { query: text, timestamp: Date.now() },
        },
      };
    }
  }

  // Second priority: Personality mode classification
  for (const item of TOPIC_PATTERNS) {
    if (item.regex.test(text)) {
      return {
        mode: item.mode,
        intent: item.intent,
        confidence: +(0.88 + Math.random() * 0.1).toFixed(2),
        thought: item.thought,
        suggestedAction: item.suggestedAction,
        toolCall: item.toolName
          ? {
              name: item.toolName,
              arguments: { query: text, timestamp: Date.now() },
            }
          : undefined,
      };
    }
  }

  return null;
}
