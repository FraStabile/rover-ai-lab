import type { GpsConfig, NavSatFix } from '@rover/protocol';
import type { Rng } from '@rover/shared';

const METERS_PER_DEG_LAT = 111_320;

/** Local tangent plane (x east, y north, metres) → WGS84 approximation. */
export function localToGeodetic(x: number, y: number, cfg: Pick<GpsConfig, 'originLatitude' | 'originLongitude'>): { latitude: number; longitude: number } {
  const lat = cfg.originLatitude + y / METERS_PER_DEG_LAT;
  const lon = cfg.originLongitude + x / (METERS_PER_DEG_LAT * Math.cos((cfg.originLatitude * Math.PI) / 180));
  return { latitude: lat, longitude: lon };
}

export function geodeticToLocal(latitude: number, longitude: number, cfg: Pick<GpsConfig, 'originLatitude' | 'originLongitude'>): { x: number; y: number } {
  return {
    x: (longitude - cfg.originLongitude) * METERS_PER_DEG_LAT * Math.cos((cfg.originLatitude * Math.PI) / 180),
    y: (latitude - cfg.originLatitude) * METERS_PER_DEG_LAT,
  };
}

export function simulateGps(x: number, y: number, cfg: GpsConfig, rng: Rng, noiseMultiplier: number, stamp: number, seq: number): NavSatFix {
  const std = cfg.noise * noiseMultiplier;
  const { latitude, longitude } = localToGeodetic(x + rng.noise(std), y + rng.noise(std), cfg);
  const cov = std * std;
  return {
    header: { stamp, frame_id: 'gps', seq },
    status: { status: 0, service: 1 },
    latitude,
    longitude,
    altitude: cfg.altitude + rng.noise(std * 1.5),
    position_covariance: [cov, 0, 0, 0, cov, 0, 0, 0, cov * 2.25],
  };
}
