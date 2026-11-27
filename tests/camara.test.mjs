import assert from 'node:assert/strict';
import test from 'node:test';
import { createCamera } from '../public/atlas-map.mjs';

const piuraRegion = { x: 23.7, y: 9.1, width: 3.1, height: 3.25 };
const ayabaca = { x: 24.45, y: 10.28, width: 1.41, height: 0.83 };

function setup(t) {
  let width = 390, height = 414, clock = 0, frameId = 0, onResize;
  const frames = new Map();
  const globals = {
    document: { getElementById: () => ({}) },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame(callback) {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class {
      constructor(callback) { onResize = callback; }
      observe() {}
    }
  };
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
  }
  t.mock.method(performance, 'now', () => clock);
  const map = {
    getBoundingClientRect: () => ({ width, height }),
    classList: { toggle() {} },
    setAttribute() {}
  };
  return {
    camera: createCamera(map, () => {}),
    advance(ms) {
      clock += ms;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(clock);
    },
    rotate() {
      width = 505;
      height = 501;
      onResize();
    }
  };
}

test('al girar en pleno acercamiento se completa el encuadre de la provincia para el nuevo tamaño', t => {
  const { camera, advance, rotate } = setup(t);
  camera.fit(piuraRegion);
  advance(600);
  const department = camera.snapshot();
  camera.fit(ayabaca, true);
  advance(80);
  assert.ok(camera.snapshot().z > department.z);

  rotate();
  advance(700);
  const rotated = camera.snapshot();
  camera.fit(ayabaca, true);
  advance(700);
  const directlySelected = camera.snapshot();
  assert.ok(directlySelected.z > department.z);
  for (const key of ['x', 'y', 'z', 'scale']) {
    assert.ok(Math.abs(rotated[key] - directlySelected[key]) < 1e-8,
      `La cámara debe llegar al mismo ${key} al girar o al seleccionar la provincia en horizontal`);
  }
});

test('tocar durante el encuadre no ofrece desplazamiento libre fuera del territorio', t => {
  const {camera,advance}=setup(t);
  camera.fit(ayabaca,true);advance(600);
  assert.equal(camera.pan,undefined);
  assert.equal(camera.zoomBy,undefined);
  assert.ok(camera.snapshot().z>1);
});
