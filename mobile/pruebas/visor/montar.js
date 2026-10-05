// Un renderizador de React mínimo para node (react-reconciler, el que ya trae la app con Skia): MONTA el componente
// de verdad —estado, efectos, intervalos, re-render— sobre un árbol de objetos { type, props, children }. Los
// primitivos de React Native (shims/react-native.js) son etiquetas: aquí quedan como nodos con sus props, y la prueba
// toca los mandos llamando a los manejadores reales del componente (onChangeText, onSubmitEditing, onPress).
//
// Va DENTRO del paquete (construir.cjs): así el componente y el renderizador comparten el mismo React.
import React from 'react';
import Reconciler from 'react-reconciler';

const DEFAULT = 32; // DefaultEventPriority
let prioridad = 0;

const anfitrion = {
  rendererPackageName: 'aura-pruebas-visor',
  rendererVersion: '0.0.0',
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsMicrotasks: true,
  scheduleMicrotask: (f) => queueMicrotask(f),
  isPrimaryRenderer: true,
  warnsIfNotActing: false,
  noTimeout: -1,
  // El reloj de React va con los temporizadores de verdad (la prueba falsifica los del componente).
  scheduleTimeout: (f, ms) => TEMPORIZADORES.setTimeout(f, ms),
  cancelTimeout: (id) => TEMPORIZADORES.clearTimeout(id),
  createInstance: (type, props) => ({ type, props, children: [], padre: null }),
  createTextInstance: (text) => ({ type: '#texto', text, children: [], padre: null }),
  appendInitialChild: (p, h) => poner(p, h),
  appendChild: (p, h) => poner(p, h),
  appendChildToContainer: (c, h) => poner(c, h),
  insertBefore: (p, h, antes) => meterAntes(p, h, antes),
  insertInContainerBefore: (c, h, antes) => meterAntes(c, h, antes),
  removeChild: (p, h) => quitar(p, h),
  removeChildFromContainer: (c, h) => quitar(c, h),
  clearContainer: (c) => {
    c.children = [];
  },
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getRootHostContext: () => ({}),
  getChildHostContext: (p) => p,
  getPublicInstance: (i) => i,
  prepareForCommit: () => null,
  resetAfterCommit: () => {},
  preparePortalMount: () => {},
  commitUpdate: (i, _type, _antes, nuevas) => {
    i.props = nuevas;
  },
  commitTextUpdate: (t, _antes, nuevo) => {
    t.text = nuevo;
  },
  commitMount: () => {},
  resetTextContent: () => {},
  hideInstance: () => {},
  unhideInstance: () => {},
  hideTextInstance: () => {},
  unhideTextInstance: () => {},
  detachDeletedInstance: () => {},
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  setCurrentUpdatePriority: (p) => {
    prioridad = p;
  },
  getCurrentUpdatePriority: () => prioridad,
  resolveUpdatePriority: () => prioridad || DEFAULT,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: () => {},
  requestPostPaintCallback: () => {},
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => {},
  suspendInstance: () => {},
  waitForCommitToBeReady: () => null,
  NotPendingTransition: null,
  HostTransitionContext: React.createContext(null),
  resetFormInstance: () => {},
  bindToConsole: (metodo, args) => console[metodo].bind(console, ...args),
};

/** Los temporizadores de verdad, guardados al cargar (antes de que la prueba ponga su reloj falso). */
const TEMPORIZADORES = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };

function poner(p, h) {
  quitar(p, h);
  h.padre = p;
  p.children.push(h);
}
function meterAntes(p, h, antes) {
  quitar(p, h);
  h.padre = p;
  const i = p.children.indexOf(antes);
  p.children.splice(i < 0 ? p.children.length : i, 0, h);
}
function quitar(p, h) {
  const i = p.children.indexOf(h);
  if (i >= 0) p.children.splice(i, 1);
}

const R = Reconciler(anfitrion);

/** Monta `elemento`; devuelve el árbol vivo, los errores que React no pudo atrapar y cómo desmontar. */
export function montar(elemento) {
  const raiz = { type: '#raiz', props: {}, children: [] };
  const errores = [];
  const guardar = (e) => errores.push(e);
  const cont = R.createContainer(raiz, 1 /* ConcurrentRoot */, null, false, null, '', guardar, guardar, guardar, null);
  R.updateContainer(elemento, cont, null, null);
  return {
    raiz,
    errores,
    desmontar: () => R.updateContainer(null, cont, null, null),
  };
}

/** Todos los nodos del árbol que cumplen `f`. */
export function buscar(nodo, f, out = []) {
  if (f(nodo)) out.push(nodo);
  for (const h of nodo.children) buscar(h, f, out);
  return out;
}

/** El texto visible de un nodo (sus textos, en orden). */
export function textoDe(nodo) {
  if (nodo.type === '#texto') return nodo.text;
  return nodo.children.map(textoDe).join('');
}

export { React };
