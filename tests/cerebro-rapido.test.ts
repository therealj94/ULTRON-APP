/**
 * El cerebro rápido de la voz (lib/cerebro-rapido.ts): qué turnos van por Bedrock, cómo se le pasan los
 * mensajes, y que se eche para atrás («PASO») sin decir nada cuando le piden hacer algo.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aBedrock, anotarExitoRapido, anotarFalloRapido, cerebroRapidoActivo, esPaso, esSoloConversacion, podriaSerPaso, FALLOS_PARA_APAGAR, MODELO_RAPIDO_OMISION } from '../lib/cerebro-rapido';
import { resetInterruptoresTest } from '../lib/cognitivo/interruptor';

describe('Cerebro rápido: qué turnos van por aquí', () => {
  it('preguntas y charla sí', () => {
    for (const t of [
      '¿Qué hora es en Tokio si aquí son las ocho?',
      'Cuéntame un chiste corto.',
      '¿Cuál es la capital de Australia?',
      'Explícame en una frase qué es la inflación.',
      'Oye, ¿tú me entiendes bien?',
      'Dime algo motivador para empezar el día.',
      '¿Cuántos días tiene febrero en un año bisiesto?',
      '¿Me escuchas bien?',
    ])
      assert.equal(esSoloConversacion(t), true, t);
  });

  it('lo que pide hacer algo o un dato de hoy, no (lo hace Qwen)', () => {
    for (const t of [
      'Escríbele a Beto que llego tarde.',
      'Hazme el favor de ponerme música de Marco Antonio Solís.',
      'Llámame en diez minutos.',
      'Recuérdame comprar leche.',
      'Envíale un WhatsApp a mi mamá.',
      '¿A cómo está el oro hoy?',
      'Ponlo en modo oscuro.',
      'Sí, mándalo.',
      'Abre mis correos.',
      '¿Qué tiempo hace en San Pedro?',
      'Busca quién ganó el partido.',
      'Traduce hola al inglés.',
      'Dale.',
    ])
      assert.equal(esSoloConversacion(t), false, t);
  });

  it('vacío o larguísimo no', () => {
    assert.equal(esSoloConversacion(''), false);
    assert.equal(esSoloConversacion('a '.repeat(300)), false);
  });
});

describe('Cerebro rápido: «PASO»', () => {
  it('reconoce el PASO con o sin etiqueta de ánimo', () => {
    assert.equal(esPaso('PASO'), true);
    assert.equal(esPaso('[EMO: neutral] PASO'), true);
    assert.equal(esPaso('  paso.'), true);
    assert.equal(esPaso('Pasó algo raro hoy'), false);
    assert.equal(esPaso('[EMO: feliz] ¡Claro!'), false);
  });

  it('espera a saber antes de soltar nada', () => {
    assert.equal(podriaSerPaso('[EMO: neu'), true, 'la etiqueta no ha cerrado');
    assert.equal(podriaSerPaso('[EMO: neutral] PA'), true);
    assert.equal(podriaSerPaso('P'), true);
    assert.equal(podriaSerPaso('[EMO: neutral] La'), false);
    assert.equal(podriaSerPaso('Claro'), false);
  });
});

describe('Cerebro rápido: mensajes para Bedrock', () => {
  it('el system aparte, alternando, empezando y terminando por la persona', () => {
    const r = aBedrock([
      { role: 'system', content: 'Eres AU-RA.' },
      { role: 'assistant', content: 'Hola, ¿en qué te ayudo?' },
      { role: 'user', content: 'Hola' },
      { role: 'user', content: '¿Qué hora es?' },
      { role: 'assistant', content: 'Las ocho.' },
      { role: 'user', content: 'Gracias' },
      { role: 'assistant', content: '' },
    ]);
    assert.deepEqual(r.system, [{ text: 'Eres AU-RA.' }]);
    assert.deepEqual(
      r.messages.map((m) => [m.role, (m.content?.[0] as any).text]),
      [
        ['user', 'Hola\n\n¿Qué hora es?'],
        ['assistant', 'Las ocho.'],
        ['user', 'Gracias'],
      ]
    );
  });

  it('si termina en el asistente, se quita hasta la última de la persona', () => {
    const r = aBedrock([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
    assert.deepEqual(r.messages.map((m) => m.role), ['user']);
  });
});

describe('Cerebro rápido: cuándo está activo', () => {
  it('con credenciales de AWS y sin CEREBRO_VOZ=qwen', () => {
    assert.equal(cerebroRapidoActivo({ AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' } as any), true);
    assert.equal(cerebroRapidoActivo({ AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b', CEREBRO_VOZ: 'qwen' } as any), false);
    assert.equal(cerebroRapidoActivo({} as any), false, 'sin credenciales (las pruebas y el CI): Qwen');
  });

  it('también con un perfil, un rol de ECS/EC2 o una identidad web (la cadena del SDK)', () => {
    assert.equal(cerebroRapidoActivo({ AWS_PROFILE: 'jose' } as any), true);
    assert.equal(cerebroRapidoActivo({ AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/x' } as any), true);
    assert.equal(cerebroRapidoActivo({ AWS_WEB_IDENTITY_TOKEN_FILE: '/t' } as any), true);
  });

  it('se apaga al tercer fallo seguido, no al primero; un éxito pone la cuenta en cero', () => {
    resetInterruptoresTest();
    const env = { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' } as any;
    assert.equal(FALLOS_PARA_APAGAR, 3);
    anotarFalloRapido();
    anotarFalloRapido();
    assert.equal(cerebroRapidoActivo(env), true, 'dos tropiezos no lo apagan');
    anotarExitoRapido();
    anotarFalloRapido();
    anotarFalloRapido();
    assert.equal(cerebroRapidoActivo(env), true, 'tras un éxito la cuenta empezó de nuevo');
    anotarFalloRapido();
    assert.equal(cerebroRapidoActivo(env), false, 'al tercero seguido, se apaga un rato');
    resetInterruptoresTest();
    assert.equal(cerebroRapidoActivo(env), true);
  });

  it('por omisión, el que se midió mejor (Qwen3 235B en Bedrock)', () => {
    assert.equal(MODELO_RAPIDO_OMISION, 'qwen.qwen3-235b-a22b-2507-v1:0');
  });
});
