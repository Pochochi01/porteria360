import test from 'node:test';
import assert from 'node:assert/strict';
import { GEO, evaluateScan, haversineMeters } from '../src/lib/geo.js';

const cp = { lat: -26.8245, lng: -65.22229, radius_m: 30 };
// 1e-5 grados de latitud ≈ 1,11 m
const at = (dLatM, accuracy = 10, timestamp = Date.now()) => ({ position: { lat: cp.lat + dLatM / 111195, lng: cp.lng, accuracy, timestamp } });

test('haversine: distancias conocidas', () => {
  assert.equal(haversineMeters(0, 0, 0, 0), 0);
  assert.ok(Math.abs(haversineMeters(0, 0, 1, 0) - 111195) < 5, '1° de latitud ≈ 111,2 km');
  // Portón Norte → ~185 m al sur
  assert.ok(Math.abs(haversineMeters(cp.lat, cp.lng, cp.lat - 185 / 111195, cp.lng) - 185) < 0.5);
  assert.ok(Math.abs(haversineMeters(-34.6037, -58.3816, -31.4201, -64.1888) / 1000 - 647) < 2, 'Buenos Aires → Córdoba ≈ 647 km');
});

test('evaluateScan: estados', () => {
  assert.equal(evaluateScan(cp, at(10)).status, 'valid');
  assert.equal(evaluateScan(cp, at(29)).status, 'valid');
  const far = evaluateScan(cp, at(185));
  assert.equal(far.status, 'out_of_range');
  assert.equal(Math.round(far.distance), 185);
  assert.match(far.message, /185 metros/);
  assert.equal(evaluateScan(cp, at(5, GEO.maxAccuracyM + 1)).status, 'gps_inaccurate', 'la precisión manda aunque esté cerca');
  assert.equal(evaluateScan(cp, { geo_error: 'denied' }).status, 'gps_denied');
  assert.equal(evaluateScan(cp, { geo_error: 'disabled' }).status, 'gps_disabled');
  assert.equal(evaluateScan(cp, { geo_error: 'unsupported' }).status, 'gps_disabled');
  assert.equal(evaluateScan(cp, { geo_error: 'timeout' }).status, 'location_error');
  assert.equal(evaluateScan(cp, {}).status, 'location_error');
  assert.equal(evaluateScan(cp, at(5, 10, Date.now() - 10 * 60e3)).status, 'location_error', 'lectura vieja');
  assert.equal(evaluateScan({ lat: null, lng: null, radius_m: 30 }, at(0)).status, 'point_unlocated');
});
