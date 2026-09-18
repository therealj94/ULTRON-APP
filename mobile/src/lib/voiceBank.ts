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
  // Buenos días, Medardo. Estoy listo. ¿En qué te ayudo?
  "buenosdiasmedardoestoylistoenqueteayudo": require('../../assets/voice/f81f315f598d.mp3'),
  // Buenas tardes, Medardo. Estoy listo. ¿En qué te ayudo?
  "buenastardesmedardoestoylistoenqueteayudo": require('../../assets/voice/24c28f17f220.mp3'),
  // Buenas noches, Medardo. Estoy listo. ¿En qué te ayudo?
  "buenasnochesmedardoestoylistoenqueteayudo": require('../../assets/voice/97730cc68816.mp3'),
  // Un momento.
  "unmomento": require('../../assets/voice/f31d4232cd0c.mp3'),
  // Déjame ver.
  "dejamever": require('../../assets/voice/50b0edc74c4e.mp3'),
  // Claro, dame un segundo.
  "clarodameunsegundo": require('../../assets/voice/91731792bea6.mp3'),
  // Voy.
  "voy": require('../../assets/voice/4215b0c922d6.mp3'),
  // ¿Sí?
  "si": require('../../assets/voice/7dd9b3388122.mp3'),
  // Jeje.
  "jeje": require('../../assets/voice/ad930d57ccd7.mp3'),
  // Aquí estoy.
  "aquiestoy": require('../../assets/voice/1af31b4b2611.mp3'),
  // Te veo.
  "teveo": require('../../assets/voice/2c6ae495853a.mp3'),
  // Oye… ¿qué haces?
  "oyequehaces": require('../../assets/voice/05f6cc834251.mp3'),
  // Ya, ya. Con cuidado.
  "yayaconcuidado": require('../../assets/voice/6c80a19cc093.mp3'),
  // Mmm, eso hace cosquillas… para.
  "mmmesohacecosquillaspara": require('../../assets/voice/2d72eb444d93.mp3'),
  // ¡Basta! Pium, pium, pium.
  "bastapiumpiumpium": require('../../assets/voice/09e7f9d7a89f.mp3'),
  // ¡Te lo advertí! Pium, pium.
  "teloadvertipiumpium": require('../../assets/voice/96e1fbeb4849.mp3'),
  // Suficiente. Disparando… de broma.
  "suficientedisparandodebroma": require('../../assets/voice/5d4257f651c3.mp3'),
  // Mmm… gracias. Eso me gusta.
  "mmmgraciasesomegusta": require('../../assets/voice/f59a57394643.mp3'),
  // Vale, vale. Sigo contigo.
  "valevalesigocontigo": require('../../assets/voice/0b155a4bbd21.mp3'),
  // ¡Ey! No me sacudas.
  "eynomesacudas": require('../../assets/voice/b25701ca61d8.mp3'),
  // Uy. ¿Terremoto o eres tú?
  "uyterremotooerestu": require('../../assets/voice/73b716c81275.mp3'),
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
};
