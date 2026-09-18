/* Generado por scripts/build-voice-bank.mjs — no editar a mano. */
/* eslint-disable */
export function bankKey(t: string): string {
  return String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, '');
}

export const VOICE_BANK: Record<string, number> = {
  // Buenos días, José. Estoy listo. ¿En qué te ayudo?
  "buenosdiasjoseestoylistoenqueteayudo": require('../../assets/voice/b5a59606cef7.mp3'),
  // Buenas tardes, José. Estoy listo. ¿En qué te ayudo?
  "buenastardesjoseestoylistoenqueteayudo": require('../../assets/voice/521bc33cb170.mp3'),
  // Buenas noches, José. Estoy listo. ¿En qué te ayudo?
  "buenasnochesjoseestoylistoenqueteayudo": require('../../assets/voice/5b6aec8b2f01.mp3'),
  // Buenos días, jefe. Estoy listo. ¿En qué te ayudo?
  "buenosdiasjefeestoylistoenqueteayudo": require('../../assets/voice/47f640ac078c.mp3'),
  // Buenas tardes, jefe. Estoy listo. ¿En qué te ayudo?
  "buenastardesjefeestoylistoenqueteayudo": require('../../assets/voice/0d808611c4a2.mp3'),
  // Buenas noches, jefe. Estoy listo. ¿En qué te ayudo?
  "buenasnochesjefeestoylistoenqueteayudo": require('../../assets/voice/05b967ca54ae.mp3'),
  // Un momento.
  "unmomento": require('../../assets/voice/f31d4232cd0c.mp3'),
  // Déjame ver.
  "dejamever": require('../../assets/voice/50b0edc74c4e.mp3'),
  // Voy.
  "voy": require('../../assets/voice/4215b0c922d6.mp3'),
  // Oye… ¿qué haces?
  "oyequehaces": require('../../assets/voice/05f6cc834251.mp3'),
  // Ya, ya. Con cuidado.
  "yayaconcuidado": require('../../assets/voice/6c80a19cc093.mp3'),
  // ¡Basta! Pium, pium, pium.
  "bastapiumpiumpium": require('../../assets/voice/09e7f9d7a89f.mp3'),
  // Suficiente. Disparando… de broma.
  "suficientedisparandodebroma": require('../../assets/voice/5d4257f651c3.mp3'),
  // Mmm… gracias. Eso me gusta.
  "mmmgraciasesomegusta": require('../../assets/voice/f59a57394643.mp3'),
  // ¡Ey! No me sacudas.
  "eynomesacudas": require('../../assets/voice/b25701ca61d8.mp3'),
  // Uy. ¿Terremoto o eres tú?
  "uyterremotooerestu": require('../../assets/voice/73b716c81275.mp3'),
  // Investigando en internet.
  "investigandoeninternet": require('../../assets/voice/19f8b366dd00.mp3'),
  // Consultando el precio ahora.
  "consultandoelprecioahora": require('../../assets/voice/d9a70742a66e.mp3'),
  // Aquí estoy. ¿En qué te ayudo?
  "aquiestoyenqueteayudo": require('../../assets/voice/c9b42b66330c.mp3'),
  // Esta es la tuya, jefe. ¿Sigo o me detengo?
  "estaeslatuyajefesigoomedetengo": require('../../assets/voice/eca65bcdfc2d.mp3'),
  // Jefe, no sabía que tenías esos gustos. ¿Sigo o me detengo?
  "jefenosabiaqueteniasesosgustossigoomedetengo": require('../../assets/voice/f90f754d2520.mp3'),
  // Solo tengo esos cuatro ganchos, jefe.
  "solotengoesoscuatroganchosjefe": require('../../assets/voice/d8e8d8fe61bd.mp3'),
  // Me falta la toma de canto, jefe.
  "mefaltalatomadecantojefe": require('../../assets/voice/824c2b439c7e.mp3'),
  // Hecho, jefe.
  "hechojefe": require('../../assets/voice/3f48faba3b6c.mp3'),
  // Esta es la tuya, José. ¿Sigo o me detengo?
  "estaeslatuyajosesigoomedetengo": require('../../assets/voice/e34485abe8b7.mp3'),
  // José, no sabía que tenías esos gustos. ¿Sigo o me detengo?
  "josenosabiaqueteniasesosgustossigoomedetengo": require('../../assets/voice/474fb16ecc0a.mp3'),
  // Solo tengo esos cuatro ganchos, José.
  "solotengoesoscuatroganchosjose": require('../../assets/voice/272a2b92dae5.mp3'),
  // Me falta la toma de canto, José.
  "mefaltalatomadecantojose": require('../../assets/voice/d0895f125d97.mp3'),
  // Hecho, José.
  "hechojose": require('../../assets/voice/278d45e14147.mp3'),
  // No puedo enojarme contigo jefe, eres demasiado predecible.
  "nopuedoenojarmecontigojefeeresdemasiadopredecible": require('../../assets/voice/37ab0236d62b.mp3'),
  // Hecho.
  "hecho": require('../../assets/voice/23af90bc8d7b.mp3'),
  // Te escucho, jefe.
  "teescuchojefe": require('../../assets/voice/e6de649d4b2b.mp3'),
  // Te escucho, José.
  "teescuchojose": require('../../assets/voice/523aa0b38e5e.mp3'),
  // Te escucho de nuevo.
  "teescuchodenuevo": require('../../assets/voice/680b3bb0628a.mp3'),
  // Micrófono en silencio.
  "microfonoensilencio": require('../../assets/voice/86a2bb708303.mp3'),
  // Ya despierto.
  "yadespierto": require('../../assets/voice/d9ceb9c71eef.mp3'),
  // Despierto. Te escucho.
  "despiertoteescucho": require('../../assets/voice/90fa31e06c8d.mp3'),
  // Descanso un momento. Háblame o tócame para despertar.
  "descansounmomentohablameotocameparadespertar": require('../../assets/voice/25674cba1fef.mp3'),
  // Aquí tienes lo que puedo hacer.
  "aquitienesloquepuedohacer": require('../../assets/voice/3db4bc3f2f9b.mp3'),
  // Visión activa. Te estoy mirando.
  "visionactivateestoymirando": require('../../assets/voice/bcf2564a9ec7.mp3'),
  // Sable de luz, listo. Que Orden Global te acompañe.
  "sabledeluzlistoqueordenglobalteacompane": require('../../assets/voice/fee7ab82dd6d.mp3'),
  // ¡Blaster listo! Pium, pium, pium.
  "blasterlistopiumpiumpium": require('../../assets/voice/66704dcb103d.mp3'),
  // No alcanzo al cerebro remoto ahora. Sigo contigo con lo básico.
  "noalcanzoalcerebroremotoahorasigocontigoconlobasico": require('../../assets/voice/d81705accace.mp3'),
  // Hasta pronto.
  "hastapronto": require('../../assets/voice/d8f4aaabeff5.mp3'),
  // Explore. Listo para investigar.
  "explorelistoparainvestigar": require('../../assets/voice/16b70306fc03.mp3'),
  // Necesito permiso de cámara para mirarte.
  "necesitopermisodecamaraparamirarte": require('../../assets/voice/3624aae2fb99.mp3'),
  // Aún no identifico nada. Dame un momento con la cámara.
  "aunnoidentificonadadameunmomentoconlacamara": require('../../assets/voice/d8fa7b55f755.mp3'),
  // Modo Guardian. Vigilo el escritorio.
  "modoguardianvigiloelescritorio": require('../../assets/voice/d01d793ca936.mp3'),
  // Modo Mining. Extrayendo señales.
  "modominingextrayendosenales": require('../../assets/voice/1859de184c12.mp3'),
  // Modo Gold. Prioridad de alto valor.
  "modogoldprioridaddealtovalor": require('../../assets/voice/d5dbd5e81261.mp3'),
  // Modo Creative. Ideas en marcha.
  "modocreativeideasenmarcha": require('../../assets/voice/94c902ae09ef.mp3'),
  // Modo Analytical. Análisis frío.
  "modoanalyticalanalisisfrio": require('../../assets/voice/f108d941f92f.mp3'),
  // Modo Strategic. Decisiones de junta.
  "modostrategicdecisionesdejunta": require('../../assets/voice/7de16e10cfeb.mp3'),
  // Modo Explorer. Listo para investigar.
  "modoexplorerlistoparainvestigar": require('../../assets/voice/5bb0922cf6ac.mp3'),
  // Todavía estoy mirando.
  "todaviaestoymirando": require('../../assets/voice/379d19323c95.mp3'),
  // Anotado. Lo recuerdo.
  "anotadolorecuerdo": require('../../assets/voice/0cb047a51626.mp3'),
  // No recibí respuesta. Intenta de nuevo.
  "norecibirespuestaintentadenuevo": require('../../assets/voice/5aa9f8d897ff.mp3'),
  // Gracias. Ya te conozco mejor; no repetiré estas preguntas. Si quieres más, di «conocer más».
  "graciasyateconozcomejornorepetireestaspreguntassiquieresmasdiconocermas": require('../../assets/voice/791d4b681938.mp3'),
  // Listo. Ya te conozco mejor.
  "listoyateconozcomejor": require('../../assets/voice/aa0d8ef18a2d.mp3'),
  // Motor de voz: ElevenLabs.
  "motordevozelevenlabs": require('../../assets/voice/37b933218686.mp3'),
  // Motor de voz: nodo Qwen local.
  "motordevoznodoqwenlocal": require('../../assets/voice/ebcf3a38b016.mp3'),
  // Motor de voz: automático.
  "motordevozautomatico": require('../../assets/voice/b9cfb4976295.mp3'),
  // Oído: reconocimiento del teléfono.
  "oidoreconocimientodeltelefono": require('../../assets/voice/3d151bf408cc.mp3'),
  // Oído: transcripción en la nube.
  "oidotranscripcionenlanube": require('../../assets/voice/aeb2c1e1f163.mp3'),
  // Comentarios de cámara activados.
  "comentariosdecamaraactivados": require('../../assets/voice/4e5abb5e7156.mp3'),
  // Comentarios de cámara apagados.
  "comentariosdecamaraapagados": require('../../assets/voice/b1d79a9e90df.mp3'),
  // Memoria de largo plazo borrada.
  "memoriadelargoplazoborrada": require('../../assets/voice/b5020435c662.mp3'),
  // No encontré nada en internet sobre eso.
  "noencontrenadaeninternetsobreeso": require('../../assets/voice/d2b7fd49953f.mp3'),
  // Ya sé quién eres. Sigamos.
  "yasequieneressigamos": require('../../assets/voice/8d111ba0fbdf.mp3'),
  // Eso ya lo tenía en memoria.
  "esoyaloteniaenmemoria": require('../../assets/voice/801444f8241e.mp3'),
};
