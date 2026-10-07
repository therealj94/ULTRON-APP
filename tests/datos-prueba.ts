/**
 * LA JUNTA DE LAS PRUEBAS: inventada, con la misma forma que la de producción (lib/datos-privados.ts). Lo personal
 * de verdad vive en Render, no en el repositorio (es público; auditoría del 7-oct, C-1). Una prueba que necesita a la
 * junta importa esto PRIMERO (antes que el código que lee el entorno al cargar); lo que la prueba ya puso, se respeta.
 * No es un archivo de pruebas (`*.test.ts`).
 */
export const DATOS_PRUEBA: Record<string, string> = {
  ULTRON_PADRON_BASE: "[{\"id\": \"jose\", \"nombre\": \"José\", \"correos\": [\"j.herrera@ordenglobal.org\", \"jose.h@ordenglobal.org\"], \"telegram\": [], \"apodos\": [\"j\"], \"acceso\": {\"ultron\": \"mando\", \"electrum\": \"mando\"}}, {\"id\": \"ramiro\", \"nombre\": \"Ramiro\", \"correos\": [\"r.herrera@ordenglobal.org\", \"ramiro@ordenglobal.org\"], \"telegram\": [], \"apodos\": [], \"acceso\": {\"ultron\": \"mando\", \"electrum\": \"mando\"}}, {\"id\": \"carlos\", \"nombre\": \"Carlos\", \"correos\": [], \"telegram\": [], \"apodos\": [\"sagastume\", \"rodrigo sagastume\"], \"acceso\": {\"ultron\": \"lee\"}}, {\"id\": \"brenda\", \"nombre\": \"Brenda\", \"correos\": [], \"telegram\": [], \"apodos\": [\"villeda\"], \"acceso\": {\"ultron\": \"lee\"}}]",
  AURA_JUNTA: "{\"j.herrera@ordenglobal.org\": {\"nombre\": \"José\", \"rol\": \"Junta Directiva · Orden Global\"}, \"r.herrera@ordenglobal.org\": {\"nombre\": \"Ramiro\", \"rol\": \"Junta Directiva · Orden Global\"}}",
  AURA_CORREOS_ALIAS: "{\"jose.personal.prueba@gmail.com\": \"j.herrera@ordenglobal.org\", \"ramiro@ordenglobal.org\": \"r.herrera@ordenglobal.org\"}",
  AURA_HECHOS_SEMILLA: "[\"Junta: Ramiro Herrera fundador; José, Fabiola Herrera y Rodrigo Sagastume cofundadores. Brenda Villeda también junta.\", \"José Herrera: cofundador, junta, habla con AU-RA. Acceso mando: puede cambiar el sistema.\", \"Ramiro José Herrera Villeda: fundador. The Verve — Bitter Sweet Symphony. Acceso mando.\", \"José Herrera: Kanye West — Runaway (el brindis).\", \"Carlos Sagastume: junta. Acceso consulta a AU-RA. Cerebro propio. No cambia el sistema.\", \"Brenda Villeda: junta. Acceso consulta a AU-RA. Cerebro propio. No cambia el sistema.\"]",
  AURA_PERSONAS_CLAVE: "ramiro, jose herr, fabiola, sagastume",
  AURA_NOMBRES_JUNTA: "ramiro, jose, fabiola, sagastume, rodrigo, brenda, carlos",
  AURA_NOMBRES_JUNTA_PUBLICO: "ramiro, jose, fabiola, sagastume, rodrigo",
  AURA_NOMBRES_TEMA_OG: "ramiro, fabiola, sagastume, brenda",
  AURA_CONOCIMIENTO_PERSONAS: "{\"personas\": \"- Fundador: Ramiro José Herrera Villeda (Ramiro). Junta. Canción: The Verve — Bitter Sweet Symphony.\\n- Cofundador: José Herrera (José). Junta. Habla con AU-RA. Canción: Kanye — Runaway (brindis). Extra: Bruno Mars — Die With A Smile.\\n- Cofundadora: Fabiola Herrera.\\n- Cofundador: Carlos Rodrigo Sagastume (Rodrigo Sagastume). En prensa 2024: director de operaciones globales de Orden Global Corp. Explicó ORIGEN, AUKA, ONDK y OrdenEx en Tegucigalpa.\\n- Junta: Brenda Villeda. Acceso a AU-RA FP por Telegram. Cerebro propio. Consulta: no cambia el sistema (sin redespliegue, sin mantenimiento, sin ejecutor).\\n- Carlos Sagastume en AU-RA: mismo acceso consulta que Brenda. Cerebro propio. No se mezcla con José ni Ramiro.\\n- Prensa ago-2024 también nombra a Jackson Wilson como CEO de Orden Global Corp (lanzamiento NZ). No mezclar: Ramiro funda; José, Fabiola y Rodrigo cofundan.\", \"legal\": \"- Sagastume: metal + chain contra inflación e inestabilidad regional.\", \"reglas\": \"- Ramiro fundador. José, Fabiola y Rodrigo Sagastume cofundadores.\"}",
  AURA_CONOCIMIENTO_PERSONAS_PUBLICO: "{\"personas\": \"- Fundador: Ramiro José Herrera Villeda (Ramiro).\\n- Cofundador: José Herrera (José).\\n- Cofundadora: Fabiola Herrera.\\n- Cofundador: Carlos Rodrigo Sagastume (Rodrigo Sagastume). En prensa 2024: director de operaciones globales de Orden Global Corp. Explicó ORIGEN, AUKA, ONDK y OrdenEx en Tegucigalpa.\\n- Prensa ago-2024 también nombra a Jackson Wilson como CEO de Orden Global Corp (lanzamiento NZ). No mezclar: Ramiro funda; José, Fabiola y Rodrigo cofundan.\", \"lanzamiento\": \"- Sagastume (prensa): metal + cadena contra la inflación y la inestabilidad regional.\", \"reglas\": \"- Ramiro fundador. José, Fabiola y Rodrigo Sagastume cofundadores.\"}",
  AURA_ORACION_BENDICE: "{\"es\": \"Bendice a José. Bendice a Ramiro. Bendice a Fabiola, a Rodrigo, a Brenda, a Carlos,\", \"en\": \"Bless José. Bless Ramiro. Bless Fabiola, Rodrigo, Brenda and Carlos,\"}",
  AURA_CANCION_DE: "{\"ramiro\": \"bittersweet\"}",
  CUENTAS_APROBADOR: "j.herrera@ordenglobal.org",
  ELEVENLABS_AGENTE_OJOS_ES: "agent_prueba_ojos_es",
  ELEVENLABS_AGENTE_OJOS_EN: "agent_prueba_ojos_en",
  ELEVENLABS_AGENTE_AURA_ES: "agent_prueba_aura_es",
  ELEVENLABS_AGENTE_AURA_EN: "agent_prueba_aura_en",
  ELEVENLABS_AGENTE_CLAUDIO_ES: "agent_prueba_claudio_es",
  ELEVENLABS_AGENTE_CLAUDIO_EN: "agent_prueba_claudio_en",
  ELEVENLABS_AGENTE_ANTONIO_ES: "agent_prueba_antonio_es",
  ELEVENLABS_AGENTE_ANTONIO_EN: "agent_prueba_antonio_en",
};

for (const [k, v] of Object.entries(DATOS_PRUEBA)) if (process.env[k] === undefined) process.env[k] = v;
