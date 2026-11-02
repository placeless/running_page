export interface Activity {
  run_id: number;
  name: string;
  distance: number; // meters
  moving_time: string; // "H:MM:SS"
  type: 'Run' | string;
  subtype?: string;
  start_date: string;
  start_date_local: string;
  location_country: string | null;
  /** ISO 3166-1 alpha-2, classified from GPS at export time. */
  country_code?: string | null;
  /** Provincial-level region when identifiable, otherwise null. */
  region?: string | null;
  summary_polyline: string | null;
  /** Separate redacted route parts; never reconnect across private gaps. */
  route_segments?: string[];
  average_heartrate: number | null;
  average_speed: number; // m/s
  elevation_gain: number | null;
  source: string;
  streak: number;
}

export type SportFilter = 'all' | 'Run';
